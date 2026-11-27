//! Expansión del catálogo (fase 7).
//!
//! - **Recompendium**: la app consulta la lista de fichas de su repositorio de datos
//!   (github.com/Nio03/unricopie, CC BY-SA 4.0) y descarga solo las que aún no conoce. Cada
//!   ficha nueva entra en la **cola de revisión** con juego, consola y tipo ya sugeridos: no
//!   pasa al catálogo hasta que alguien la aprueba (en un clic o en bloque).
//! - **GitLab**: búsquedas en la API oficial de GitLab que también van a la cola.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value, json};

use crate::http::{self, Fetcher};
use crate::{Error, Result, text::fold, time};

const RECOMPENDIUM_TREE: &str = "https://api.github.com/repos/Nio03/unricopie/git/trees/main?recursive=1";
const RECOMPENDIUM_RAW: &str = "https://raw.githubusercontent.com/Nio03/unricopie/main/";

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub entries: usize,
    pub already_known: usize,
    pub fetched: usize,
    pub new_candidates: usize,
    pub remaining: usize,
    pub errors: Vec<String>,
}

fn es(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Object(o) => o.get("es").or_else(|| o.get("en")).and_then(Value::as_str).map(str::to_owned),
        _ => None,
    }
}

fn kind_for(folder: &str, category: Option<&str>) -> &'static str {
    match (folder, category) {
        ("recomps", _) => "static_recomp",
        ("decomps", _) => "decompilation",
        (_, Some("decomp-port")) => "decomp_port",
        (_, Some("fan-remake")) => "fan_remake",
        (_, Some("game-engine")) => "engine_reimpl",
        (_, Some("native-layer")) => "native_layer",
        (_, Some("source-port")) => "source_port",
        _ => "other",
    }
}

fn status_for(s: Option<&str>) -> &'static str {
    match s {
        Some("fully") => "complete",
        Some("playable") | Some("usable") => "playable",
        Some("experimental") => "experimental",
        Some("stable") => "stable",
        Some("beta") => "beta",
        _ => "unknown",
    }
}

/// Convierte una ficha YAML de Recompendium en la sugerencia que guarda la cola de revisión.
pub fn suggestion_from_yaml(source_id: &str, yaml: &Value, games: &Value) -> Option<Value> {
    let folder = source_id.split('/').next().unwrap_or_default();
    let repo = yaml["repo"].as_str();
    let repo_url = match (repo, yaml["repoUrl"].as_str()) {
        (Some(r), _) => format!("https://github.com/{r}"),
        (None, Some(u)) if u.starts_with("https://") => u.trim_end_matches('/').to_owned(),
        _ => return None,
    };
    let game = yaml["games"].get(0).and_then(Value::as_str)?.to_owned();
    let g = &games[&game];
    let title = g["name"].as_str().unwrap_or(&game).to_owned();
    let platform = yaml["console"]
        .as_str()
        .or_else(|| g["platforms"].get(0).and_then(Value::as_str))
        .unwrap_or("other")
        .to_owned();
    let raw_name = yaml["name"].as_str().unwrap_or_default();
    let base_title = title.trim_end_matches(|c: char| c == ')' || c.is_ascii_digit() || c == '(' || c == ' ');
    let repo_name = repo_url.rsplit('/').next().unwrap_or_default().to_owned();
    let name = if raw_name.starts_with(&title) || raw_name.starts_with(base_title) { repo_name.clone() } else { raw_name.to_owned() };
    let owner = repo.and_then(|r| r.split('/').next()).map(str::to_owned);
    Some(json!({
        "sourceId": source_id,
        "repoUrl": repo_url,
        "game": game,
        "gameTitle": title,
        "gameYear": g["year"].as_i64(),
        "platform": platform,
        "kind": kind_for(folder, yaml["category"].as_str()),
        "name": name,
        "developers": yaml["author"].as_str().map(str::to_owned).or(owner),
        "devStatus": status_for(yaml["status"].as_str()),
        "abandoned": yaml["abandoned"].as_bool().unwrap_or(false),
        "takedown": yaml["takedown"].as_bool().unwrap_or(false),
        "forkOf": yaml["forkOf"]["label"].as_str(),
        "toolchain": yaml["toolchain"].as_str(),
        "homepage": yaml["homepage"].as_str(),
        "summary": es(&yaml["desc"]),
        "requirementsText": es(&yaml["requirements"]),
        "tags": yaml["tags"].clone(),
    }))
}

