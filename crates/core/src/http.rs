//! Acceso HTTP a las APIs oficiales de forjas (GitHub, GitLab, Codeberg).
//!
//! Solo se permiten estos hosts. Las respuestas se guardan con su ETag en `http_cache`:
//! una petición condicional que devuelve 304 no gasta cuota en GitHub.

use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};

use crate::{Error, Result};

pub const ALLOWED_HOSTS: &[&str] = &["api.github.com", "gitlab.com", "codeberg.org", "raw.githubusercontent.com"];
const USER_AGENT: &str = concat!("NATIVE-HUB/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub etag: Option<String>,
    pub body: String,
    pub rate: Option<RateLimit>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimit {
    pub limit: i64,
    pub remaining: i64,
    /// Segundos Unix en que se renueva la cuota.
    pub reset: i64,
}

/// Algo que sabe hacer un GET. La app usa `UreqFetcher`; las pruebas, un doble.
pub trait Fetcher: Send + Sync {
    fn get(&self, url: &str, etag: Option<&str>) -> Result<Response>;
}

pub struct UreqFetcher {
    agent: ureq::Agent,
    github_token: Option<String>,
}

impl UreqFetcher {
    pub fn new(github_token: Option<String>) -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .http_status_as_error(false)
            .https_only(true)
            .build()
            .into();
        Self { agent, github_token: github_token.filter(|t| !t.trim().is_empty()) }
    }
}

pub fn host_of(url: &str) -> Option<&str> {
    url.strip_prefix("https://")?.split('/').next()
}

fn header_i64(resp: &ureq::http::Response<ureq::Body>, name: &str) -> Option<i64> {
    resp.headers().get(name)?.to_str().ok()?.parse().ok()
}

impl Fetcher for UreqFetcher {
    fn get(&self, url: &str, etag: Option<&str>) -> Result<Response> {
        let host = host_of(url).ok_or_else(|| Error::Http(crate::t!("URL no válida: {url}", "invalid URL: {url}")))?;
        if !ALLOWED_HOSTS.contains(&host) {
            return Err(Error::Http(crate::t!("host no permitido: {host}", "host not allowed: {host}")));
        }
        let mut req = self.agent.get(url).header("User-Agent", USER_AGENT);
        if host == "api.github.com" {
            req = req.header("Accept", "application/vnd.github+json").header("X-GitHub-Api-Version", "2022-11-28");
            if let Some(t) = &self.github_token {
                req = req.header("Authorization", &format!("Bearer {t}"));
            }
        }
        if let Some(e) = etag {
            req = req.header("If-None-Match", e);
        }
        let mut resp = req.call().map_err(|e| Error::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        let etag = resp.headers().get("etag").and_then(|v| v.to_str().ok()).map(str::to_owned);
        let rate = match (
            header_i64(&resp, "x-ratelimit-limit"),
            header_i64(&resp, "x-ratelimit-remaining"),
            header_i64(&resp, "x-ratelimit-reset"),
        ) {
            (Some(limit), Some(remaining), Some(reset)) if host == "api.github.com" => Some(RateLimit { limit, remaining, reset }),
            _ => None,
        };
        let body = if status == 304 {
            String::new()
        } else {
            resp.body_mut()
                .with_config()
                .limit(32 * 1024 * 1024)
                .read_to_string()
                .map_err(|e| Error::Http(e.to_string()))?
        };
        Ok(Response { status, etag, body, rate })
    }
}

/// GET con caché ETag: si el servidor responde 304, devuelve el cuerpo guardado con estado 200.
pub fn cached_get(conn: &Connection, f: &dyn Fetcher, url: &str) -> Result<Response> {
    let cached: Option<(Option<String>, String)> = conn
        .query_row("SELECT etag, body FROM http_cache WHERE url = ?1", params![url], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let resp = f.get(url, cached.as_ref().and_then(|c| c.0.as_deref()))?;
    // La búsqueda tiene su propia cuota (por minuto); no se mezcla con la de la API normal.
    if let Some(rate) = resp.rate.filter(|_| !url.contains("/search/")) {
        save_rate_limit(conn, rate)?;
    }
    if resp.status == 304 {
        if let Some((etag, body)) = cached {
            conn.execute("UPDATE http_cache SET fetched_at = datetime('now') WHERE url = ?1", params![url])?;
            return Ok(Response { status: 200, etag, body, rate: resp.rate });
        }
    }
    if resp.status == 200 {
        conn.execute(
            "INSERT INTO http_cache (url, etag, body, fetched_at) VALUES (?1, ?2, ?3, datetime('now'))
             ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, body = excluded.body, fetched_at = excluded.fetched_at",
            params![url, resp.etag, resp.body],
        )?;
    }
    Ok(resp)
}

pub fn save_rate_limit(conn: &Connection, rate: RateLimit) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('github_rate_limit', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(&rate)?],
    )?;
    Ok(())
}

pub fn rate_limit(conn: &Connection) -> Result<Option<RateLimit>> {
    let v: Option<String> =
        conn.query_row("SELECT value FROM settings WHERE key = 'github_rate_limit'", [], |r| r.get(0)).optional()?;
    Ok(v.and_then(|s| {
        let j: serde_json::Value = serde_json::from_str(&s).ok()?;
        Some(RateLimit { limit: j["limit"].as_i64()?, remaining: j["remaining"].as_i64()?, reset: j["reset"].as_i64()? })
    }))
}

/// ¿Queda cuota de GitHub? Deja un margen para que la app siga respondiendo.
pub fn github_quota_ok(conn: &Connection, now_unix: i64, reserve: i64) -> Result<bool> {
    Ok(match rate_limit(conn)? {
        Some(r) if r.reset > now_unix => r.remaining > reserve,
        _ => true,
    })
}
