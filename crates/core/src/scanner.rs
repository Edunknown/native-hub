//! Repository Scanner: busca en GitHub proyectos de recompilación y ports que todavía no
//! están en el catálogo y los deja en una cola de revisión.
//!
//! Nada entra solo en el catálogo: un candidato solo pasa a ser proyecto cuando alguien lo
//! aprueba y le asigna juego, plataforma y tipo.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value, json};

use crate::http::{self, Fetcher};
use crate::releases::{self, Forge, Latest};
use crate::{Error, Result, text::fold, time};

/// Búsquedas que hace el escáner. Son a propósito concretas: mejor pocos candidatos buenos.
pub fn default_queries(now_unix: i64) -> Vec<(String, &'static str)> {
    let since = &time::iso(now_unix - 120 * 86_400)[..10];
    vec![
        ("topic:static-recompilation".into(), "tema static-recompilation"),
        ("topic:recompilation".into(), "tema recompilation"),
        ("topic:n64-recomp".into(), "tema n64-recomp"),
        ("topic:xenon-recomp".into(), "tema xenon-recomp"),
        (format!("recomp in:name pushed:>{since}"), "«recomp» en el nombre"),
        (format!("\"native pc port\" in:description pushed:>{since}"), "«native pc port» en la descripción"),
        (format!("\"static recompilation\" in:description pushed:>{since}"), "«static recompilation» en la descripción"),
        (format!("\"decompilation\" \"pc port\" in:description pushed:>{since}"), "decompilación y port a PC"),
    ]
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub queries: usize,
    pub seen: usize,
    pub already_known: usize,
    pub new_candidates: usize,
    pub errors: Vec<String>,
}

