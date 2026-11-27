//! Catalog served from GitHub.
//!
//! The app ships with the catalog it was built with, and also downloads the latest one
//! published in the repository (`catalog/catalog.json` on `main`), so new projects, fixes
//! and adapters reach users without a new app version. The download is conditional (ETag),
//! comes only from raw.githubusercontent.com over HTTPS, is validated before importing and
//! is only imported if it is newer than the loaded one. A catalog with a newer `schema`
//! than this build understands is ignored until the app is updated.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;

use crate::catalog::{self, CatalogFile};
use crate::http::Fetcher;
use crate::{Error, Result, time};

pub const CATALOG_URL: &str = "https://raw.githubusercontent.com/Edunknown/native-hub/main/catalog/catalog.json";
/// Highest catalog format this build can read.
pub const SCHEMA: i64 = 1;
/// A published catalog smaller than this is treated as broken, not as "the catalog shrank".
const MIN_PROJECTS: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "result")]
pub enum Outcome {
    /// Nothing new on GitHub (304, or the same version).
    UpToDate { version: String },
    /// A newer catalog was downloaded and imported.
    Updated { from: Option<String>, to: String, projects: usize },
    /// GitHub has an older catalog than the one loaded (for example, a newer app build).
    Older { loaded: String, remote: String },
    /// The catalog uses a newer format: the app has to be updated first.
    NeedsAppUpdate { schema: i64 },
}

fn set(conn: &Connection, key: &str, value: Option<&str>) -> Result<()> {
    match value {
        Some(v) => conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, v],
        )?,
        None => conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?,
    };
    Ok(())
}

fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0)).optional()?)
}

/// Checks that a downloaded catalog is complete and consistent before it replaces the loaded one.
pub fn validate(cat: &CatalogFile, now_unix: i64) -> Result<()> {
    let bad = |m: String| Err(Error::Catalog(m));
    let Some(at) = time::parse_iso(&cat.generated_at) else {
        return bad(format!("generatedAt {}", cat.generated_at));
    };
    if at > now_unix + 86_400 {
        return bad(crate::t!("fecha en el futuro: {}", "date in the future: {}", cat.generated_at));
    }
    if cat.projects.len() < MIN_PROJECTS {
        return bad(crate::t!("solo {} proyectos", "only {} projects", cat.projects.len()));
    }
    // A catalog built without checking releases has (almost) nothing installable: don't
    // replace a good catalog with it.
    let library = cat.projects.iter().filter(|p| p.get("listing").and_then(Value::as_str) == Some("library")).count();
    if library < cat.projects.len() / 10 {
        return bad(crate::t!("solo {library} proyectos instalables", "only {library} installable projects"));
    }
    let platforms: std::collections::HashSet<&str> = cat.platforms.iter().map(|p| p.slug.as_str()).collect();
    let games: std::collections::HashSet<&str> = cat.games.iter().map(|g| g.slug.as_str()).collect();
    if games.len() != cat.games.len() {
        return bad(crate::i18n::tr("juegos repetidos", "duplicate games").into());
    }
    for g in &cat.games {
        if !platforms.contains(g.platform.as_str()) {
            return bad(crate::t!("{}: plataforma desconocida", "{}: unknown platform", g.slug));
        }
    }
    let mut slugs = std::collections::HashSet::new();
    for p in &cat.projects {
        let slug = p.get("slug").and_then(Value::as_str).unwrap_or_default();
        if slug.is_empty() || !slugs.insert(slug) {
            return bad(crate::t!("proyecto sin slug o repetido: {slug}", "missing or duplicate project slug: {slug}"));
        }
        let game = p.get("game").and_then(Value::as_str).unwrap_or_default();
        if !games.contains(game) {
            return bad(crate::t!("{slug}: juego desconocido", "{slug}: unknown game"));
        }
        if let Some(url) = p.get("repoUrl").and_then(Value::as_str) {
            if !url.starts_with("https://") {
                return bad(crate::t!("{slug}: repositorio sin HTTPS", "{slug}: repository is not HTTPS"));
            }
        }
    }
    Ok(())
}

/// Downloads the catalog published on GitHub and imports it if it is newer.
pub fn check(conn: &mut Connection, f: &dyn Fetcher, url: &str) -> Result<Outcome> {
    let result = check_inner(conn, f, url);
    set(conn, "remote_catalog_checked_at", Some(&time::now_iso()))?;
    match &result {
        Ok(_) => set(conn, "remote_catalog_error", None)?,
        Err(e) => set(conn, "remote_catalog_error", Some(&e.to_string()))?,
    }
    result
}

fn check_inner(conn: &mut Connection, f: &dyn Fetcher, url: &str) -> Result<Outcome> {
    let loaded = catalog::loaded_version(conn)?;
    let etag = get(conn, "remote_catalog_etag")?;
    let resp = f.get(url, etag.as_deref())?;
    if resp.status == 304 {
        return Ok(Outcome::UpToDate { version: loaded.unwrap_or_default() });
    }
    if resp.status != 200 {
        return Err(Error::Http(crate::t!("el catálogo de GitHub respondió HTTP {}", "GitHub catalog answered HTTP {}", resp.status)));
    }
    let raw: Value = serde_json::from_str(&resp.body)?;
    let schema = raw.get("schema").and_then(Value::as_i64).unwrap_or(1);
    if schema > SCHEMA {
        // Not an error: this build simply cannot read it. Don't keep the ETag, so it is
        // downloaded again once the app has been updated.
        return Ok(Outcome::NeedsAppUpdate { schema });
    }
    let cat: CatalogFile = serde_json::from_value(raw)?;
    validate(&cat, time::now_unix())?;
    let outcome = match loaded.as_deref() {
        Some(v) if v == cat.generated_at => Outcome::UpToDate { version: v.to_owned() },
        Some(v) if v > cat.generated_at.as_str() => Outcome::Older { loaded: v.to_owned(), remote: cat.generated_at.clone() },
        _ => {
            catalog::import(conn, &cat)?;
            conn.execute(
                "INSERT INTO audit_log (action, subject, detail) VALUES ('catalog_remote', ?1, ?2)",
                params![cat.generated_at, url],
            )?;
            Outcome::Updated { from: loaded, to: cat.generated_at.clone(), projects: cat.projects.len() }
        }
    };
    set(conn, "remote_catalog_etag", resp.etag.as_deref())?;
    Ok(outcome)
}

/// What the Settings page shows about the catalog.
pub fn status(conn: &Connection) -> Result<Value> {
    Ok(serde_json::json!({
        "version": catalog::loaded_version(conn)?,
        "checkedAt": get(conn, "remote_catalog_checked_at")?,
        "error": get(conn, "remote_catalog_error")?,
        "url": CATALOG_URL,
    }))
}
