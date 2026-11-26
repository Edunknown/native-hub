// NATIVE HUB · arranque de la aplicación de escritorio.
// Fase 2: base de datos SQLite en la carpeta de datos de la app y catálogo incluido en el
// ejecutable, que se importa cuando cambia de versión. Los comandos solo leen el catálogo.

use std::sync::Mutex;

use native_hub_core::{Result, catalog, db, query};
use rusqlite::Connection;
use serde_json::Value;
use tauri::{Manager, State};

/// Catálogo generado por scripts/build-catalog.mjs, incluido al compilar.
const CATALOG_JSON: &str = include_str!("../../catalog/catalog.json");
const FEATURED_GAME: &str = "the-legend-of-zelda-majoras-mask";

struct Db(Mutex<Connection>);

impl Db {
    fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let conn = self.0.lock().expect("base de datos bloqueada");
        f(&conn)
    }
}

#[tauri::command]
fn catalog_summary(db: State<Db>) -> Result<Value> {
    db.with(query::summary)
}

#[tauri::command]
fn catalog_platforms(db: State<Db>) -> Result<Vec<Value>> {
    db.with(query::platforms)
}

#[tauri::command]
fn catalog_platform_projects(db: State<Db>, platform: String) -> Result<Vec<Value>> {
    db.with(|c| query::platform_projects(c, &platform))
}

#[tauri::command]
fn catalog_game(db: State<Db>, slug: String) -> Result<Value> {
    db.with(|c| query::game(c, &slug))
}

#[tauri::command]
fn catalog_games(db: State<Db>, slugs: Vec<String>) -> Result<Vec<Value>> {
    db.with(|c| query::games_by_slugs(c, &slugs))
}

#[tauri::command]
fn catalog_search(db: State<Db>, q: String, limit: Option<i64>) -> Result<Vec<Value>> {
    db.with(|c| query::search(c, &q, limit.unwrap_or(100)))
}

#[tauri::command]
fn catalog_discover(
    db: State<Db>,
    listing: Option<String>,
    kind: Option<String>,
    platform: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Value> {
    db.with(|c| {
        query::discover(
            c,
            &query::DiscoverFilter {
                listing: listing.as_deref(),
                kind: kind.as_deref(),
                platform: platform.as_deref(),
                offset: offset.unwrap_or(0),
                limit: limit.unwrap_or(100),
            },
        )
    })
}

#[tauri::command]
fn catalog_home(db: State<Db>) -> Result<Value> {
    db.with(|c| query::home(c, FEATURED_GAME))
}

fn open_database(app: &tauri::App) -> std::result::Result<Connection, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let mut conn = db::open(&dir.join("native-hub.db"))?;
    let cat = catalog::parse(CATALOG_JSON)?;
    if catalog::import_if_newer(&mut conn, &cat)? {
        log::info!("catálogo {} importado ({} proyectos)", cat.generated_at, cat.projects.len());
    }
    Ok(conn)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let conn = open_database(app)?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog_summary,
            catalog_platforms,
            catalog_platform_projects,
            catalog_game,
            catalog_games,
            catalog_search,
            catalog_discover,
            catalog_home,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar NATIVE HUB");
}
