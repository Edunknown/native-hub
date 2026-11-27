// NATIVE HUB · arranque de la aplicación de escritorio.
//
// Fase 2: base de datos SQLite en la carpeta de datos de la app y catálogo incluido en el
// ejecutable, que se importa cuando cambia de versión.
// Fase 3: comprobación de releases en vivo, escáner de repositorios con cola de revisión y
// token de GitHub opcional guardado en el Administrador de credenciales de Windows.

mod token;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use native_hub_core::http::UreqFetcher;
use native_hub_core::cover::{self, UreqImages};
use native_hub_core::{Error, Result, catalog, db, download, install, query, releases, remote, scanner, sync, update};
use rusqlite::Connection;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

/// Catálogo generado por scripts/build-catalog.mjs, incluido al compilar.
const CATALOG_JSON: &str = include_str!("../../catalog/catalog.json");
const LOG_FILE: &str = "native-hub";
/// How much of the log "Copy details" includes (the end of the file).
const LOG_TAIL_BYTES: u64 = 64 * 1024;
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
    /// Carpeta donde se guardan las descargas (fase 5 permitirá elegir la de instalación).
    downloads_dir: PathBuf,
    /// Control de pausa/cancelación de la descarga en curso.
    dl_controls: Mutex<HashMap<i64, Arc<AtomicU8>>>,
    dl_worker: AtomicBool,
    /// Carpeta de juegos por defecto (Documentos\NATIVE HUB); se puede cambiar en Ajustes.
    default_install_root: PathBuf,
    /// Caché de portadas (images.igdb.com), servida a la interfaz por el protocolo cover://.
    covers_dir: PathBuf,
    images: Arc<UreqImages>,
    /// Folder of the log file (`native-hub.log`, plus up to two rotated files).
    log_dir: PathBuf,
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
    fn install_root(&self) -> Result<PathBuf> {
        let custom: Option<String> = self.with(|c| {
            Ok(c.query_row("SELECT value FROM settings WHERE key = 'install_root'", [], |r| r.get(0)).ok())
        })?;
        Ok(custom.map(PathBuf::from).unwrap_or_else(|| self.default_install_root.clone()))
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
fn catalog_discover(s: State<AppState>, filter: query::DiscoverFilter) -> Result<Value> {
    s.with(|c| query::discover(c, &filter))
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

// ---------- Portadas ----------

/// Responde a `cover://localhost/<tamaño>/<image_id>`: la portada desde la caché, o
/// descargada de images.igdb.com la primera vez. Sin conexión y sin caché, 404 y la
/// interfaz muestra la portada tipográfica.
fn serve_cover(app: &AppHandle, path: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).expect("respuesta");
    let Some((size, id)) = cover::parse_request_path(path) else { return not_found() };
    let s = app.state::<AppState>();
    match cover::get(&s.covers_dir, s.images.as_ref(), size, &id) {
        Ok(bytes) => tauri::http::Response::builder()
            .header("Content-Type", "image/jpeg")
            .header("Cache-Control", "max-age=31536000, immutable")
            .body(bytes)
            .expect("respuesta"),
        Err(e) => {
            log::warn!("portada {size}/{id}: {e}");
            not_found()
        }
    }
}

#[tauri::command]
fn covers_cache_size(s: State<AppState>) -> u64 {
    cover::cache_size(&s.covers_dir)
}

#[tauri::command]
fn covers_clear_cache(s: State<AppState>) -> Result<()> {
    cover::clear_cache(&s.covers_dir)
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

/// Downloads the catalog published on GitHub and imports it if it is newer. The interface
/// reloads its data when it receives `catalog-updated`.
#[tauri::command]
fn catalog_remote_check(app: AppHandle) -> Result<bool> {
    start_job(&app, "catalog", |app, s, _| {
        let _ = app.emit("job-progress", json!({ "job": "catalog", "done": 0, "total": 1, "current": "GitHub" }));
        let result = s.job_conn().and_then(|mut conn| remote::check(&mut conn, s.fetcher().as_ref(), remote::CATALOG_URL));
        match result {
            Ok(out) => {
                log::info!("remote catalog: {out:?}");
                if matches!(out, remote::Outcome::Updated { .. }) {
                    let _ = app.emit("catalog-updated", &out);
                }
                json!({ "catalog": out })
            }
            Err(e) => {
                log::warn!("remote catalog: {e}");
                json!({ "error": e.to_string() })
            }
        }
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
        let _ = app.emit("job-progress", json!({ "job": "scan", "done": 0, "total": 2, "current": native_hub_core::i18n::tr("búsqueda", "search") }));
        let sum = scanner::scan(conn, fetcher.as_ref(), &scanner::default_queries(native_hub_core::time::now_unix()));
        let _ = app.emit("job-progress", json!({ "job": "scan", "done": 1, "total": 3, "current": "GitLab" }));
        let gl = sync::scan_gitlab(conn, fetcher.as_ref());
        let _ = app.emit("job-progress", json!({ "job": "scan", "done": 2, "total": 3, "current": native_hub_core::i18n::tr("releases de los candidatos", "candidate releases") }));
        let probed = scanner::probe_candidates(conn, fetcher.as_ref(), 30).unwrap_or(0);
        let _ = conn.execute("INSERT INTO settings (key, value) VALUES ('last_scan', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [native_hub_core::time::now_iso()]);
        json!({ "scan": sum, "gitlab": gl, "probed": probed })
    })
}

#[tauri::command]
fn candidates(s: State<AppState>, status: Option<String>, source: Option<String>, limit: Option<i64>) -> Result<Value> {
    s.with(|c| {
        Ok(json!({
            "items": scanner::list_candidates_from(c, status.as_deref().unwrap_or("new"), source.as_deref(), limit.unwrap_or(200))?,
            "counts": scanner::candidate_counts(c)?,
            "bySource": sync::counts_by_source(c)?,
        }))
    })
}

#[tauri::command]
fn sync_recompendium(app: AppHandle) -> Result<bool> {
    start_job(&app, "sync", |app, s, conn| {
        let _ = app.emit("job-progress", json!({ "job": "sync", "done": 0, "total": 1, "current": "Recompendium" }));
        let sum = sync::sync_recompendium(conn, s.fetcher().as_ref(), 300);
        json!({ "sync": sum })
    })
}

#[tauri::command]
async fn approve_suggested(app: AppHandle, id: i64) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        let slug = s.with_mut(|c| sync::approve_suggested(c, id))?;
        if let Ok(conn) = s.job_conn() {
            let _ = releases::refresh_project(&conn, s.fetcher().as_ref(), &slug);
        }
        Ok(slug)
    })
    .await
    .map_err(|e| Error::Invalid(e.to_string()))?
}

