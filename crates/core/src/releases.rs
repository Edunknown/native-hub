//! Release Manager: consulta en vivo la última release de cada proyecto, decide si publica
//! un ejecutable Windows y registra las novedades (versión nueva, release retirada, repo
//! desaparecido, primer ejecutable Windows).

use std::sync::atomic::{AtomicBool, Ordering};

use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value, json};

use crate::http::{self, Fetcher};
use crate::{Error, Result, time};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub name: String,
    pub url: String,
    pub size: Option<i64>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub tag: String,
    pub url: String,
    pub published_at: Option<String>,
    pub prerelease: Option<bool>,
    pub assets: Vec<AssetInfo>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Latest {
    Release(ReleaseInfo),
    NoRelease,
    RepoMissing,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Forge {
    GitHub { owner: String, name: String },
    GitLab { path: String },
    Codeberg { owner: String, name: String },
}

impl Forge {
    pub fn from_repo_url(url: &str) -> Option<Forge> {
        let rest = url.strip_prefix("https://")?.trim_end_matches('/');
        let (host, path) = rest.split_once('/')?;
        let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let valid = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
        if !parts.iter().all(|p| valid(p)) {
            return None;
        }
        match (host, parts.as_slice()) {
            ("github.com", [o, n]) => Some(Forge::GitHub { owner: o.to_string(), name: n.to_string() }),
            ("codeberg.org", [o, n]) => Some(Forge::Codeberg { owner: o.to_string(), name: n.to_string() }),
            ("gitlab.com", p) if p.len() >= 2 => Some(Forge::GitLab { path: p.join("/") }),
            _ => None,
        }
    }

    pub fn is_github(&self) -> bool {
        matches!(self, Forge::GitHub { .. })
    }
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_owned)
}

fn parse_github_release(v: &Value) -> ReleaseInfo {
    let assets = v["assets"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|x| AssetInfo {
                    name: s(x, "name").unwrap_or_default(),
                    url: s(x, "browser_download_url").unwrap_or_default(),
                    size: x["size"].as_i64(),
                    sha256: s(x, "digest").and_then(|d| d.strip_prefix("sha256:").map(str::to_owned)),
                })
                .collect()
        })
        .unwrap_or_default();
    ReleaseInfo {
        tag: s(v, "tag_name").unwrap_or_default(),
        url: s(v, "html_url").unwrap_or_default(),
        published_at: s(v, "published_at"),
        prerelease: v["prerelease"].as_bool(),
        assets,
    }
}

fn parse_gitlab_release(v: &Value, path: &str) -> ReleaseInfo {
    let assets = v["assets"]["links"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|x| AssetInfo {
                    name: s(x, "name").unwrap_or_default(),
                    url: s(x, "direct_asset_url").or_else(|| s(x, "url")).unwrap_or_default(),
                    size: None,
                    sha256: None,
                })
                .collect()
        })
        .unwrap_or_default();
    let tag = s(v, "tag_name").unwrap_or_default();
    ReleaseInfo {
        url: format!("https://gitlab.com/{path}/-/releases/{}", urlencoding::encode(&tag)),
        tag,
        published_at: s(v, "released_at"),
        prerelease: v["upcoming_release"].as_bool(),
        assets,
    }
}

fn parse_codeberg_release(v: &Value) -> ReleaseInfo {
    let assets = v["assets"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|x| AssetInfo {
                    name: s(x, "name").unwrap_or_default(),
                    url: s(x, "browser_download_url").unwrap_or_default(),
                    size: x["size"].as_i64(),
                    sha256: None,
                })
                .collect()
        })
        .unwrap_or_default();
    ReleaseInfo {
        tag: s(v, "tag_name").unwrap_or_default(),
        url: s(v, "html_url").unwrap_or_default(),
        published_at: s(v, "published_at"),
        prerelease: v["prerelease"].as_bool(),
        assets,
    }
}

fn rate_limited(resp: &http::Response) -> bool {
    (resp.status == 403 || resp.status == 429) && resp.rate.is_none_or(|r| r.remaining == 0)
}

fn check(resp: &http::Response, url: &str) -> Result<()> {
    if rate_limited(resp) {
        return Err(Error::Http("límite de consultas de GitHub agotado; vuelve a intentarlo más tarde o añade un token".into()));
    }
    if resp.status >= 400 && resp.status != 404 {
        return Err(Error::Http(format!("HTTP {} en {url}", resp.status)));
    }
    Ok(())
}

