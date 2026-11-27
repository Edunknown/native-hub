//! Consultas que usa la interfaz. Devuelven JSON con la misma forma que los tipos de
//! src/lib/types.ts.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::{Value, json};

use crate::{Error, Result, catalog, text::fold};

fn project_data(row: &Row) -> rusqlite::Result<Value> {
    let data: String = row.get("data")?;
    Ok(serde_json::from_str(&data).unwrap_or(Value::Null))
}

fn game_json(row: &Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "slug": row.get::<_, String>("slug")?,
        "title": row.get::<_, String>("title")?,
        "platform": row.get::<_, String>("platform")?,
        "year": row.get::<_, Option<i64>>("year")?,
    }))
}

fn projects_where(conn: &Connection, sql_where: &str, p: impl rusqlite::Params) -> Result<Vec<Value>> {
    let sql = format!("SELECT data FROM projects {sql_where}");
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
        .ok_or_else(|| Error::NotFound(format!("juego {slug}")))?;
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
        "SELECT pr.data FROM projects pr
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

pub struct DiscoverFilter<'a> {
    pub listing: Option<&'a str>,
    pub kind: Option<&'a str>,
    pub platform: Option<&'a str>,
    pub offset: i64,
    pub limit: i64,
}

pub fn discover(conn: &Connection, f: &DiscoverFilter) -> Result<Value> {
    let w = "WHERE (?1 IS NULL OR pr.listing = ?1) AND (?2 IS NULL OR pr.kind = ?2) AND (?3 IS NULL OR pr.platform = ?3)";
    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM projects pr {w}"),
        params![f.listing, f.kind, f.platform],
        |r| r.get(0),
    )?;
    let mut st = conn.prepare(&format!(
        "SELECT pr.data FROM projects pr JOIN games g ON g.slug = pr.game {w}
         ORDER BY g.title, pr.name LIMIT ?4 OFFSET ?5"
    ))?;
    let items = st
        .query_map(params![f.listing, f.kind, f.platform, f.limit.clamp(1, 500), f.offset.max(0)], project_data)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
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
        {"slug": "mm", "title": "The Legend of Zelda: Majora’s Mask", "platform": "n64", "year": 2000},
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
        assert_eq!(s["schemaVersion"], 4);
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
        let r = discover(&conn, &DiscoverFilter { listing: Some("library"), kind: None, platform: None, offset: 0, limit: 1 }).unwrap();
        assert_eq!(r["total"], 2);
        assert_eq!(r["items"].as_array().unwrap().len(), 1);
        let r = discover(&conn, &DiscoverFilter { listing: None, kind: Some("static_recomp"), platform: Some("switch2"), offset: 0, limit: 50 }).unwrap();
        assert_eq!(r["total"], 1);
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