/// Aprueba en bloque los candidatos con datos sugeridos y después comprueba sus releases.
#[tauri::command]
fn approve_all_suggested(app: AppHandle, source: String) -> Result<usize> {
    let s = app.state::<AppState>();
    let slugs = s.with_mut(|c| sync::approve_all_suggested(c, &source))?;
    let n = slugs.len();
    let _ = start_job(&app, "refresh", move |app, s, conn| {
        let items: Vec<(String, String)> = slugs
            .iter()
            .filter_map(|sl| conn.query_row("SELECT slug, repo_url FROM projects WHERE slug = ?1", [sl], |r| Ok((r.get(0)?, r.get(1)?))).ok())
            .collect();
        let sum = releases::refresh_batch(conn, s.fetcher().as_ref(), &items, &s.cancel, |done, total, slug| {
            let _ = app.emit("job-progress", json!({ "job": "refresh", "done": done, "total": total, "current": slug }));
        });
        serde_json::to_value(sum).unwrap_or(Value::Null)
    });
    Ok(n)
}

// ---------- Automatización (fase 7) ----------

fn setting(c: &Connection, key: &str) -> Option<String> {
    c.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).ok()
}

fn hours_of(mode: &str) -> Option<i64> {
    match mode {
        "6h" => Some(6),
        "24h" => Some(24),
        _ => None,
    }
}