pub fn fetch_latest(conn: &Connection, f: &dyn Fetcher, forge: &Forge) -> Result<Latest> {
    match forge {
        Forge::GitHub { owner, name } => {
            let base = format!("https://api.github.com/repos/{owner}/{name}");
            let url = format!("{base}/releases/latest");
            let r = http::cached_get(conn, f, &url)?;
            check(&r, &url)?;
            if r.status == 200 {
                return Ok(Latest::Release(parse_github_release(&serde_json::from_str(&r.body)?)));
            }
            // 404: o no hay releases estables, o no existe el repo. /releases incluye prereleases.
            let url = format!("{base}/releases?per_page=1");
            let r = http::cached_get(conn, f, &url)?;
            check(&r, &url)?;
            if r.status == 404 {
                return Ok(Latest::RepoMissing);
            }
            let list: Value = serde_json::from_str(&r.body)?;
            Ok(list.get(0).map(|v| Latest::Release(parse_github_release(v))).unwrap_or(Latest::NoRelease))
        }
        Forge::GitLab { path } => {
            let url = format!("https://gitlab.com/api/v4/projects/{}/releases?per_page=1", urlencoding::encode(path));
            let r = http::cached_get(conn, f, &url)?;
            check(&r, &url)?;
            if r.status == 404 {
                return Ok(Latest::RepoMissing);
            }
            let list: Value = serde_json::from_str(&r.body)?;
            Ok(list.get(0).map(|v| Latest::Release(parse_gitlab_release(v, path))).unwrap_or(Latest::NoRelease))
        }
        Forge::Codeberg { owner, name } => {
            let url = format!("https://codeberg.org/api/v1/repos/{owner}/{name}/releases?limit=1");
            let r = http::cached_get(conn, f, &url)?;
            check(&r, &url)?;
            if r.status == 404 {
                return Ok(Latest::RepoMissing);
            }
            let list: Value = serde_json::from_str(&r.body)?;
            Ok(list.get(0).map(|v| Latest::Release(parse_codeberg_release(v))).unwrap_or(Latest::NoRelease))
        }
    }
}

// ---------- Ejecutable Windows (misma lógica que scripts/build-catalog.mjs) ----------

const NOT_WINDOWS: &str = r"(?i)(linux|mac|osx|darwin|apple|android|ios|switch|nro|appimage|flatpak|steamdeck|decky|symbols|pdb|debug|source|src|\.txt$|\.md$|\.sha256$|\.sig$|\.asc$|\.json$|\.deb$|\.rpm$|\.dmg$|\.apk$|\.tar\.|\.ipa$)";
const WINDOWS: &str = r"(?i)(win|windows|msvc|mingw|\.exe$|\.msi$)";

pub struct WindowsPick<'a> {
    pub asset: Option<&'a AssetInfo>,
    /// Hay archivos genéricos (.zip sin sistema en el nombre): no se puede decidir sin revisarlo.
    pub ambiguous: bool,
}

pub fn pick_windows_asset<'a>(assets: &'a [AssetInfo], pattern: Option<&str>) -> WindowsPick<'a> {
    let not_win = Regex::new(NOT_WINDOWS).expect("regex");
    if let Some(p) = pattern.and_then(|p| Regex::new(p).ok()) {
        return WindowsPick { asset: assets.iter().find(|a| p.is_match(&a.name)), ambiguous: false };
    }
    let win = Regex::new(WINDOWS).expect("regex");
    let arch = Regex::new(r"(?i)(x64|x86_64|win64|amd64)").expect("regex");
    let ext = Regex::new(r"(?i)\.(zip|exe|msi|7z)$").expect("regex");
    let generic = Regex::new(r"(?i)\.(zip|7z|rar|exe)$").expect("regex");
    let score = |a: &AssetInfo| arch.is_match(&a.name) as u8 * 2 + ext.is_match(&a.name) as u8;
    let asset = assets
        .iter()
        .filter(|a| win.is_match(&a.name) && !not_win.is_match(&a.name.to_lowercase().replacen("windows", "", 1)))
        .max_by_key(|a| score(a));
    let ambiguous = asset.is_none() && assets.iter().any(|a| generic.is_match(&a.name) && !not_win.is_match(&a.name));
    WindowsPick { asset, ambiguous }
}

// ---------- Refrescar proyectos ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshOutcome {
    pub slug: String,
    pub status: &'static str,
    pub tag: Option<String>,
    pub events: Vec<&'static str>,
}

fn release_json(r: &ReleaseInfo) -> Value {
    json!({
        "tag": r.tag, "url": r.url, "publishedAt": r.published_at, "prerelease": r.prerelease,
        "assets": r.assets.iter().map(|a| json!({"name": a.name, "url": a.url, "size": a.size, "sizeApprox": false, "sha256": a.sha256})).collect::<Vec<_>>(),
    })
}

