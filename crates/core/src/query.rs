//! Consultas que usa la interfaz. Devuelven JSON con la misma forma que los tipos de
//! src/lib/types.ts.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::{Value, json};

use crate::{Error, Result, catalog, text::fold};

fn project_data(row: &Row) -> rusqlite::Result<Value> {
    let data: String = row.get("data")?;
    let mut v: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
    // La portada es la del juego principal: así también la tienen los proyectos aprobados
    // a mano y siempre refleja el catálogo cargado.
    if let Value::Object(m) = &mut v {
        m.insert("cover".into(), json!(row.get::<_, Option<String>>("cover")?));
    }
    Ok(v)
}

const COVER: &str = "(SELECT cover FROM games WHERE games.slug = projects.game) AS cover";

fn game_json(row: &Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "slug": row.get::<_, String>("slug")?,
        "title": row.get::<_, String>("title")?,
        "platform": row.get::<_, String>("platform")?,
        "year": row.get::<_, Option<i64>>("year")?,
        "cover": row.get::<_, Option<String>>("cover")?,
    }))
}

fn projects_where(conn: &Connection, sql_where: &str, p: impl rusqlite::Params) -> Result<Vec<Value>> {
    let sql = format!("SELECT data, {COVER} FROM projects {sql_where}");
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(p, project_data)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn summary(conn: &Connection) -> Result<Value> {
    let (projects, installable, games): (i64, i64, i64) = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM projects),
                (SELECT COUNT(*) FROM projects WHERE listing = 'library'),
                (SELECT COUNT(*) FROM games)",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let sources: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'catalog_sources'", [], |r| r.get(0))
        .optional()?;
    let families: Vec<String> = {
        let mut st = conn.prepare("SELECT family FROM platforms GROUP BY family ORDER BY MIN(sort)")?;
        st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
    };
    Ok(json!({
        "generatedAt": catalog::loaded_version(conn)?,
        "sources": sources.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
        "projectCount": projects,
        "installableCount": installable,
        "gameCount": games,
        "families": families,
        "schemaVersion": crate::db::schema_version(conn)?,
    }))
}