fn known(conn: &Connection, repo_url: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM projects WHERE LOWER(repo_url) = LOWER(?1)
             UNION ALL SELECT 1 FROM scan_candidates WHERE LOWER(repo_url) = LOWER(?1) LIMIT 1",
            params![repo_url],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// Ejecuta las búsquedas y guarda los candidatos nuevos.
pub fn scan(conn: &Connection, f: &dyn Fetcher, queries: &[(String, &str)]) -> ScanSummary {
    let mut sum = ScanSummary::default();
    for (q, reason) in queries {
        sum.queries += 1;
        let url = format!(
            "https://api.github.com/search/repositories?q={}&sort=updated&order=desc&per_page=50",
            urlencoding::encode(q)
        );
        let resp = match http::cached_get(conn, f, &url) {
            Ok(r) if r.status == 200 => r,
            Ok(r) => {
                sum.errors.push(format!("{reason}: HTTP {}", r.status));
                if r.status == 403 || r.status == 429 {
                    break; // cuota de búsqueda agotada: no insistir
                }
                continue;
            }
            Err(e) => {
                sum.errors.push(format!("{reason}: {e}"));
                continue;
            }
        };
        let body: Value = match serde_json::from_str(&resp.body) {
            Ok(v) => v,
            Err(e) => {
                sum.errors.push(format!("{reason}: {e}"));
                continue;
            }
        };
        for item in body["items"].as_array().into_iter().flatten() {
            sum.seen += 1;
            let Some(repo_url) = item["html_url"].as_str() else { continue };
            match known(conn, repo_url) {
                Ok(true) => {
                    sum.already_known += 1;
                    continue;
                }
                Ok(false) => {}
                Err(e) => {
                    sum.errors.push(e.to_string());
                    continue;
                }
            }
            let topics = item["topics"].as_array().map(|t| t.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(","));
            let ins = conn.execute(
                "INSERT OR IGNORE INTO scan_candidates
                   (repo_url, host, full_name, description, stars, language, topics, created_at, pushed_at, is_fork, archived, reason)
                 VALUES (?1, 'github', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    repo_url,
                    item["full_name"].as_str(),
                    item["description"].as_str(),
                    item["stargazers_count"].as_i64(),
                    item["language"].as_str(),
                    topics,
                    item["created_at"].as_str(),
                    item["pushed_at"].as_str(),
                    item["fork"].as_bool(),
                    item["archived"].as_bool(),
                    reason,
                ],
            );
            match ins {
                Ok(n) => sum.new_candidates += n,
                Err(e) => sum.errors.push(e.to_string()),
            }
        }
    }
    let _ = conn.execute(
        "INSERT INTO audit_log (action, subject, detail) VALUES ('scan', NULL, ?1)",
        params![serde_json::to_string(&sum).unwrap_or_default()],
    );
    sum
}

/// Comprueba si los candidatos pendientes tienen release con ejecutable Windows.
pub fn probe_candidates(conn: &Connection, f: &dyn Fetcher, limit: i64) -> Result<usize> {
    let rows: Vec<(i64, String)> = {
        let mut st = conn.prepare(
            "SELECT id, repo_url FROM scan_candidates WHERE status = 'new' AND release_checked_at IS NULL
             ORDER BY COALESCE(stars, 0) DESC LIMIT ?1",
        )?;
        st.query_map(params![limit], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?
    };
    let mut n = 0;
    for (id, url) in rows {
        if !http::github_quota_ok(conn, time::now_unix(), 10)? {
            break;
        }
        let Some(forge) = Forge::from_repo_url(&url) else { continue };
        let (tag, win) = match releases::fetch_latest(conn, f, &forge)? {
            Latest::Release(r) => {
                let w = releases::pick_windows_asset(&r.assets, None).asset.map(|a| a.name.clone());
                (Some(r.tag), w)
            }
            _ => (None, None),
        };
        conn.execute(
            "UPDATE scan_candidates SET release_tag = ?2, windows_asset = ?3, release_checked_at = ?4 WHERE id = ?1",
            params![id, tag, win, time::now_iso()],
        )?;
        n += 1;
    }
    Ok(n)
}

pub fn list_candidates(conn: &Connection, status: &str, limit: i64) -> Result<Vec<Value>> {
    list_candidates_from(conn, status, None, limit)
}

/// Candidatos de una fuente concreta (`github-search`, `gitlab-search`, `recompendium`) o de todas.
pub fn list_candidates_from(conn: &Connection, status: &str, source: Option<&str>, limit: i64) -> Result<Vec<Value>> {
    let mut st = conn.prepare(
        "SELECT id, repo_url, full_name, description, stars, language, topics, created_at, pushed_at,
                is_fork, archived, reason, release_tag, windows_asset, release_checked_at, status, detected_at, project_slug,
                (SELECT game FROM projects WHERE slug = project_slug), source, suggestion
         FROM scan_candidates WHERE status = ?1 AND (?3 IS NULL OR source = ?3) AND repo_url NOT LIKE '%#%'
         ORDER BY windows_asset IS NULL, COALESCE(stars, 0) DESC, id LIMIT ?2",
    )?;
    let abandoned_before = time::iso(time::now_unix() - 365 * 86_400);
    let rows = st.query_map(params![status, limit, source], |r| {
        let pushed: Option<String> = r.get(8)?;
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "repoUrl": r.get::<_, String>(1)?,
            "fullName": r.get::<_, String>(2)?,
            "description": r.get::<_, Option<String>>(3)?,
            "stars": r.get::<_, Option<i64>>(4)?,
            "language": r.get::<_, Option<String>>(5)?,
            "topics": r.get::<_, Option<String>>(6)?.map(|t| t.split(',').map(str::to_owned).collect::<Vec<_>>()).unwrap_or_default(),
            "createdAt": r.get::<_, Option<String>>(7)?,
            "abandoned": pushed.as_deref().is_some_and(|p| p < abandoned_before.as_str()),
            "pushedAt": pushed,
            "isFork": r.get::<_, Option<bool>>(9)?.unwrap_or(false),
            "archived": r.get::<_, Option<bool>>(10)?.unwrap_or(false),
            "reason": r.get::<_, String>(11)?,
            "releaseTag": r.get::<_, Option<String>>(12)?,
            "windowsAsset": r.get::<_, Option<String>>(13)?,
            "releaseChecked": r.get::<_, Option<String>>(14)?.is_some(),
            "status": r.get::<_, String>(15)?,
            "detectedAt": r.get::<_, String>(16)?,
            "projectSlug": r.get::<_, Option<String>>(17)?,
            "projectGame": r.get::<_, Option<String>>(18)?,
            "source": r.get::<_, String>(19)?,
            "suggestion": r.get::<_, Option<String>>(20)?.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
        }))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn candidate_counts(conn: &Connection) -> Result<Value> {
    let mut st = conn.prepare("SELECT status, COUNT(*) FROM scan_candidates WHERE repo_url NOT LIKE '%#%' GROUP BY status")?;
    let mut out = json!({"new": 0, "approved": 0, "rejected": 0});
    for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (k, v) = row?;
        out[k] = json!(v);
    }
    Ok(out)
}

pub fn reject(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute(
        "UPDATE scan_candidates SET status = 'rejected', reviewed_at = datetime('now') WHERE id = ?1 AND status = 'new'",
        params![id],
    )?;
    if n == 0 {
        return Err(Error::NotFound(format!("candidato {id} pendiente")));
    }
    conn.execute("INSERT INTO audit_log (action, subject) VALUES ('candidate_reject', ?1)", params![id.to_string()])?;
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub candidate_id: i64,
    /// Juego existente…
    pub game: Option<String>,
    /// …o uno nuevo con este título.
    pub new_game_title: Option<String>,
    pub platform: String,
    pub kind: String,
    pub name: Option<String>,
}

const KINDS: &[&str] = &["static_recomp", "decomp_port", "engine_reimpl", "source_port", "native_layer", "fan_remake", "decompilation", "other"];

fn slugify(s: &str) -> String {
    fold(s).replace(' ', "-")
}

/// Aprueba un candidato: crea (si hace falta) el juego y el proyecto, ambos de origen local.
/// El proyecto queda como «en desarrollo» hasta que se compruebe su release.
pub fn approve(conn: &mut Connection, a: &Approval) -> Result<String> {
    if !KINDS.contains(&a.kind.as_str()) {
        return Err(Error::Invalid(format!("tipo desconocido: {}", a.kind)));
    }
    let tx = conn.transaction()?;
    let platform_ok = tx.query_row("SELECT 1 FROM platforms WHERE slug = ?1", params![a.platform], |_| Ok(())).optional()?.is_some();
    if !platform_ok {
        return Err(Error::Invalid(format!("plataforma desconocida: {}", a.platform)));
    }
    let (repo_url, full_name, description, stars, created, pushed, is_fork): (String, String, Option<String>, Option<i64>, Option<String>, Option<String>, Option<bool>) = tx
        .query_row(
            "SELECT repo_url, full_name, description, stars, created_at, pushed_at, is_fork FROM scan_candidates WHERE id = ?1 AND status = 'new'",
            params![a.candidate_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("candidato {} pendiente", a.candidate_id)))?;

    let (game_slug, game_title) = match (&a.game, &a.new_game_title) {
        (Some(g), _) => {
            let title: String = tx
                .query_row("SELECT title FROM games WHERE slug = ?1", params![g], |r| r.get(0))
                .optional()?
                .ok_or_else(|| Error::NotFound(format!("juego {g}")))?;
            (g.clone(), title)
        }
        (None, Some(t)) if !t.trim().is_empty() => {
            let base = slugify(t);
            let mut slug = base.clone();
            let mut n = 2;
            while tx.query_row("SELECT 1 FROM games WHERE slug = ?1", params![slug], |_| Ok(())).optional()?.is_some() {
                slug = format!("{base}-{n}");
                n += 1;
            }
            tx.execute(
                "INSERT INTO games (slug, title, platform, year, igdb, search, origin) VALUES (?1, ?2, ?3, NULL, NULL, ?4, 'local')",
                params![slug, t.trim(), a.platform, fold(t)],
            )?;
            (slug, t.trim().to_owned())
        }
        _ => return Err(Error::Invalid("falta el juego".into())),
    };

    let (owner, repo) = full_name.split_once('/').unwrap_or((&full_name, &full_name));
    let name = a.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| repo.to_owned());
    let slug = {
        let base = slugify(&full_name.replace('/', " "));
        let mut s = base.clone();
        let mut n = 2;
        while tx.query_row("SELECT 1 FROM projects WHERE slug = ?1", params![s], |_| Ok(())).optional()?.is_some() {
            s = format!("{base}-{n}");
            n += 1;
        }
        s
    };
    let data = json!({
        "slug": slug, "game": game_slug, "gameTitle": game_title, "games": [game_slug], "platform": a.platform,
        "name": name, "developers": owner, "kind": a.kind, "devStatus": "unknown",
        "abandoned": false, "takedown": false, "forkOf": if is_fork == Some(true) { json!("(fork según GitHub)") } else { Value::Null },
        "toolchain": null,
        "repo": {"host": if repo_url.starts_with("https://gitlab.com/") { "gitlab" } else { "github" }, "owner": owner, "name": repo}, "repoUrl": repo_url, "repoMovedFrom": null, "homepage": null,
        "repoExists": true, "release": null, "windowsAsset": null, "hasWindowsExecutable": null, "listing": "in_development",
        "summary": description, "requirementsText": null, "requirements": null, "tags": [],
        "stars": stars, "createdAt": created, "pushedAt": pushed, "license": null,
        "source": "escáner (aprobado)", "checkedAt": null,
    });
    tx.execute(
        "INSERT INTO projects (slug, game, platform, name, developers, kind, dev_status, listing, has_windows_exe,
            takedown, abandoned, repo_url, created_at, stars, search, data, origin)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'unknown', 'in_development', NULL, 0, 0, ?7, ?8, ?9, ?10, ?11, 'local')",
        params![slug, game_slug, a.platform, name, owner, a.kind, repo_url, created, stars, fold(&format!("{name} {owner} {repo}")), serde_json::to_string(&data)?],
    )?;
    tx.execute("INSERT INTO project_games (project, game) VALUES (?1, ?2)", params![slug, game_slug])?;
    tx.execute(
        "UPDATE scan_candidates SET status = 'approved', reviewed_at = datetime('now'), project_slug = ?2 WHERE id = ?1",
        params![a.candidate_id, slug],
    )?;
    tx.execute("INSERT INTO audit_log (action, subject, detail) VALUES ('candidate_approve', ?1, ?2)", params![slug, repo_url])?;
    tx.commit()?;
    Ok(slug)
}