#[tauri::command]
fn automation_get(s: State<AppState>) -> Result<Value> {
    s.with(|c| {
        Ok(json!({
            "releases": setting(c, "auto_releases").unwrap_or_else(|| "24h".into()),
            "discover": setting(c, "auto_discover").unwrap_or_else(|| "24h".into()),
            "catalog": setting(c, "auto_catalog").unwrap_or_else(|| "24h".into()),
            "catalogStatus": remote::status(c)?,
            "lastScan": setting(c, "last_scan"),
            "lastSync": setting(c, "last_recompendium_sync"),
            "lastAutoRefresh": setting(c, "last_auto_refresh"),
        }))
    })
}

#[tauri::command]
fn automation_set(s: State<AppState>, releases: String, discover: String, catalog: Option<String>) -> Result<Value> {
    let catalog = catalog.unwrap_or_else(|| "24h".into());
    for v in [&releases, &discover, &catalog] {
        if !["off", "6h", "24h"].contains(&v.as_str()) {
            return Err(Error::Invalid(native_hub_core::t!("valor no válido: {v}", "invalid value: {v}")));
        }
    }
    s.with(|c| {
        for (k, v) in [("auto_releases", &releases), ("auto_discover", &discover), ("auto_catalog", &catalog)] {
            c.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [k, v.as_str()])?;
        }
        Ok(())
    })?;
    automation_get(s)
}