/// Comprueba en vivo un proyecto y guarda el resultado.
pub fn refresh_project(conn: &Connection, f: &dyn Fetcher, slug: &str) -> Result<RefreshOutcome> {
    let (data, repo_url): (String, Option<String>) = conn
        .query_row("SELECT data, repo_url FROM projects WHERE slug = ?1", params![slug], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("proyecto {slug}")))?;
    let mut data: Value = serde_json::from_str(&data)?;
    let repo_url = repo_url.ok_or_else(|| Error::Invalid(format!("{slug} no tiene repositorio")))?;
    let forge = Forge::from_repo_url(&repo_url).ok_or_else(|| Error::Invalid(format!("forja no soportada: {repo_url}")))?;

    let latest = fetch_latest(conn, f, &forge)?;
    let prev_tag = data.pointer("/release/tag").and_then(Value::as_str).map(str::to_owned);
    let prev_win = data["hasWindowsExecutable"].as_bool() == Some(true);
    let prev_exists = data["repoExists"].as_bool() != Some(false);
    let takedown = data["takedown"].as_bool() == Some(true);
    let pattern = data["windowsAssetPattern"].as_str().map(str::to_owned);
    let mut events = Vec::new();

    let (status, tag) = match &latest {
        Latest::Release(r) => {
            let pick = pick_windows_asset(&r.assets, pattern.as_deref());
            let has_win = pick.asset.is_some();
            data["release"] = release_json(r);
            data["windowsAsset"] = pick.asset.map(|a| json!({"name": a.name, "url": a.url, "size": a.size, "sizeApprox": false, "sha256": a.sha256})).unwrap_or(Value::Null);
            data["hasWindowsExecutable"] = if pick.ambiguous { Value::Null } else { json!(has_win) };
            data["repoExists"] = json!(true);
            data["listing"] = json!(if has_win && !takedown { "library" } else { "in_development" });
            if prev_tag.as_deref().is_some_and(|p| p != r.tag) {
                events.push("new_version");
            }
            if has_win && !prev_win {
                events.push("windows_build");
            }
            ("release", Some(r.tag.clone()))
        }
        Latest::NoRelease => {
            if prev_tag.is_some() {
                events.push("withdrawn");
            }
            data["release"] = Value::Null;
            data["windowsAsset"] = Value::Null;
            data["hasWindowsExecutable"] = json!(false);
            data["repoExists"] = json!(true);
            data["listing"] = json!("in_development");
            ("no_release", None)
        }
        Latest::RepoMissing => {
            if prev_exists {
                events.push("repo_missing");
            }
            data["repoExists"] = json!(false);
            data["listing"] = json!("in_development");
            ("repo_missing", None)
        }
    };
    let now = time::now_iso();
    data["checkedAt"] = json!(now);
    write_project_state(conn, slug, &data)?;
    conn.execute(
        "INSERT INTO release_state (repo_url, data, checked_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(repo_url) DO UPDATE SET data = excluded.data, checked_at = excluded.checked_at",
        params![repo_url, serde_json::to_string(&live_fields(&data))?, now],
    )?;
    for e in &events {
        conn.execute(
            "INSERT INTO update_events (project, kind, from_tag, to_tag) VALUES (?1, ?2, ?3, ?4)",
            params![slug, e, prev_tag, tag],
        )?;
    }
    Ok(RefreshOutcome { slug: slug.to_owned(), status, tag, events })
}

const LIVE_KEYS: &[&str] = &["release", "windowsAsset", "hasWindowsExecutable", "repoExists", "listing", "checkedAt"];

fn live_fields(data: &Value) -> Value {
    Value::Object(LIVE_KEYS.iter().filter_map(|k| Some((k.to_string(), data.get(*k)?.clone()))).collect())
}

fn write_project_state(conn: &Connection, slug: &str, data: &Value) -> Result<()> {
    conn.execute(
        "UPDATE projects SET data = ?2, listing = ?3, has_windows_exe = ?4, release_tag = ?5,
            release_published_at = ?6, checked_at = ?7 WHERE slug = ?1",
        params![
            slug,
            serde_json::to_string(data)?,
            data["listing"].as_str().unwrap_or("in_development"),
            data["hasWindowsExecutable"].as_bool(),
            data.pointer("/release/tag").and_then(Value::as_str),
            data.pointer("/release/publishedAt").and_then(Value::as_str),
            data["checkedAt"].as_str(),
        ],
    )?;
    Ok(())
}