fn known_source_ids(conn: &Connection) -> Result<HashSet<String>> {
    let mut set = HashSet::new();
    let mut st = conn.prepare("SELECT json_extract(data, '$.sourceId') FROM projects WHERE json_extract(data, '$.sourceId') IS NOT NULL")?;
    for r in st.query_map([], |r| r.get::<_, String>(0))? {
        set.insert(r?);
    }
    let mut st = conn.prepare("SELECT json_extract(suggestion, '$.sourceId') FROM scan_candidates WHERE suggestion IS NOT NULL")?;
    for r in st.query_map([], |r| r.get::<_, Option<String>>(0))? {
        if let Some(s) = r? {
            set.insert(s);
        }
    }
    Ok(set)
}

fn repo_known(conn: &Connection, repo_url: &str) -> Result<bool> {
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

/// Sincroniza con Recompendium: las fichas nuevas pasan a la cola de revisión.
/// `max_new` limita cuántas fichas se descargan en una pasada (el resto queda para la siguiente).
pub fn sync_recompendium(conn: &Connection, f: &dyn Fetcher, max_new: usize) -> SyncSummary {
    let mut sum = SyncSummary::default();
    let tree = match http::cached_get(conn, f, RECOMPENDIUM_TREE) {
        Ok(r) if r.status == 200 => r,
        Ok(r) => {
            sum.errors.push(format!("lista de fichas: HTTP {}", r.status));
            return sum;
        }
        Err(e) => {
            sum.errors.push(format!("lista de fichas: {e}"));
            return sum;
        }
    };
    let tree: Value = serde_json::from_str(&tree.body).unwrap_or(Value::Null);
    let mut entries: Vec<String> = tree["tree"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| e["path"].as_str())
        .filter(|p| {
            ["src/data/recomps/", "src/data/ports/", "src/data/decomps/"].iter().any(|pre| p.starts_with(pre))
                && p.ends_with(".yaml")
                && p.matches('/').count() == 3
        })
        .map(str::to_owned)
        .collect();
    entries.sort();
    sum.entries = entries.len();

    let known = match known_source_ids(conn) {
        Ok(k) => k,
        Err(e) => {
            sum.errors.push(e.to_string());
            return sum;
        }
    };
    let new: Vec<(String, String)> = entries
        .iter()
        .map(|p| {
            let id = p.trim_start_matches("src/data/").trim_end_matches(".yaml").to_owned();
            (p.clone(), id)
        })
        .filter(|(_, id)| !known.contains(id))
        .collect();
    sum.already_known = entries.len() - new.len();
    if new.is_empty() {
        return sum;
    }

    let games: Value = match http::cached_get(conn, f, &format!("{RECOMPENDIUM_RAW}src/data/games.yaml")) {
        Ok(r) if r.status == 200 => serde_yaml_ng::from_str(&r.body).unwrap_or(Value::Null),
        _ => {
            sum.errors.push("no se pudo leer games.yaml".into());
            return sum;
        }
    };

    for (path, id) in new.iter().take(max_new) {
        let r = match f.get(&format!("{RECOMPENDIUM_RAW}{path}"), None) {
            Ok(r) if r.status == 200 => r,
            Ok(r) => {
                sum.errors.push(format!("{id}: HTTP {}", r.status));
                continue;
            }
            Err(e) => {
                sum.errors.push(format!("{id}: {e}"));
                continue;
            }
        };
        sum.fetched += 1;
        let yaml: Value = match serde_yaml_ng::from_str(&r.body) {
            Ok(v) => v,
            Err(e) => {
                sum.errors.push(format!("{id}: YAML no válido: {e}"));
                continue;
            }
        };
        let Some(sug) = suggestion_from_yaml(id, &yaml, &games) else { continue };
        let repo_url = sug["repoUrl"].as_str().unwrap_or_default().to_owned();
        if repo_known(conn, &repo_url).unwrap_or(true) {
            // Ya está (quizá con otro nombre de ficha): recordar la ficha para no volver a pedirla.
            let _ = conn.execute(
                "INSERT OR IGNORE INTO scan_candidates (repo_url, host, full_name, reason, status, source, suggestion)
                 VALUES (?1 || '#' || ?2, 'recompendium', ?2, 'Recompendium (ya en el catálogo)', 'rejected', 'recompendium', ?3)",
                params![repo_url, id, sug.to_string()],
            );
            continue;
        }
        let host = if repo_url.starts_with("https://github.com/") { "github" } else if repo_url.starts_with("https://gitlab.com/") { "gitlab" } else { "other" };
        let full = repo_url.splitn(4, '/').nth(3).unwrap_or(&repo_url).to_owned();
        let ins = conn.execute(
            "INSERT OR IGNORE INTO scan_candidates (repo_url, host, full_name, description, reason, source, suggestion)
             VALUES (?1, ?2, ?3, ?4, ?5, 'recompendium', ?6)",
            params![repo_url, host, full, sug["summary"].as_str(), format!("Recompendium · {}", sug["gameTitle"].as_str().unwrap_or("")), sug.to_string()],
        );
        match ins {
            Ok(n) => sum.new_candidates += n,
            Err(e) => sum.errors.push(e.to_string()),
        }
    }
    sum.remaining = new.len().saturating_sub(max_new);
    let _ = conn.execute(
        "INSERT INTO settings (key, value) VALUES ('last_recompendium_sync', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![time::now_iso()],
    );
    let _ = conn.execute(
        "INSERT INTO audit_log (action, detail) VALUES ('sync_recompendium', ?1)",
        params![serde_json::to_string(&sum).unwrap_or_default()],
    );
    sum
}

/// Búsquedas en GitLab que también alimentan la cola de revisión.
pub fn scan_gitlab(conn: &Connection, f: &dyn Fetcher) -> crate::scanner::ScanSummary {
    let mut sum = crate::scanner::ScanSummary::default();
    let queries = [
        ("search=recomp", "GitLab · «recomp»"),
        ("topic=recompilation", "GitLab · tema recompilation"),
        ("topic=decompilation", "GitLab · tema decompilation"),
        ("search=pc%20port", "GitLab · «pc port»"),
    ];
    for (q, reason) in queries {
        sum.queries += 1;
        let url = format!("https://gitlab.com/api/v4/projects?{q}&order_by=last_activity_at&sort=desc&per_page=40&simple=true");
        let resp = match http::cached_get(conn, f, &url) {
            Ok(r) if r.status == 200 => r,
            Ok(r) => {
                sum.errors.push(format!("{reason}: HTTP {}", r.status));
                continue;
            }
            Err(e) => {
                sum.errors.push(format!("{reason}: {e}"));
                continue;
            }
        };
        let items: Value = serde_json::from_str(&resp.body).unwrap_or(Value::Null);
        for it in items.as_array().into_iter().flatten() {
            sum.seen += 1;
            let Some(url) = it["web_url"].as_str() else { continue };
            if repo_known(conn, url).unwrap_or(true) {
                sum.already_known += 1;
                continue;
            }
            let ins = conn.execute(
                "INSERT OR IGNORE INTO scan_candidates (repo_url, host, full_name, description, stars, created_at, pushed_at, is_fork, archived, reason, source)
                 VALUES (?1, 'gitlab', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'gitlab-search')",
                params![
                    url,
                    it["path_with_namespace"].as_str(),
                    it["description"].as_str(),
                    it["star_count"].as_i64(),
                    it["created_at"].as_str(),
                    it["last_activity_at"].as_str(),
                    it.get("forked_from_project").is_some_and(|v| !v.is_null()),
                    it["archived"].as_bool(),
                    reason,
                ],
            );
            match ins {
                Ok(n) => sum.new_candidates += n,
                Err(e) => sum.errors.push(e.to_string()),
            }
        }
    }
    sum
}

/// Aprueba un candidato que trae datos sugeridos (Recompendium): crea juego y proyecto locales.
pub fn approve_suggested(conn: &mut Connection, id: i64) -> Result<String> {
    let (sug, status): (Option<String>, String) = conn
        .query_row("SELECT suggestion, status FROM scan_candidates WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("candidato {id}")))?;
    if status != "new" {
        return Err(Error::Invalid("el candidato ya está revisado".into()));
    }
    let s: Value = serde_json::from_str(&sug.ok_or_else(|| Error::Invalid("este candidato no trae datos sugeridos".into()))?)?;
    let tx = conn.transaction()?;
    let mut platform = s["platform"].as_str().unwrap_or("other").to_owned();
    if tx.query_row("SELECT 1 FROM platforms WHERE slug = ?1", params![platform], |_| Ok(())).optional()?.is_none() {
        platform = "other".into();
    }
    let game = s["game"].as_str().unwrap_or_default().to_owned();
    let title = s["gameTitle"].as_str().unwrap_or(&game).to_owned();
    if tx.query_row("SELECT 1 FROM games WHERE slug = ?1", params![game], |_| Ok(())).optional()?.is_none() {
        tx.execute(
            "INSERT INTO games (slug, title, platform, year, igdb, search, origin) VALUES (?1, ?2, ?3, ?4, NULL, ?5, 'local')",
            params![game, title, platform, s["gameYear"].as_i64(), fold(&title)],
        )?;
    }
    let repo_url = s["repoUrl"].as_str().unwrap_or_default().to_owned();
    let path = repo_url.splitn(4, '/').nth(3).unwrap_or_default().to_owned();
    let (owner, repo) = path.split_once('/').map(|(a, b)| (a.to_owned(), b.to_owned())).unwrap_or((path.clone(), path.clone()));
    let host = match repo_url.split('/').nth(2) {
        Some("github.com") => "github",
        Some("gitlab.com") => "gitlab",
        Some(h) => h,
        None => "other",
    }
    .to_owned();
    let base_slug = fold(&path.replace('/', " ")).replace(' ', "-");
    let mut slug = base_slug.clone();
    let mut n = 2;
    while tx.query_row("SELECT 1 FROM projects WHERE slug = ?1", params![slug], |_| Ok(())).optional()?.is_some() {
        slug = format!("{base_slug}-{n}");
        n += 1;
    }
    let name = s["name"].as_str().unwrap_or(&repo).to_owned();
    let takedown = s["takedown"].as_bool().unwrap_or(false);
    let data = json!({
        "slug": slug, "sourceId": s["sourceId"], "game": game, "gameTitle": title, "games": [game], "platform": platform,
        "name": name, "developers": s["developers"], "kind": s["kind"], "devStatus": s["devStatus"],
        "abandoned": s["abandoned"], "takedown": takedown, "forkOf": s["forkOf"], "toolchain": s["toolchain"],
        "repo": {"host": host, "owner": owner, "name": repo}, "repoUrl": repo_url, "repoMovedFrom": null, "homepage": s["homepage"],
        "repoExists": null, "release": null, "windowsAsset": null, "hasWindowsExecutable": null, "listing": "in_development",
        "summary": s["summary"], "requirementsText": s["requirementsText"], "requirements": null, "tags": s["tags"],
        "adapter": null, "stars": null, "createdAt": null, "pushedAt": null, "license": null,
        "source": "Recompendium (sincronizado y aprobado)", "checkedAt": null,
    });
    tx.execute(
        "INSERT INTO projects (slug, game, platform, name, developers, kind, dev_status, listing, has_windows_exe,
            takedown, abandoned, repo_url, search, data, origin)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'in_development', NULL, ?8, ?9, ?10, ?11, ?12, 'local')",
        params![
            slug, game, platform, name, s["developers"].as_str(), s["kind"].as_str(), s["devStatus"].as_str(),
            takedown, s["abandoned"].as_bool().unwrap_or(false), repo_url,
            fold(&format!("{name} {} {repo}", s["developers"].as_str().unwrap_or(""))), data.to_string()
        ],
    )?;
    tx.execute("INSERT INTO project_games (project, game) VALUES (?1, ?2)", params![slug, game])?;
    tx.execute(
        "UPDATE scan_candidates SET status = 'approved', reviewed_at = datetime('now'), project_slug = ?2 WHERE id = ?1",
        params![id, slug],
    )?;
    tx.execute("INSERT INTO audit_log (action, subject, detail) VALUES ('candidate_approve', ?1, ?2)", params![slug, repo_url])?;
    tx.commit()?;
    Ok(slug)
}

/// Aprueba en bloque los candidatos pendientes con datos sugeridos de una fuente.
pub fn approve_all_suggested(conn: &mut Connection, source: &str) -> Result<Vec<String>> {
    let ids: Vec<i64> = {
        let mut st = conn.prepare("SELECT id FROM scan_candidates WHERE status = 'new' AND source = ?1 AND suggestion IS NOT NULL ORDER BY id")?;
        st.query_map(params![source], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
    };
    let mut out = Vec::new();
    for id in ids {
        out.push(approve_suggested(conn, id)?);
    }
    Ok(out)
}

/// Recuento de candidatos por fuente y estado, para las pestañas de la cola.
pub fn counts_by_source(conn: &Connection) -> Result<Value> {
    let mut st = conn.prepare("SELECT source, status, COUNT(*) FROM scan_candidates WHERE repo_url NOT LIKE '%#%' GROUP BY source, status")?;
    let mut out: HashMap<String, HashMap<String, i64>> = HashMap::new();
    for r in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
        let (src, status, n) = r?;
        *out.entry(src).or_default().entry(status).or_default() += n;
    }
    Ok(serde_json::to_value(out)?)
}