/// Cada 15 minutos mira si toca comprobar releases o buscar proyectos nuevos.
fn start_scheduler(app: AppHandle) {
    std::thread::spawn(move || {
        // Primera vuelta al cabo de un minuto, para no competir con el arranque.
        std::thread::sleep(std::time::Duration::from_secs(60));
        loop {
            let s = app.state::<AppState>();
            let now = native_hub_core::time::now_unix();
            let due = |key: &str, mode: &str| -> bool {
                let Some(h) = hours_of(mode) else { return false };
                let last = s.with(|c| Ok(setting(c, key))).ok().flatten().and_then(|v| native_hub_core::time::parse_iso(&v)).unwrap_or(0);
                now - last >= h * 3600
            };
            let (rel_mode, disc_mode) = s
                .with(|c| Ok((setting(c, "auto_releases").unwrap_or_else(|| "24h".into()), setting(c, "auto_discover").unwrap_or_else(|| "24h".into()))))
                .unwrap_or_else(|_| ("off".into(), "off".into()));
            let cat_mode = s.with(|c| Ok(setting(c, "auto_catalog"))).ok().flatten().unwrap_or_else(|| "24h".into());
            if !s.busy.load(Ordering::Relaxed) {
                if due("remote_catalog_checked_at", &cat_mode) {
                    let _ = catalog_remote_check(app.clone());
                } else if due("last_auto_refresh", &rel_mode) {
                    let _ = s.with(|c| {
                        c.execute("INSERT INTO settings (key, value) VALUES ('last_auto_refresh', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [native_hub_core::time::now_iso()])?;
                        Ok(())
                    });
                    // Con token hay cuota de sobra; sin él, un lote prudente.
                    let limit = if token::get().is_some() { 1500 } else { 50 };
                    let _ = refresh_stale(app.clone(), Some(hours_of(&rel_mode).unwrap_or(24)), Some(limit));
                } else if due("last_scan", &disc_mode) {
                    let _ = start_job(&app, "scan", |app, s, conn| {
                        let f = s.fetcher();
                        let _ = app.emit("job-progress", json!({ "job": "scan", "done": 0, "total": 3, "current": native_hub_core::i18n::tr("búsqueda automática", "automatic search") }));
                        let gh = scanner::scan(conn, f.as_ref(), &scanner::default_queries(native_hub_core::time::now_unix()));
                        let _ = app.emit("job-progress", json!({ "job": "scan", "done": 1, "total": 3, "current": "GitLab" }));
                        let gl = sync::scan_gitlab(conn, f.as_ref());
                        let _ = app.emit("job-progress", json!({ "job": "scan", "done": 2, "total": 3, "current": "Recompendium" }));
                        let rc = sync::sync_recompendium(conn, f.as_ref(), 300);
                        let _ = conn.execute("INSERT INTO settings (key, value) VALUES ('last_scan', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [native_hub_core::time::now_iso()]);
                        json!({ "scan": gh, "gitlab": gl, "sync": rc, "automatic": true })
                    });
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(15 * 60));
        }
    });
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

// ---------- Descargas (fase 4) ----------

/// Procesa la cola de descargas de una en una, en su propio hilo.
fn ensure_download_worker(app: &AppHandle) {
    let s = app.state::<AppState>();
    if s.dl_worker.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let s = app.state::<AppState>();
        let transport = download::UreqTransport::default();
        if let Ok(conn) = s.job_conn() {
            while let Ok(Some(id)) = download::next_queued(&conn) {
                let control = Arc::new(AtomicU8::new(download::RUN));
                s.dl_controls.lock().expect("controles").insert(id, control.clone());
                let _ = app.emit("download-progress", json!({ "id": id, "done": 0, "total": null, "bytesPerSec": 0 }));
                let state = download::run(&conn, &transport, id, &control, |p| {
                    let _ = app.emit("download-progress", &p);
                })
                .unwrap_or_else(|e| {
                    log::error!("download {id}: {e}");
                    "failed".into()
                });
                let error: Option<String> = conn.query_row("SELECT error FROM downloads WHERE id = ?1", [id], |r| r.get(0)).ok().flatten();
                match &error {
                    Some(e) => log::warn!("download {id}: {state}: {e}"),
                    None => log::info!("download {id}: {state}"),
                }
                s.dl_controls.lock().expect("controles").remove(&id);
                let _ = app.emit("download-finished", json!({ "id": id, "state": state }));
            }
        }
        s.dl_worker.store(false, Ordering::SeqCst);
        // Si entró algo en la cola justo al terminar, volver a arrancar.
        if let Ok(conn) = s.job_conn() {
            if matches!(download::next_queued(&conn), Ok(Some(_))) {
                ensure_download_worker(&app);
            }
        }
    });
}

#[tauri::command]
fn download_start(app: AppHandle, slug: String) -> Result<i64> {
    let s = app.state::<AppState>();
    let id = s.with(|c| download::enqueue(c, &s.downloads_dir, &slug))?;
    log::info!("download {id} queued for {slug}");
    ensure_download_worker(&app);
    Ok(id)
}

#[tauri::command]
async fn project_releases(app: AppHandle, slug: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        let conn = s.job_conn()?;
        releases::project_releases(&conn, s.fetcher().as_ref(), &slug, 10)
    })
    .await
    .map_err(|e| Error::Invalid(e.to_string()))?
}

/// Descarga un archivo elegido en el selector. La URL se comprueba contra las releases del
/// propio repositorio antes de ponerla en cola.
#[tauri::command]
async fn download_asset(app: AppHandle, slug: String, url: String) -> Result<i64> {
    let app2 = app.clone();
    let id = tauri::async_runtime::spawn_blocking(move || {
        let s = app2.state::<AppState>();
        let conn = s.job_conn()?;
        let (rel, asset) = releases::find_release_asset(&conn, s.fetcher().as_ref(), &slug, &url)?;
        download::enqueue_asset(
            &conn,
            &s.downloads_dir,
            &slug,
            Some(download::ChosenAsset { url: asset.url, name: asset.name, size: asset.size, sha256: asset.sha256, tag: rel.tag }),
        )
    })
    .await
    .map_err(|e| Error::Invalid(e.to_string()))??;
    ensure_download_worker(&app);
    Ok(id)
}

#[tauri::command]
fn downloads_list(s: State<AppState>) -> Result<Vec<Value>> {
    s.with(download::list)
}