/// Tras importar un catálogo, vuelve a aplicar las comprobaciones en vivo que sean más recientes.
pub fn reapply_live_state(conn: &Connection) -> Result<usize> {
    let rows: Vec<(String, String, String, String)> = {
        let mut st = conn.prepare(
            "SELECT p.slug, p.data, r.data, r.checked_at FROM projects p
             JOIN release_state r ON r.repo_url = p.repo_url
             WHERE p.checked_at IS NULL OR r.checked_at > p.checked_at",
        )?;
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<_>>()?
    };
    for (slug, data, live, _) in &rows {
        let mut data: Value = serde_json::from_str(data)?;
        let live: Value = serde_json::from_str(live)?;
        if let (Some(d), Some(l)) = (data.as_object_mut(), live.as_object()) {
            for (k, v) in l {
                d.insert(k.clone(), v.clone());
            }
            // Un proyecto retirado por DMCA nunca es instalable, diga lo que diga la release.
            if d.get("takedown").and_then(Value::as_bool) == Some(true) {
                d.insert("listing".into(), json!("in_development"));
            }
        }
        write_project_state(conn, slug, &data)?;
    }
    Ok(rows.len())
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    pub checked: usize,
    pub new_versions: usize,
    pub errors: usize,
    pub skipped_rate_limit: usize,
    pub stopped: bool,
}

/// Proyectos con repositorio, los menos recientes primero, no comprobados en `max_age_hours`.
pub fn stale_projects(conn: &Connection, max_age_hours: i64, limit: i64) -> Result<Vec<(String, String)>> {
    let cutoff = time::iso(time::now_unix() - max_age_hours * 3600);
    let mut st = conn.prepare(
        "SELECT slug, repo_url FROM projects
         WHERE repo_url IS NOT NULL AND (checked_at IS NULL OR checked_at < ?1)
         ORDER BY checked_at IS NOT NULL, checked_at LIMIT ?2",
    )?;
    let rows = st.query_map(params![cutoff, limit], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Comprueba una lista de proyectos. Respeta la cuota de GitHub y se puede cancelar.
pub fn refresh_batch(
    conn: &Connection,
    f: &dyn Fetcher,
    items: &[(String, String)],
    cancel: &AtomicBool,
    mut progress: impl FnMut(usize, usize, &str),
) -> BatchSummary {
    let mut sum = BatchSummary::default();
    for (i, (slug, repo_url)) in items.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            sum.stopped = true;
            break;
        }
        progress(i, items.len(), slug);
        let github = repo_url.starts_with("https://github.com/");
        // Se reserva una parte de la cuota para lo que el usuario abra a mano.
        if github && !http::github_quota_ok(conn, time::now_unix(), 5).unwrap_or(true) {
            sum.skipped_rate_limit += 1;
            continue;
        }
        match refresh_project(conn, f, slug) {
            Ok(o) => {
                sum.checked += 1;
                sum.new_versions += o.events.iter().filter(|e| **e == "new_version").count();
            }
            Err(_) => sum.errors += 1,
        }
    }
    progress(items.len(), items.len(), "");
    sum
}

/// Novedades detectadas, las más recientes primero.
pub fn update_events(conn: &Connection, limit: i64) -> Result<Vec<Value>> {
    let mut st = conn.prepare(
        "SELECT e.id, e.kind, e.from_tag, e.to_tag, e.detected_at, e.seen_at, p.data
         FROM update_events e JOIN projects p ON p.slug = e.project
         ORDER BY e.detected_at DESC, e.id DESC LIMIT ?1",
    )?;
    let rows = st.query_map(params![limit], |r| {
        let data: String = r.get(6)?;
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "kind": r.get::<_, String>(1)?,
            "fromTag": r.get::<_, Option<String>>(2)?,
            "toTag": r.get::<_, Option<String>>(3)?,
            "detectedAt": r.get::<_, String>(4)?,
            "seen": r.get::<_, Option<String>>(5)?.is_some(),
            "project": serde_json::from_str::<Value>(&data).unwrap_or(Value::Null),
        }))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn mark_events_seen(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("UPDATE update_events SET seen_at = datetime('now') WHERE seen_at IS NULL", [])?)
}

pub fn unseen_events(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM update_events WHERE seen_at IS NULL", [], |r| r.get(0))?)
}

/// Estado del Release Manager para la vista de Actualizaciones.
pub fn status(conn: &Connection) -> Result<Value> {
    let (total, checked24, never): (i64, i64, i64) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(checked_at >= ?1), 0),
                COALESCE(SUM(checked_at IS NULL), 0)
         FROM projects WHERE repo_url IS NOT NULL",
        params![time::iso(time::now_unix() - 24 * 3600)],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let last: Option<String> = conn.query_row("SELECT MAX(checked_at) FROM release_state", [], |r| r.get(0))?;
    Ok(json!({
        "projectsWithRepo": total,
        "checkedLast24h": checked24,
        "neverChecked": never,
        "lastLiveCheck": last,
        "rateLimit": http::rate_limit(conn)?,
        "unseenEvents": unseen_events(conn)?,
    }))
}
