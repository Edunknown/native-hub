// NATIVE HUB · arranque de la aplicación de escritorio.
//
// Fase 2: base de datos SQLite en la carpeta de datos de la app y catálogo incluido en el
// ejecutable, que se importa cuando cambia de versión.
// Fase 3: comprobación de releases en vivo, escáner de repositorios con cola de revisión y
// token de GitHub opcional guardado en el Administrador de credenciales de Windows.

mod token;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use native_hub_core::http::UreqFetcher;
use native_hub_core::{Error, Result, catalog, db, query, releases, scanner};
use rusqlite::Connection;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

/// Catálogo generado por scripts/build-catalog.mjs, incluido al compilar.
const CATALOG_JSON: &str = include_str!("../../catalog/catalog.json");
const FEATURED_GAME: &str = "the-legend-of-zelda-majoras-mask";
/// Al arrancar se comprueban en segundo plano unos pocos proyectos, para no gastar la cuota.
const STARTUP_REFRESH: i64 = 20;

struct AppState {
    /// Conexión para las consultas de la interfaz.
    db: Mutex<Connection>,
    /// Los trabajos largos abren su propia conexión (SQLite en modo WAL) para no bloquear la interfaz.
    db_path: PathBuf,
    fetcher: RwLock<Arc<UreqFetcher>>,
    busy: AtomicBool,
    cancel: Arc<AtomicBool>,
}

impl AppState {
    fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let conn = self.db.lock().expect("base de datos bloqueada");
        f(&conn)
    }
    fn with_mut<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut conn = self.db.lock().expect("base de datos bloqueada");
        f(&mut conn)
    }
    fn fetcher(&self) -> Arc<UreqFetcher> {
        self.fetcher.read().expect("fetcher").clone()
    }
    fn job_conn(&self) -> Result<Connection> {
        db::open(&self.db_path)
    }
}

// ---------- Catálogo (fase 2) ----------

#[tauri::command]
fn catalog_summary(s: State<AppState>) -> Result<Value> {
    s.with(query::summary)
}

#[tauri::command]
fn catalog_platforms(s: State<AppState>) -> Result<Vec<Value>> {
    s.with(query::platforms)
}

#[tauri::command]
fn catalog_platform_projects(s: State<AppState>, platform: String) -> Result<Vec<Value>> {
    s.with(|c| query::platform_projects(c, &platform))
}

#[tauri::command]
fn catalog_game(s: State<AppState>, slug: String) -> Result<Value> {
    s.with(|c| query::game(c, &slug))
}

#[tauri::command]
fn catalog_search(s: State<AppState>, q: String, limit: Option<i64>) -> Result<Vec<Value>> {
    s.with(|c| query::search(c, &q, limit.unwrap_or(100)))
}

#[tauri::command]
fn catalog_discover(
    s: State<AppState>,
    listing: Option<String>,
    kind: Option<String>,
    platform: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Value> {
    s.with(|c| {
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
fn catalog_home(s: State<AppState>) -> Result<Value> {
    s.with(|c| query::home(c, FEATURED_GAME))
}

#[tauri::command]
fn catalog_games_lookup(s: State<AppState>, q: String) -> Result<Vec<Value>> {
    // Para el formulario de aprobación: juegos cuyo título coincide.
    s.with(|c| {
        let mut st = c.prepare("SELECT slug, title, platform FROM games WHERE search LIKE ?1 ORDER BY title LIMIT 20")?;
        let like = format!("%{}%", native_hub_core::text::fold(&q));
        let rows = st.query_map([like], |r| {
            Ok(json!({"slug": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)?, "platform": r.get::<_, String>(2)?}))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    })
}

// ---------- Releases en vivo (fase 3) ----------

#[tauri::command]
fn releases_status(s: State<AppState>) -> Result<Value> {
    let mut v = s.with(releases::status)?;
    v["busy"] = json!(s.busy.load(Ordering::Relaxed));
    v["tokenConfigured"] = json!(token::get().is_some());
    Ok(v)
}

#[tauri::command]
async fn refresh_project(app: AppHandle, slug: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        let conn = s.job_conn()?;
        let out = releases::refresh_project(&conn, s.fetcher().as_ref(), &slug)?;
        let game = s.with(|c| query::game(c, &conn.query_row("SELECT game FROM projects WHERE slug = ?1", [&slug], |r| r.get::<_, String>(0))?))?;
        Ok(json!({ "outcome": out, "detail": game }))
    })
    .await
    .map_err(|e| Error::Invalid(e.to_string()))?
}

fn start_job(app: &AppHandle, name: &'static str, job: impl FnOnce(&AppHandle, &AppState, &Connection) -> Value + Send + 'static) -> Result<bool> {
    let s = app.state::<AppState>();
    if s.busy.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    s.cancel.store(false, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        let s = app.state::<AppState>();
        let result = match s.job_conn() {
            Ok(conn) => job(&app, &s, &conn),
            Err(e) => json!({ "error": e.to_string() }),
        };
        s.busy.store(false, Ordering::SeqCst);
        let _ = app.emit("job-finished", json!({ "job": name, "result": result }));
    });
    Ok(true)
}

#[tauri::command]
fn refresh_stale(app: AppHandle, max_age_hours: Option<i64>, limit: Option<i64>) -> Result<bool> {
    let max_age = max_age_hours.unwrap_or(24);
    let limit = limit.unwrap_or(200);
    start_job(&app, "refresh", move |app, s, conn| {
        let items = match releases::stale_projects(conn, max_age, limit) {
            Ok(i) => i,
            Err(e) => return json!({ "error": e.to_string() }),
        };
        let sum = releases::refresh_batch(conn, s.fetcher().as_ref(), &items, &s.cancel, |done, total, slug| {
            let _ = app.emit("job-progress", json!({ "job": "refresh", "done": done, "total": total, "current": slug }));
        });
        serde_json::to_value(sum).unwrap_or(Value::Null)
    })
}

#[tauri::command]
fn cancel_job(s: State<AppState>) {
    s.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn update_events(s: State<AppState>, limit: Option<i64>) -> Result<Vec<Value>> {
    s.with(|c| releases::update_events(c, limit.unwrap_or(100)))
}

#[tauri::command]
fn mark_events_seen(s: State<AppState>) -> Result<usize> {
    s.with(releases::mark_events_seen)
}

// ---------- Escáner y cola de revisión (fase 3) ----------

#[tauri::command]
fn scan_repositories(app: AppHandle) -> Result<bool> {
    start_job(&app, "scan", |app, s, conn| {
        let fetcher = s.fetcher();
        let _ = app.emit("job-progress", json!({ "job": "scan", "done": 0, "total": 2, "current": "búsqueda" }));
        let sum = scanner::scan(conn, fetcher.as_ref(), &scanner::default_queries(native_hub_core::time::now_unix()));
        let _ = app.emit("job-progress", json!({ "job": "scan", "done": 1, "total": 2, "current": "releases de los candidatos" }));
        let probed = scanner::probe_candidates(conn, fetcher.as_ref(), 30).unwrap_or(0);
        json!({ "scan": sum, "probed": probed })
    })
}

#[tauri::command]
fn candidates(s: State<AppState>, status: Option<String>, limit: Option<i64>) -> Result<Value> {
    s.with(|c| {
        Ok(json!({
            "items": scanner::list_candidates(c, status.as_deref().unwrap_or("new"), limit.unwrap_or(200))?,
            "counts": scanner::candidate_counts(c)?,
        }))
    })
}

#[tauri::command]
async fn approve_candidate(app: AppHandle, approval: scanner::Approval) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        let slug = s.with_mut(|c| scanner::approve(c, &approval))?;
        // Comprobar enseguida su release para saber si es instalable.
        if let Ok(conn) = s.job_conn() {
            let _ = releases::refresh_project(&conn, s.fetcher().as_ref(), &slug);
        }
        Ok(slug)
    })
    .await
    .map_err(|e| Error::Invalid(e.to_string()))?
}