fn signal(s: &AppState, id: i64, value: u8) -> bool {
    match s.dl_controls.lock().expect("controles").get(&id) {
        Some(c) => {
            c.store(value, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

#[tauri::command]
fn download_pause(s: State<AppState>, id: i64) -> Result<()> {
    if !signal(&s, id, download::PAUSE) {
        s.with(|c| {
            c.execute("UPDATE downloads SET state = 'paused' WHERE id = ?1 AND state = 'queued'", [id])?;
            Ok(())
        })?;
    }
    Ok(())
}

#[tauri::command]
fn download_resume(app: AppHandle, id: i64) -> Result<()> {
    app.state::<AppState>().with(|c| download::resume(c, id))?;
    ensure_download_worker(&app);
    Ok(())
}

#[tauri::command]
fn download_cancel(s: State<AppState>, id: i64) -> Result<()> {
    if !signal(&s, id, download::CANCEL) {
        s.with(|c| download::cancel_idle(c, id))?;
    }
    Ok(())
}

#[tauri::command]
fn download_remove(s: State<AppState>, id: i64, delete_file: bool) -> Result<()> {
    s.with(|c| download::remove(c, &s.downloads_dir, id, delete_file))
}

#[tauri::command]
fn download_reveal(s: State<AppState>, id: i64) -> Result<()> {
    let path: String = s.with(|c| Ok(c.query_row("SELECT dest_path FROM downloads WHERE id = ?1 AND state = 'done'", [id], |r| r.get(0))?))?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| Error::Invalid(e.to_string()))
}

// ---------- Instalación y biblioteca (fase 5) ----------

#[tauri::command]
fn install_root_get(s: State<AppState>) -> Result<Value> {
    let root = s.install_root()?;
    Ok(json!({ "path": root.to_string_lossy(), "default": root == s.default_install_root }))
}

#[tauri::command]
fn install_root_set(s: State<AppState>, path: Option<String>) -> Result<Value> {
    match path.filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let pb = PathBuf::from(&p);
            if !pb.is_absolute() {
                return Err(Error::Invalid(native_hub_core::i18n::tr("elige una carpeta completa", "choose a full folder path").into()));
            }
            std::fs::create_dir_all(&pb).map_err(|e| Error::Invalid(native_hub_core::t!("no se puede usar esa carpeta: {e}", "cannot use that folder: {e}")))?;
            s.with(|c| {
                c.execute("INSERT INTO settings (key, value) VALUES ('install_root', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [&p])?;
                Ok(())
            })?;
        }
        None => s.with(|c| {
            c.execute("DELETE FROM settings WHERE key = 'install_root'", [])?;
            Ok(())
        })?,
    }
    install_root_get(s)
}

#[tauri::command]
fn install_plan(s: State<AppState>, slug: String) -> Result<Value> {
    let root = s.install_root()?;
    s.with(|c| install::plan(c, &slug, &root))
}

#[tauri::command]
async fn install_project(app: AppHandle, slug: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        let root = s.install_root()?;
        std::fs::create_dir_all(&root).map_err(|e| Error::Invalid(native_hub_core::t!("no se puede crear la carpeta de juegos: {e}", "cannot create the games folder: {e}")))?;
        let conn = s.job_conn()?;
        log::info!("install {slug} into {}", root.display());
        let r = install::install(&conn, &slug, &root);
        if let Err(e) = &r {
            log::error!("install {slug}: {e}");
        }
        r
    })
    .await
    .map_err(|e| Error::Invalid(e.to_string()))?
}

#[tauri::command]
fn installations_list(s: State<AppState>) -> Result<Vec<Value>> {
    s.with(install::list)
}

#[tauri::command]
fn installation_set_exe(s: State<AppState>, id: i64, path: String) -> Result<Value> {
    s.with(|c| install::set_executable(c, id, std::path::Path::new(&path)))
}

