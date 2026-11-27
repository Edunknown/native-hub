//! Catalog Manager: lee catalog/catalog.json y lo vuelca en SQLite.
//!
//! Los datos curados se reemplazan enteros en cada importación (en una transacción).
//! Las tablas del usuario (instalaciones, descargas, ajustes) no se tocan.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use serde_json::Value;

use crate::{Error, Result, text::fold};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFile {
    pub generated_at: String,
    #[serde(default)]
    pub sources: Value,
    pub families: Vec<String>,
    pub platforms: Vec<Platform>,
    pub games: Vec<Game>,
    /// Se guardan tal cual (JSON) además de las columnas que se consultan.
    pub projects: Vec<Value>,
}

#[derive(Debug, Deserialize)]
pub struct Platform {
    pub slug: String,
    pub name: String,
    pub short: Option<String>,
    pub family: String,
}

#[derive(Debug, Deserialize)]
pub struct Game {
    pub slug: String,
    pub title: String,
    pub platform: String,
    pub year: Option<i64>,
    pub igdb: Option<i64>,
    /// image_id de la portada en IGDB (scripts/fetch-covers.mjs).
    #[serde(default)]
    pub cover: Option<String>,
}

pub fn parse(json: &str) -> Result<CatalogFile> {
    Ok(serde_json::from_str(json)?)
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

/// Versión del catálogo cargada en la base de datos, si hay alguna.
pub fn loaded_version(conn: &Connection) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = 'catalog_generated_at'", [], |r| r.get(0))
        .optional()?)
}

/// Importa el catálogo si su versión es distinta de la cargada. Devuelve true si importó.
pub fn import_if_newer(conn: &mut Connection, cat: &CatalogFile) -> Result<bool> {
    if loaded_version(conn)?.as_deref() == Some(cat.generated_at.as_str()) {
        return Ok(false);
    }
    import(conn, cat)?;
    Ok(true)
}

pub fn import(conn: &mut Connection, cat: &CatalogFile) -> Result<()> {
    let tx = conn.transaction()?;
    // Se reemplaza solo lo que viene del catálogo. Lo local (proyectos aprobados desde el
    // escáner) se conserva; las claves foráneas se comprueban al confirmar la transacción.
    tx.execute_batch(
        "PRAGMA defer_foreign_keys = ON;
         DELETE FROM project_games WHERE project IN (SELECT slug FROM projects WHERE origin = 'catalog');
         DELETE FROM projects WHERE origin = 'catalog';
         DELETE FROM games WHERE origin = 'catalog';
         DELETE FROM platforms;",
    )?;

    {
        let mut st = tx.prepare(
            "INSERT INTO platforms (slug, name, short, family, sort) VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for (i, p) in cat.platforms.iter().enumerate() {
            if !cat.families.contains(&p.family) {
                return Err(Error::Catalog(format!("familia desconocida {} en {}", p.family, p.slug)));
            }
            st.execute(params![p.slug, p.name, p.short, p.family, i as i64])?;
        }
    }
    {
        let mut st = tx.prepare(
            "INSERT INTO games (slug, title, platform, year, igdb, search, cover) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(slug) DO UPDATE SET title = excluded.title, platform = excluded.platform,
               year = excluded.year, igdb = excluded.igdb, search = excluded.search, cover = excluded.cover,
               origin = 'catalog'",
        )?;
        for g in &cat.games {
            // Solo se guardan identificadores válidos: el valor acaba en una URL.
            let cover = g.cover.as_deref().filter(|c| crate::cover::valid_image_id(c));
            st.execute(params![g.slug, g.title, g.platform, g.year, g.igdb, fold(&g.title), cover])?;
        }
    }
    {
        let mut st = tx.prepare(
            "INSERT INTO projects (slug, game, platform, name, developers, kind, dev_status, listing,
                has_windows_exe, takedown, abandoned, repo_url, release_tag, release_published_at,
                created_at, stars, checked_at, search, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        )?;
        let mut pg = tx.prepare("INSERT OR IGNORE INTO project_games (project, game) VALUES (?1, ?2)")?;
        // Si un proyecto aprobado a mano ya está en el catálogo, manda la ficha del catálogo.
        let mut drop_local = tx.prepare(
            "DELETE FROM projects WHERE origin = 'local' AND (slug = ?1 OR LOWER(repo_url) = LOWER(?2))",
        )?;
        for p in &cat.projects {
            let slug = s(p, "slug").ok_or_else(|| Error::Catalog(crate::i18n::tr("proyecto sin slug", "project without a slug").into()))?;
            let game = s(p, "game").ok_or_else(|| Error::Catalog(crate::t!("{slug} sin juego", "{slug} has no game")))?;
            let release = p.get("release").filter(|r| !r.is_null());
            drop_local.execute(params![slug, s(p, "repoUrl")])?;
            let search = fold(&format!(
                "{} {} {}",
                s(p, "name").unwrap_or_default(),
                s(p, "developers").unwrap_or_default(),
                p.pointer("/repo/name").and_then(Value::as_str).unwrap_or_default()
            ));
            st.execute(params![
                slug,
                game,
                s(p, "platform"),
                s(p, "name"),
                s(p, "developers"),
                s(p, "kind"),
                s(p, "devStatus"),
                s(p, "listing"),
                p.get("hasWindowsExecutable").and_then(Value::as_bool),
                p.get("takedown").and_then(Value::as_bool).unwrap_or(false),
                p.get("abandoned").and_then(Value::as_bool).unwrap_or(false),
                s(p, "repoUrl"),
                release.and_then(|r| s(r, "tag")),
                release.and_then(|r| s(r, "publishedAt")),
                s(p, "createdAt"),
                p.get("stars").and_then(Value::as_i64),
                s(p, "checkedAt"),
                search,
                serde_json::to_string(p)?,
            ])?;
            pg.execute(params![slug, game])?;
            if let Some(gs) = p.get("games").and_then(Value::as_array) {
                for g in gs.iter().filter_map(Value::as_str) {
                    pg.execute(params![slug, g])?;
                }
            }
        }
    }
    crate::releases::reapply_live_state(&tx)?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('catalog_generated_at', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![cat.generated_at],
    )?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('catalog_sources', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(&cat.sources)?],
    )?;
    tx.execute(
        "INSERT INTO audit_log (action, subject, detail) VALUES ('catalog_import', ?1, ?2)",
        params![cat.generated_at, format!("{} proyectos", cat.projects.len())],
    )?;
    tx.commit()?;
    Ok(())
}