#[tauri::command]
fn reject_candidate(s: State<AppState>, id: i64) -> Result<()> {
    s.with(|c| scanner::reject(c, id))
}

// ---------- Token de GitHub ----------

#[tauri::command]
async fn set_github_token(app: AppHandle, value: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let value = value.trim().to_owned();
        token::validate_format(&value)?;
        // Probar el token antes de guardarlo: /rate_limit no gasta cuota.
        let probe = UreqFetcher::new(Some(value.clone()));
        let r = native_hub_core::http::Fetcher::get(&probe, "https://api.github.com/rate_limit", None)?;
        if r.status != 200 {
            return Err(Error::Invalid(format!("GitHub no acepta el token (HTTP {})", r.status)));
        }
        token::set(&value)?;
        let s = app.state::<AppState>();
        *s.fetcher.write().expect("fetcher") = Arc::new(UreqFetcher::new(Some(value)));
        if let Some(rate) = r.rate {
            s.with(|c| native_hub_core::http::save_rate_limit(c, rate))?;
        }
        Ok(json!({ "ok": true, "rateLimit": r.rate }))
    })
    .await
    .map_err(|e| Error::Invalid(e.to_string()))?
}

#[tauri::command]
fn clear_github_token(s: State<AppState>) -> Result<()> {
    token::clear()?;
    *s.fetcher.write().expect("fetcher") = Arc::new(UreqFetcher::new(None));
    Ok(())
}

fn open_database(app: &tauri::App) -> std::result::Result<(Connection, PathBuf), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("native-hub.db");
    let mut conn = db::open(&path)?;
    let cat = catalog::parse(CATALOG_JSON)?;
    if catalog::import_if_newer(&mut conn, &cat)? {
        log::info!("catálogo {} importado ({} proyectos)", cat.generated_at, cat.projects.len());
    }
    Ok((conn, path))
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
            let (conn, db_path) = open_database(app)?;
            app.manage(AppState {
                db: Mutex::new(conn),
                db_path,
                fetcher: RwLock::new(Arc::new(UreqFetcher::new(token::get()))),
                busy: AtomicBool::new(false),
                cancel: Arc::new(AtomicBool::new(false)),
            });
            // Comprobación ligera en segundo plano de los proyectos menos recientes.
            let _ = refresh_stale(app.handle().clone(), Some(24), Some(STARTUP_REFRESH));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog_summary,
            catalog_platforms,
            catalog_platform_projects,
            catalog_game,
            catalog_search,
            catalog_discover,
            catalog_home,
            catalog_games_lookup,
            releases_status,
            refresh_project,
            refresh_stale,
            cancel_job,
            update_events,
            mark_events_seen,
            scan_repositories,
            candidates,
            approve_candidate,
            reject_candidate,
            set_github_token,
            clear_github_token,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar NATIVE HUB");
}