#[tauri::command]
fn installation_launch(s: State<AppState>, id: i64) -> Result<()> {
    let (exe, wd) = s.with(|c| install::launch_target(c, id))?;
    log::info!("launch installation {id}: {}", exe.display());
    std::process::Command::new(&exe)
        .current_dir(&wd)
        .spawn()
        .map_err(|e| Error::Invalid(native_hub_core::t!("no se pudo abrir {}: {e}", "could not open {}: {e}", exe.display())))?;
    Ok(())
}

#[tauri::command]
fn installation_open_folder(s: State<AppState>, id: i64) -> Result<()> {
    let dir: String = s.with(|c| Ok(c.query_row("SELECT install_dir FROM installations WHERE id = ?1", [id], |r| r.get(0))?))?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| Error::Invalid(e.to_string()))
}

#[tauri::command]
fn installation_run_installer(s: State<AppState>, id: i64) -> Result<()> {
    // Solo se llega aquí cuando el usuario lo confirma en la interfaz.
    let path = s.with(|c| install::installer_path(c, id))?;
    s.with(|c| {
        c.execute("INSERT INTO audit_log (action, subject, detail) VALUES ('run_installer', ?1, ?2)", rusqlite::params![id.to_string(), path.to_string_lossy()])?;
        Ok(())
    })?;
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| Error::Invalid(e.to_string()))
}

#[tauri::command]
fn installation_uninstall(s: State<AppState>, id: i64, delete_files: bool) -> Result<()> {
    let root = s.install_root()?;
    log::info!("uninstall installation {id} (delete files: {delete_files})");
    s.with(|c| install::uninstall(c, id, &root, delete_files))
}

#[tauri::command]
fn user_file_check(s: State<AppState>, slug: String, key: String, path: String, installation: Option<i64>) -> Result<Value> {
    s.with(|c| {
        let rule = install::adapter_rule(c, &slug, &key)?;
        let p = std::path::Path::new(&path);
        let res = install::validate_user_file(p, &rule)?;
        if let Some(id) = installation {
            install::record_user_file(c, id, &key, p, res["ok"].as_bool() == Some(true))?;
        }
        Ok(res)
    })
}

#[tauri::command]
fn user_files_list(s: State<AppState>, installation: i64) -> Result<Vec<Value>> {
    s.with(|c| install::user_files(c, installation))
}

// ---------- Actualizar lo instalado (fase 6) ----------

fn blocking<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&AppState, &Connection, &std::path::Path) -> Result<T> + Send + 'static) -> impl std::future::Future<Output = Result<T>> {
    async move {
        tauri::async_runtime::spawn_blocking(move || {
            let s = app.state::<AppState>();
            let root = s.install_root()?;
            let conn = s.job_conn()?;
            f(&s, &conn, &root)
        })
        .await
        .map_err(|e| Error::Invalid(e.to_string()))?
    }
}

#[tauri::command]
async fn update_plan(app: AppHandle, id: i64) -> Result<Value> {
    blocking(app, move |_, c, root| update::plan(c, id, root)).await
}

#[tauri::command]
async fn update_apply(app: AppHandle, id: i64) -> Result<Value> {
    log::info!("apply update to installation {id}");
    blocking(app, move |_, c, root| update::apply(c, id, root)).await
}

#[tauri::command]
async fn update_rollback(app: AppHandle, id: i64) -> Result<Value> {
    log::info!("undo update of installation {id}");
    blocking(app, move |_, c, root| update::rollback(c, id, root)).await
}