pub fn platforms(conn: &Connection) -> Result<Vec<Value>> {
    let mut st = conn.prepare(
        "SELECT p.slug, p.name, p.short, p.family,
                COUNT(pr.slug) AS total,
                COALESCE(SUM(pr.listing = 'library'), 0) AS installable
         FROM platforms p LEFT JOIN projects pr ON pr.platform = p.slug
         GROUP BY p.slug ORDER BY p.sort",
    )?;
    let rows = st.query_map([], |r| {
        Ok(json!({
            "slug": r.get::<_, String>(0)?,
            "name": r.get::<_, String>(1)?,
            "short": r.get::<_, Option<String>>(2)?,
            "family": r.get::<_, String>(3)?,
            "projectCount": r.get::<_, i64>(4)?,
            "installableCount": r.get::<_, i64>(5)?,
        }))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Un juego con todas sus implementaciones, instalables primero.
pub fn game(conn: &Connection, slug: &str) -> Result<Value> {
    let game = conn
        .query_row("SELECT * FROM games WHERE slug = ?1", params![slug], game_json)
        .optional()?
        .ok_or_else(|| Error::NotFound(crate::t!("juego {slug}", "game {slug}")))?;
    let projects = projects_where(
        conn,
        "WHERE slug IN (SELECT project FROM project_games WHERE game = ?1)
         ORDER BY listing = 'library' DESC, takedown, COALESCE(stars, 0) DESC, name",
        params![slug],
    )?;
    Ok(json!({ "game": game, "projects": projects }))
}

/// Proyectos de una plataforma agrupados por juego.
pub fn platform_projects(conn: &Connection, platform: &str) -> Result<Vec<Value>> {
    projects_where(
        conn,
        "WHERE platform = ?1 ORDER BY listing = 'library' DESC, COALESCE(stars, 0) DESC, name",
        params![platform],
    )
}

pub fn search(conn: &Connection, q: &str, limit: i64) -> Result<Vec<Value>> {
    let terms: Vec<String> = fold(q).split(' ').filter(|t| !t.is_empty()).map(|t| format!("%{t}%")).collect();
    if terms.is_empty() {
        return Ok(vec![]);
    }
    // Cada término debe aparecer en el título del juego, en el proyecto o en el nombre de la plataforma.
    let mut clauses = Vec::new();
    for i in 1..=terms.len() {
        clauses.push(format!(
            "(g.search LIKE ?{i} OR pr.search LIKE ?{i} OR LOWER(pl.name) LIKE ?{i} OR LOWER(COALESCE(pl.short, '')) LIKE ?{i})"
        ));
    }
    let sql = format!(
        "SELECT pr.data, g.cover FROM projects pr
         JOIN games g ON g.slug = pr.game JOIN platforms pl ON pl.slug = pr.platform
         WHERE {}
         ORDER BY pr.listing = 'library' DESC, COALESCE(pr.stars, 0) DESC LIMIT {}",
        clauses.join(" AND "),
        limit.clamp(1, 500)
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(rusqlite::params_from_iter(terms.iter()), project_data)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Filters and sort order of the catalog browser (Discover and Search). Every field is
/// optional; the interface sends them as camelCase JSON.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscoverFilter {
    /// Free text: every word must appear in the game, the project, its developers or the console.
    pub q: Option<String>,
    pub listing: Option<String>,
    pub kind: Option<String>,
    pub platform: Option<String>,
    /// Console family (Nintendo, PlayStation…).
    pub family: Option<String>,
    /// Development status (complete, stable, playable, beta, experimental, unknown); any of them.
    pub status: Vec<String>,
    /// Hide abandoned projects and those taken down.
    pub hide_inactive: bool,
    /// relevance (default with text) | title (default without) | updated | newest | stars
    pub sort: Option<String>,
    pub offset: i64,
    pub limit: i64,
}

const STATUSES: &[&str] = &["complete", "stable", "playable", "beta", "experimental", "unknown"];

pub fn discover(conn: &Connection, f: &DiscoverFilter) -> Result<Value> {
    let mut clauses: Vec<String> = Vec::new();
    let mut args: Vec<String> = Vec::new();
    let terms: Vec<String> = f.q.as_deref().map(fold).unwrap_or_default().split(' ').filter(|t| !t.is_empty()).map(|t| format!("%{t}%")).collect();
    for t in &terms {
        args.push(t.clone());
        let n = args.len();
        clauses.push(format!(
            "(g.search LIKE ?{n} OR pr.search LIKE ?{n} OR LOWER(pl.name) LIKE ?{n} OR LOWER(COALESCE(pl.short, '')) LIKE ?{n})"
        ));
    }
    for (column, value) in [("pr.listing", &f.listing), ("pr.kind", &f.kind), ("pr.platform", &f.platform), ("pl.family", &f.family)] {
        if let Some(v) = value.as_deref().filter(|v| !v.is_empty()) {
            args.push(v.to_owned());
            clauses.push(format!("{column} = ?{}", args.len()));
        }
    }
    let status: Vec<&str> = f.status.iter().map(String::as_str).filter(|s| STATUSES.contains(s)).collect();
    if !status.is_empty() {
        // Only known values reach the SQL text, so they can be inlined safely.
        let list = status.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(", ");
        let unknown = if status.contains(&"unknown") { " OR pr.dev_status IS NULL" } else { "" };
        clauses.push(format!("(pr.dev_status IN ({list}){unknown})"));
    }
    if f.hide_inactive {
        clauses.push("pr.abandoned = 0 AND pr.takedown = 0".into());
    }
    let w = if clauses.is_empty() { String::new() } else { format!("WHERE {}", clauses.join(" AND ")) };
    let from = "FROM projects pr JOIN games g ON g.slug = pr.game JOIN platforms pl ON pl.slug = pr.platform";
    let sort = f.sort.as_deref().unwrap_or(if terms.is_empty() { "title" } else { "relevance" });
    let order = match sort {
        "updated" => "pr.release_published_at IS NULL, pr.release_published_at DESC, g.title",
        "newest" => "pr.created_at IS NULL, pr.created_at DESC, g.title",
        "stars" => "COALESCE(pr.stars, 0) DESC, g.title",
        "relevance" => "pr.listing = 'library' DESC, pr.takedown ASC, COALESCE(pr.stars, 0) DESC, g.title",
        _ => "g.title, pr.name",
    };
    let total: i64 = conn.query_row(&format!("SELECT COUNT(*) {from} {w}"), rusqlite::params_from_iter(args.iter()), |r| r.get(0))?;
    let limit = if f.limit <= 0 { 100 } else { f.limit.clamp(1, 500) };
    let mut st = conn.prepare(&format!("SELECT pr.data, g.cover {from} {w} ORDER BY {order} LIMIT {limit} OFFSET {}", f.offset.max(0)))?;
    let items = st.query_map(rusqlite::params_from_iter(args.iter()), project_data)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!({ "total": total, "items": items }))
}

/// Datos de la pantalla de inicio.
pub fn home(conn: &Connection, featured_game: &str) -> Result<Value> {
    let updated = projects_where(
        conn,
        "WHERE listing = 'library' AND release_published_at IS NOT NULL ORDER BY release_published_at DESC LIMIT 6",
        [],
    )?;
    let newest = projects_where(
        conn,
        "WHERE created_at IS NOT NULL AND takedown = 0 ORDER BY created_at DESC LIMIT 6",
        [],
    )?;
    let featured = game(conn, featured_game).ok();
    Ok(json!({ "featured": featured, "updated": updated, "newest": newest }))
}

/// Mapa slug → juego, para que la interfaz ponga título a cada proyecto sin pedirlos uno a uno.
pub fn games_by_slugs(conn: &Connection, slugs: &[String]) -> Result<Vec<Value>> {
    let mut out = Vec::with_capacity(slugs.len());
    let mut st = conn.prepare("SELECT * FROM games WHERE slug = ?1")?;
    for s in slugs {
        if let Some(g) = st.query_row(params![s], game_json).optional()? {
            out.push(g);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{catalog, db};

    const FIXTURE: &str = r#"{
      "generatedAt": "2026-11-26T00:00:00Z",
      "sources": [],
      "families": ["Nintendo", "PlayStation"],
      "platforms": [
        {"slug": "n64", "name": "Nintendo 64", "short": "N64", "family": "Nintendo"},
        {"slug": "switch2", "name": "Nintendo Switch 2", "short": "NS2", "family": "Nintendo"},
        {"slug": "ps4", "name": "PlayStation 4", "short": "PS4", "family": "PlayStation"}
      ],
      "games": [
        {"slug": "mm", "title": "The Legend of Zelda: Majora’s Mask", "platform": "n64", "year": 2000, "cover": "co3pah"},
        {"slug": "pokopia", "title": "Pokémon Pokopia", "platform": "switch2", "year": 2026}
      ],
      "projects": [
        {"slug": "a", "game": "mm", "games": ["mm"], "platform": "n64", "name": "2 Ship 2 Harkinian", "developers": "HarbourMasters",
         "kind": "decomp_port", "listing": "library", "hasWindowsExecutable": true, "repoUrl": "https://github.com/x/a",
         "release": {"tag": "5.0.1", "publishedAt": "2026-08-25T00:00:00Z"}, "stars": 10, "createdAt": "2024-01-01T00:00:00Z"},
        {"slug": "b", "game": "mm", "games": ["mm"], "platform": "n64", "name": "Zelda64Recomp", "developers": "Wiseguy",
         "kind": "static_recomp", "listing": "library", "hasWindowsExecutable": true, "repoUrl": "https://github.com/x/b",
         "release": {"tag": "v1.2.2", "publishedAt": "2025-08-27T00:00:00Z"}, "stars": 99},
        {"slug": "c", "game": "pokopia", "games": ["pokopia"], "platform": "switch2", "name": "Recompia", "developers": "someone",
         "kind": "static_recomp", "listing": "in_development", "hasWindowsExecutable": false, "repoUrl": "https://github.com/x/c",
         "release": null, "createdAt": "2026-10-01T00:00:00Z"}
      ]
    }"#;

    fn setup() -> Connection {
        let mut conn = db::open_in_memory().unwrap();
        let cat = catalog::parse(FIXTURE).unwrap();
        assert!(catalog::import_if_newer(&mut conn, &cat).unwrap());
        assert!(!catalog::import_if_newer(&mut conn, &cat).unwrap(), "no reimporta la misma versión");
        conn
    }

    #[test]
    fn migraciones_y_resumen() {
        let conn = setup();
        let s = summary(&conn).unwrap();
        assert_eq!(s["projectCount"], 3);
        assert_eq!(s["installableCount"], 2);
        assert_eq!(s["schemaVersion"], 5);
    }

    #[test]
    fn plataformas_con_recuento() {
        let conn = setup();
        let p = platforms(&conn).unwrap();
        let n64 = p.iter().find(|x| x["slug"] == "n64").unwrap();
        assert_eq!(n64["projectCount"], 2);
        assert_eq!(n64["installableCount"], 2);
        let ps4 = p.iter().find(|x| x["slug"] == "ps4").unwrap();
        assert_eq!(ps4["projectCount"], 0);
    }

    #[test]
    fn ficha_de_juego_ordena_por_instalable_y_estrellas() {
        let conn = setup();
        let g = game(&conn, "mm").unwrap();
        let names: Vec<_> = g["projects"].as_array().unwrap().iter().map(|p| p["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["Zelda64Recomp", "2 Ship 2 Harkinian"]);
        assert!(game(&conn, "no-existe").is_err());
    }

    #[test]
    fn portada_del_juego_en_ficha_y_proyectos() {
        let conn = setup();
        let g = game(&conn, "mm").unwrap();
        assert_eq!(g["game"]["cover"], "co3pah");
        assert!(g["projects"].as_array().unwrap().iter().all(|p| p["cover"] == "co3pah"));
        assert_eq!(search(&conn, "pokemon", 10).unwrap()[0]["cover"], Value::Null);
        let r = discover(&conn, &DiscoverFilter { listing: Some("library".into()), limit: 5, ..Default::default() }).unwrap();
        assert_eq!(r["items"][0]["cover"], "co3pah");
    }

    #[test]
    fn busqueda_sin_tildes_y_por_plataforma() {
        let conn = setup();
        assert_eq!(search(&conn, "pokemon", 10).unwrap().len(), 1);
        assert_eq!(search(&conn, "majoras", 10).unwrap().len(), 2);
        assert_eq!(search(&conn, "switch 2 recompia", 10).unwrap().len(), 1);
        assert_eq!(search(&conn, "harbour", 10).unwrap().len(), 1);
        assert!(search(&conn, "   ", 10).unwrap().is_empty());
    }

    #[test]
    fn descubrir_filtra_y_pagina() {
        let conn = setup();
        let r = discover(&conn, &DiscoverFilter { listing: Some("library".into()), limit: 1, ..Default::default() }).unwrap();
        assert_eq!(r["total"], 2);
        assert_eq!(r["items"].as_array().unwrap().len(), 1);
        let r = discover(&conn, &DiscoverFilter { kind: Some("static_recomp".into()), platform: Some("switch2".into()), limit: 50, ..Default::default() }).unwrap();
        assert_eq!(r["total"], 1);
    }

    #[test]
    fn descubrir_con_texto_familia_estado_y_orden() {
        let conn = setup();
        let all = |f: DiscoverFilter| discover(&conn, &DiscoverFilter { limit: 50, ..f }).unwrap();
        // Text works like search and combines with the other filters.
        let r = all(DiscoverFilter { q: Some("majora".into()), ..Default::default() });
        assert_eq!(r["total"], 2);
        let r = all(DiscoverFilter { q: Some("majora recomp".into()), ..Default::default() });
        assert_eq!(r["items"][0]["slug"], "b");
        let r = all(DiscoverFilter { q: Some("majora".into()), listing: Some("in_development".into()), ..Default::default() });
        assert_eq!(r["total"], 0);
        let r = all(DiscoverFilter { family: Some("Nintendo".into()), ..Default::default() });
        let total_nintendo = r["total"].as_i64().unwrap();
        let r = all(DiscoverFilter { family: Some("PlayStation".into()), ..Default::default() });
        assert!(total_nintendo > 0 && r["total"].as_i64().unwrap() + total_nintendo == discover(&conn, &DiscoverFilter::default()).unwrap()["total"].as_i64().unwrap());
        // Unknown statuses are ignored instead of reaching the SQL.
        let r = all(DiscoverFilter { status: vec!["x'); DROP TABLE projects; --".into()], ..Default::default() });
        assert_eq!(r["total"], discover(&conn, &DiscoverFilter::default()).unwrap()["total"]);
        for sort in ["title", "updated", "newest", "stars", "relevance", "bogus"] {
            all(DiscoverFilter { sort: Some(sort.into()), ..Default::default() });
        }
    }

    #[test]
    fn inicio() {
        let conn = setup();
        let h = home(&conn, "mm").unwrap();
        assert_eq!(h["updated"][0]["slug"], "a");
        assert_eq!(h["newest"][0]["slug"], "c");
        assert_eq!(h["featured"]["game"]["slug"], "mm");
    }
}