#[tauri::command]
async fn update_discard(app: AppHandle, id: i64) -> Result<()> {
    blocking(app, move |_, c, root| update::discard(c, id, root)).await
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
            return Err(Error::Invalid(native_hub_core::t!("GitHub no acepta el token (HTTP {})", "GitHub does not accept the token (HTTP {})", r.status)));
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

// ---------- Log and error reports ----------

/// The interface reports every failed command here, so the log shows what the user saw.
#[tauri::command]
fn log_client_error(command: String, error: String) {
    log::warn!("{command}: {error}");
}

/// Text to paste in a bug report: versions, environment, the error (if any) and the end of
/// the log. Paths under the user's home folder are shortened to `~`.
#[tauri::command]
fn log_report(s: State<AppState>, error: Option<String>) -> Result<String> {
    use std::io::{Read, Seek, SeekFrom};
    let path = s.log_dir.join(format!("{LOG_FILE}.log"));
    let mut tail = String::new();
    if let Ok(mut f) = std::fs::File::open(&path) {
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let start = len.saturating_sub(LOG_TAIL_BYTES);
        if f.seek(SeekFrom::Start(start)).is_ok() {
            let mut buf = Vec::new();
            let _ = f.read_to_end(&mut buf);
            tail = String::from_utf8_lossy(&buf).into_owned();
            if start > 0 {
                // Drop the partial first line.
                tail = tail.split_once('\n').map(|(_, rest)| rest.to_owned()).unwrap_or(tail);
            }
        }
    }
    let catalog = s.with(catalog::loaded_version).ok().flatten().unwrap_or_default();
    let mut out = format!(
        "NATIVE HUB {} · {} {} · {} · catalog {}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        if portable_root().is_some() { "portable" } else { "installed" },
        catalog,
    );
    if let Some(e) = error.filter(|e| !e.trim().is_empty()) {
        out.push_str(&format!("\nError: {e}\n"));
    }
    out.push_str("\n--- log ---\n");
    out.push_str(if tail.is_empty() { "(empty)\n" } else { &tail });
    Ok(redact_home(&out))
}

/// Replaces the user's home folder with `~` (the user name is often in it).
fn redact_home(text: &str) -> String {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    if home.len() < 3 {
        return text.to_owned();
    }
    let mut out = text.replace(&home, "~");
    // JSON-escaped Windows paths (C:\\Users\\name).
    let escaped = home.replace('\\', "\\\\");
    if escaped != home {
        out = out.replace(&escaped, "~");
    }
    out.replace(&home.replace('\\', "/"), "~")
}

#[tauri::command]
fn log_open_folder(s: State<AppState>) -> Result<()> {
    std::fs::create_dir_all(&s.log_dir).map_err(|e| Error::Invalid(e.to_string()))?;
    tauri_plugin_opener::open_path(&s.log_dir, None::<&str>).map_err(|e| Error::Invalid(e.to_string()))
}

// ---------- First run ----------

/// Whether the welcome guide has been completed (or skipped) in this install.
#[tauri::command]
fn onboarding_done(s: State<AppState>) -> Result<bool> {
    s.with(|c| Ok(setting(c, "onboarding_done").is_some()))
}

#[tauri::command]
fn onboarding_set(s: State<AppState>, done: bool) -> Result<()> {
    s.with(|c| {
        if done {
            c.execute(
                "INSERT INTO settings (key, value) VALUES ('onboarding_done', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [native_hub_core::time::now_iso()],
            )?;
        } else {
            c.execute("DELETE FROM settings WHERE key = 'onboarding_done'", [])?;
        }
        Ok(())
    })
}

/// Whether this copy runs in portable mode (it then only announces updates).
#[tauri::command]
fn is_portable() -> bool {
    portable_root().is_some()
}

/// Language of the messages returned by the backend ("en" or "es").
#[tauri::command]
fn set_language(lang: String) {
    native_hub_core::i18n::set_english(lang != "es");
}

#[tauri::command]
fn clear_github_token(s: State<AppState>) -> Result<()> {
    token::clear()?;
    *s.fetcher.write().expect("fetcher") = Arc::new(UreqFetcher::new(None));
    Ok(())
}

/// Portable mode: if a file named `portable` (or `portable.txt`) sits next to the executable,
/// everything is stored beside it: `data\` (database and downloads) and `Games\`.
fn portable_root() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    (dir.join("portable").exists() || dir.join("portable.txt").exists()).then_some(dir)
}

fn open_database(app: &tauri::App) -> std::result::Result<(Connection, PathBuf), Box<dyn std::error::Error>> {
    let dir = match portable_root() {
        Some(root) => root.join("data"),
        None => app.path().app_data_dir()?,
    };
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .register_asynchronous_uri_scheme_protocol("cover", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_owned();
            tauri::async_runtime::spawn_blocking(move || responder.respond(serve_cover(&app, &path)));
        })
        .setup(|app| {
            // Log file (also in release builds), so problems can be reported with
            // Settings › Log › "Copy" or the "Copy details" link next to any error.
            let log_dir = match portable_root() {
                Some(root) => root.join("data").join("logs"),
                None => app.path().app_log_dir()?,
            };
            let mut targets = vec![tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                path: log_dir.clone(),
                file_name: Some(LOG_FILE.into()),
            })];
            if cfg!(debug_assertions) {
                targets.push(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout));
            }
            app.handle().plugin(
                tauri_plugin_log::Builder::new()
                    .targets(targets)
                    .level(log::LevelFilter::Info)
                    // ureq and rustls are very chatty at info level.
                    .level_for("ureq", log::LevelFilter::Warn)
                    .level_for("rustls", log::LevelFilter::Warn)
                    .max_file_size(1_000_000)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(2))
                    .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                    .build(),
            )?;
            let default_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                log::error!("panic: {info}");
                default_hook(info);
            }));
            log::info!(
                "NATIVE HUB {} starting ({} {}, {})",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS,
                std::env::consts::ARCH,
                if portable_root().is_some() { "portable" } else { "installed" }
            );
            let (conn, db_path) = open_database(app)?;
            download::recover(&conn)?;
            let portable = portable_root();
            let downloads_dir = match &portable {
                Some(root) => root.join("data").join("downloads"),
                None => app.path().app_local_data_dir()?.join("downloads"),
            };
            std::fs::create_dir_all(&downloads_dir)?;
            let covers_dir = match &portable {
                Some(root) => root.join("data").join("covers"),
                None => app.path().app_cache_dir()?.join("covers"),
            };
            let default_install_root = match &portable {
                Some(root) => root.join("Games"),
                None => app.path().document_dir()?.join("NATIVE HUB"),
            };
            app.manage(AppState {
                db: Mutex::new(conn),
                db_path,
                fetcher: RwLock::new(Arc::new(UreqFetcher::new(token::get()))),
                busy: AtomicBool::new(false),
                cancel: Arc::new(AtomicBool::new(false)),
                downloads_dir,
                dl_controls: Mutex::new(HashMap::new()),
                dl_worker: AtomicBool::new(false),
                default_install_root,
                covers_dir,
                images: Arc::new(UreqImages::default()),
                log_dir,
            });
            // Comprobación ligera en segundo plano de los proyectos menos recientes.
            let _ = refresh_stale(app.handle().clone(), Some(24), Some(STARTUP_REFRESH));
            start_scheduler(app.handle().clone());
            // The window is created here (not from tauri.conf.json) so that, in portable mode,
            // the WebView profile (theme, language, sound) also lives next to the executable.
            if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main") {
                let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), cfg)?;
                if let Some(root) = &portable {
                    builder = builder.data_directory(root.join("data").join("webview"));
                }
                builder.build()?;
            }
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
            catalog_remote_check,
            covers_cache_size,
            covers_clear_cache,
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
            sync_recompendium,
            approve_suggested,
            approve_all_suggested,
            automation_get,
            automation_set,
            set_github_token,
            clear_github_token,
            set_language,
            is_portable,
            onboarding_done,
            onboarding_set,
            log_client_error,
            log_report,
            log_open_folder,
            download_start,
            project_releases,
            download_asset,
            downloads_list,
            download_pause,
            download_resume,
            download_cancel,
            download_remove,
            download_reveal,
            install_root_get,
            install_root_set,
            install_plan,
            install_project,
            installations_list,
            installation_set_exe,
            installation_launch,
            installation_open_folder,
            installation_run_installer,
            installation_uninstall,
            user_file_check,
            user_files_list,
            update_plan,
            update_apply,
            update_rollback,
            update_discard,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar NATIVE HUB");
}
