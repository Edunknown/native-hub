//! Download Manager: descarga el ejecutable Windows de la release oficial de un proyecto.
//!
//! - Solo se descarga el archivo que el catálogo identificó para el proyecto, y solo si su
//!   URL pertenece al repositorio del proyecto. La interfaz nunca pasa URLs.
//! - Solo HTTPS y solo hosts permitidos, también en cada redirección.
//! - Descargas reanudables (Range), que se pueden pausar y cancelar.
//! - SHA-256 comprobado cuando el proyecto lo publica; si no coincide, se borra el archivo.
//! - Nada descargado se ejecuta ni se descomprime aquí.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{Error, Result, time};

/// Hosts desde los que se acepta descargar (incluidas las redirecciones de GitHub a su CDN).
pub const DOWNLOAD_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "gitlab.com",
    "codeberg.org",
];
const MAX_REDIRECTS: usize = 5;
const MAX_SIZE: u64 = 16 * 1024 * 1024 * 1024;

pub struct Opened {
    pub status: u16,
    pub location: Option<String>,
    pub content_length: Option<u64>,
    /// Total según `Content-Range: bytes a-b/total`.
    pub range_total: Option<u64>,
    pub body: Box<dyn Read + Send>,
}

/// Abre una URL sin seguir redirecciones (el gestor las valida una a una).
pub trait Transport: Send + Sync {
    fn open(&self, url: &str, from: Option<u64>) -> Result<Opened>;
}

pub struct UreqTransport {
    agent: ureq::Agent,
}

impl Default for UreqTransport {
    fn default() -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(20)))
            .timeout_recv_body(Some(Duration::from_secs(60)))
            .http_status_as_error(false)
            .https_only(true)
            .max_redirects(0)
            .build()
            .into();
        Self { agent }
    }
}

impl Transport for UreqTransport {
    fn open(&self, url: &str, from: Option<u64>) -> Result<Opened> {
        let mut req = self.agent.get(url).header("User-Agent", concat!("NATIVE-HUB/", env!("CARGO_PKG_VERSION")));
        if let Some(n) = from.filter(|n| *n > 0) {
            req = req.header("Range", &format!("bytes={n}-"));
        }
        let resp = req.call().map_err(|e| Error::Http(e.to_string()))?;
        let h = |k: &str| resp.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_owned);
        let location = h("location");
        let content_length = h("content-length").and_then(|v| v.parse().ok());
        let range_total = h("content-range").and_then(|v| v.rsplit('/').next().and_then(|t| t.parse().ok()));
        let status = resp.status().as_u16();
        let body = resp.into_body().into_reader();
        Ok(Opened { status, location, content_length, range_total, body: Box::new(body) })
    }
}

pub fn host_allowed(url: &str) -> bool {
    match url.strip_prefix("https://").and_then(|r| r.split('/').next()) {
        Some(host) => DOWNLOAD_HOSTS.contains(&host),
        None => false,
    }
}

/// ¿Es esta URL un archivo de release del propio repositorio del proyecto?
pub fn url_belongs_to_repo(url: &str, repo_url: &str) -> bool {
    let repo = repo_url.trim_end_matches('/');
    if repo.starts_with("https://github.com/") || repo.starts_with("https://codeberg.org/") {
        return url.starts_with(&format!("{repo}/releases/download/"));
    }
    if repo.starts_with("https://gitlab.com/") {
        // GitLab enlaza archivos de la release desde el propio proyecto (uploads, paquetes o jobs).
        return url.starts_with(&format!("{repo}/"));
    }
    false
}

/// Nombre de archivo seguro: sin rutas ni caracteres raros.
pub fn safe_file_name(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next()?.trim();
    if base.is_empty() || base.starts_with('.') || base.len() > 200 {
        return None;
    }
    base.chars().all(|c| c.is_ascii_alphanumeric() || "._-+() ".contains(c)).then(|| base.to_owned())
}

/// Mensaje cuando el antivirus de Windows bloquea o borra el archivo. La interfaz lo reconoce
/// por el prefijo. NATIVE HUB nunca intenta saltarse el antivirus.
pub const AV_PREFIX: &str = "ANTIVIRUS: ";

fn io_err(context: &str, e: std::io::Error) -> Error {
    // 225 = ERROR_VIRUS_INFECTED, 226 = ERROR_VIRUS_DELETED (Windows).
    match e.raw_os_error() {
        Some(225) | Some(226) => Error::Invalid(format!(
            "{AV_PREFIX}Windows ha bloqueado el archivo porque su antivirus lo considera peligroso. NATIVE HUB no lo ha guardado."
        )),
        _ => Error::Invalid(format!("{context}: {e}")),
    }
}

// ---------- Estado de cada descarga (para pausar o cancelar desde la interfaz) ----------

pub const RUN: u8 = 0;
pub const PAUSE: u8 = 1;
pub const CANCEL: u8 = 2;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: i64,
    pub done: u64,
    pub total: Option<u64>,
    pub bytes_per_sec: u64,
}

// ---------- Cola ----------

/// Pone en cola el ejecutable Windows de un proyecto. Devuelve el id de la descarga.
pub fn enqueue(conn: &Connection, downloads_dir: &Path, slug: &str) -> Result<i64> {
    enqueue_asset(conn, downloads_dir, slug, None)
}

/// Archivo elegido por el usuario en el selector de releases (ya comprobado contra la lista
/// de releases del repositorio con `releases::find_release_asset`).
pub struct ChosenAsset {
    pub url: String,
    pub name: String,
    pub size: Option<i64>,
    pub sha256: Option<String>,
    pub tag: String,
}

pub fn enqueue_asset(conn: &Connection, downloads_dir: &Path, slug: &str, chosen: Option<ChosenAsset>) -> Result<i64> {
    let data: String = conn
        .query_row("SELECT data FROM projects WHERE slug = ?1", params![slug], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("proyecto {slug}")))?;
    let p: Value = serde_json::from_str(&data)?;
    if p["takedown"].as_bool() == Some(true) {
        return Err(Error::Invalid("el proyecto está retirado por DMCA".into()));
    }
    if chosen.is_none() && p["listing"].as_str() != Some("library") {
        return Err(Error::Invalid("el proyecto no tiene un ejecutable Windows comprobado".into()));
    }
    let default_asset = &p["windowsAsset"];
    let (url, raw_name, size, sha, tag) = match &chosen {
        Some(c) => (c.url.clone(), c.name.clone(), c.size, c.sha256.clone(), c.tag.clone()),
        None => (
            default_asset["url"].as_str().ok_or_else(|| Error::Invalid("falta la URL del archivo".into()))?.to_owned(),
            default_asset["name"].as_str().unwrap_or_default().to_owned(),
            default_asset["size"].as_i64(),
            default_asset["sha256"].as_str().map(str::to_owned),
            p.pointer("/release/tag").and_then(Value::as_str).unwrap_or("sin-version").to_owned(),
        ),
    };
    let url = url.as_str();
    let repo_url = p["repoUrl"].as_str().unwrap_or_default();
    if !url.starts_with("https://") || !host_allowed(url) || !url_belongs_to_repo(url, repo_url) {
        return Err(Error::Invalid(format!("origen no permitido para la descarga: {url}")));
    }
    let name = safe_file_name(&raw_name).ok_or_else(|| Error::Invalid("nombre de archivo no válido".into()))?;
    let tag = tag.as_str();
    let tag_dir = safe_file_name(tag).unwrap_or_else(|| "version".into());
    let dest = downloads_dir.join(slug).join(tag_dir).join(&name);

    // Ya en cola, en curso o descargado: no duplicar.
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM downloads WHERE project = ?1 AND url = ?2 AND state IN ('queued', 'running', 'paused', 'done')",
            params![slug, url],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
    {
        let st: String = conn.query_row("SELECT state FROM downloads WHERE id = ?1", params![id], |r| r.get(0))?;
        if st == "paused" {
            conn.execute("UPDATE downloads SET state = 'queued', error = NULL WHERE id = ?1", params![id])?;
        }
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO downloads (project, url, dest_path, bytes_done, bytes_total, state, sha256_expected, asset_name, release_tag, queued_at)
         VALUES (?1, ?2, ?3, 0, ?4, 'queued', ?5, ?6, ?7, ?8)",
        params![
            slug,
            url,
            dest.to_string_lossy(),
            size,
            sha,
            name,
            tag,
            time::now_iso()
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute("INSERT INTO audit_log (action, subject, detail) VALUES ('download_queue', ?1, ?2)", params![slug, url])?;
    Ok(id)
}

pub fn next_queued(conn: &Connection) -> Result<Option<i64>> {
    Ok(conn
        .query_row("SELECT id FROM downloads WHERE state = 'queued' ORDER BY queued_at, id LIMIT 1", [], |r| r.get(0))
        .optional()?)
}

fn set_state(conn: &Connection, id: i64, state: &str, error: Option<&str>) -> Result<()> {
    let finished = matches!(state, "done" | "failed" | "cancelled").then(time::now_iso);
    conn.execute(
        "UPDATE downloads SET state = ?2, error = ?3, finished_at = COALESCE(?4, finished_at) WHERE id = ?1",
        params![id, state, error, finished],
    )?;
    Ok(())
}

fn part_path(dest: &Path) -> PathBuf {
    let mut p = dest.as_os_str().to_owned();
    p.push(".part");
    PathBuf::from(p)
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = File::open(path).map_err(|e| io_err(&format!("no se puede leer {}", path.display()), e))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf).map_err(|e| io_err("no se puede leer", e))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Descarga una entrada de la cola. `control` permite pausar o cancelar desde otro hilo.
/// Devuelve el estado final: done, paused, cancelled o failed.
pub fn run(
    conn: &Connection,
    t: &dyn Transport,
    id: i64,
    control: &AtomicU8,
    mut progress: impl FnMut(Progress),
) -> Result<String> {
    let (url, dest, expected, total_hint): (String, String, Option<String>, Option<i64>) = conn.query_row(
        "SELECT url, dest_path, sha256_expected, bytes_total FROM downloads WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let dest = PathBuf::from(dest);
    let part = part_path(&dest);
    conn.execute(
        "UPDATE downloads SET state = 'running', error = NULL, started_at = COALESCE(started_at, ?2) WHERE id = ?1",
        params![id, time::now_iso()],
    )?;

    let result = (|| -> Result<String> {
        if let Some(dir) = part.parent() {
            fs::create_dir_all(dir).map_err(|e| Error::Invalid(format!("no se puede crear la carpeta: {e}")))?;
        }
        let have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);

        // Seguir redirecciones validando cada salto.
        let mut current = url.clone();
        let mut opened = None;
        for _ in 0..=MAX_REDIRECTS {
            if !current.starts_with("https://") || !host_allowed(&current) {
                return Err(Error::Invalid(format!("redirección a un origen no permitido: {current}")));
            }
            let o = t.open(&current, Some(have))?;
            if (300..400).contains(&o.status) {
                current = o.location.ok_or_else(|| Error::Http("redirección sin destino".into()))?;
                continue;
            }
            opened = Some(o);
            break;
        }
        let mut o = opened.ok_or_else(|| Error::Http("demasiadas redirecciones".into()))?;
        let (mut done, mut file) = match o.status {
            206 if have > 0 => (have, OpenOptions::new().append(true).open(&part).map_err(|e| io_err("no se puede abrir", e))?),
            200 => (0, File::create(&part).map_err(|e| io_err("no se puede crear el archivo", e))?),
            416 if have > 0 && total_hint == Some(have as i64) => (have, OpenOptions::new().append(true).open(&part).map_err(|e| io_err("no se puede abrir", e))?),
            s => return Err(Error::Http(format!("HTTP {s} al descargar"))),
        };
        let total = o.range_total.or(o.content_length.map(|l| l + done)).or(total_hint.map(|t| t as u64));
        if total.is_some_and(|t| t > MAX_SIZE) {
            return Err(Error::Invalid("archivo demasiado grande".into()));
        }
        conn.execute("UPDATE downloads SET bytes_total = ?2 WHERE id = ?1", params![id, total.map(|t| t as i64)])?;

        let mut buf = vec![0u8; 1 << 16];
        let started = Instant::now();
        let start_done = done;
        let mut last = Instant::now() - Duration::from_secs(1);
        if o.status != 416 {
            loop {
                match control.load(Ordering::Relaxed) {
                    PAUSE => {
                        conn.execute("UPDATE downloads SET bytes_done = ?2 WHERE id = ?1", params![id, done as i64])?;
                        return Ok("paused".into());
                    }
                    CANCEL => return Ok("cancelled".into()),
                    _ => {}
                }
                let n = o.body.read(&mut buf).map_err(|e| Error::Http(format!("conexión interrumpida: {e}")))?;
                if n == 0 {
                    break;
                }
                file.write_all(&buf[..n]).map_err(|e| io_err("no se puede escribir", e))?;
                done += n as u64;
                if done > MAX_SIZE {
                    return Err(Error::Invalid("archivo demasiado grande".into()));
                }
                if last.elapsed() >= Duration::from_millis(250) {
                    last = Instant::now();
                    let secs = started.elapsed().as_secs_f64().max(0.001);
                    let bps = ((done - start_done) as f64 / secs) as u64;
                    conn.execute("UPDATE downloads SET bytes_done = ?2 WHERE id = ?1", params![id, done as i64])?;
                    progress(Progress { id, done, total, bytes_per_sec: bps });
                }
            }
        }
        file.flush().map_err(|e| io_err("no se puede escribir", e))?;
        drop(file);
        if total.is_some_and(|t| t != done) {
            return Err(Error::Http(format!("descarga incompleta: {done} de {} bytes", total.unwrap_or(0))));
        }

        let local = sha256_file(&part)?;
        conn.execute("UPDATE downloads SET sha256_local = ?2, bytes_done = ?3 WHERE id = ?1", params![id, local, done as i64])?;
        if let Some(exp) = expected.as_deref().filter(|e| !e.is_empty()) {
            if !exp.eq_ignore_ascii_case(&local) {
                let _ = fs::remove_file(&part);
                return Err(Error::Invalid("el SHA-256 no coincide con el publicado: archivo descartado".into()));
            }
        }
        if dest.exists() {
            let _ = fs::remove_file(&dest);
        }
        fs::rename(&part, &dest).map_err(|e| io_err("no se puede mover el archivo", e))?;
        // Si el antivirus lo pone en cuarentena justo después, el archivo desaparece.
        std::thread::sleep(Duration::from_millis(300));
        if !dest.exists() {
            return Err(Error::Invalid(format!("{AV_PREFIX}El archivo desapareció nada más descargarlo: es probable que el antivirus de Windows lo haya puesto en cuarentena.")));
        }
        progress(Progress { id, done, total: Some(done), bytes_per_sec: 0 });
        Ok("done".into())
    })();

    let final_state = match result {
        Ok(state) => {
            if state == "cancelled" {
                let _ = fs::remove_file(&part);
            }
            set_state(conn, id, &state, None)?;
            state
        }
        Err(e) => {
            set_state(conn, id, "failed", Some(&e.to_string()))?;
            "failed".into()
        }
    };
    conn.execute(
        "INSERT INTO audit_log (action, subject, detail) VALUES ('download_' || ?1, ?2, ?3)",
        params![final_state, id.to_string(), url],
    )?;
    Ok(final_state)
}

pub fn list(conn: &Connection) -> Result<Vec<Value>> {
    let mut st = conn.prepare(
        "SELECT d.id, d.project, d.url, d.dest_path, d.bytes_done, d.bytes_total, d.state, d.sha256_expected,
                d.sha256_local, d.error, d.started_at, d.finished_at, d.asset_name, d.release_tag, d.queued_at,
                p.name, p.data
         FROM downloads d LEFT JOIN projects p ON p.slug = d.project
         ORDER BY d.state = 'running' DESC, d.state = 'queued' DESC, d.queued_at DESC, d.id DESC",
    )?;
    let rows = st.query_map([], |r| {
        let data: Option<String> = r.get(16)?;
        let pdata = data.and_then(|d| serde_json::from_str::<Value>(&d).ok()).unwrap_or(Value::Null);
        let game = pdata["gameTitle"].clone();
        let game_slug = pdata["game"].clone();
        let expected: Option<String> = r.get(7)?;
        let local: Option<String> = r.get(8)?;
        let state: String = r.get(6)?;
        let verified = match (&expected, &local) {
            (Some(e), Some(l)) if state == "done" => json!(e.eq_ignore_ascii_case(l)),
            _ => Value::Null,
        };
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "project": r.get::<_, String>(1)?,
            "url": r.get::<_, String>(2)?,
            "path": r.get::<_, String>(3)?,
            "done": r.get::<_, i64>(4)?,
            "total": r.get::<_, Option<i64>>(5)?,
            "state": state,
            "sha256Expected": expected,
            "sha256Local": local,
            "verified": verified,
            "error": r.get::<_, Option<String>>(9)?,
            "startedAt": r.get::<_, Option<String>>(10)?,
            "finishedAt": r.get::<_, Option<String>>(11)?,
            "assetName": r.get::<_, Option<String>>(12)?,
            "releaseTag": r.get::<_, Option<String>>(13)?,
            "queuedAt": r.get::<_, String>(14)?,
            "projectName": r.get::<_, Option<String>>(15)?,
            "gameTitle": game,
            "gameSlug": game_slug,
        }))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Vuelve a poner en cola una descarga pausada o fallida.
pub fn resume(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute(
        "UPDATE downloads SET state = 'queued', error = NULL, queued_at = ?2 WHERE id = ?1 AND state IN ('paused', 'failed')",
        params![id, time::now_iso()],
    )?;
    if n == 0 {
        return Err(Error::NotFound(format!("descarga {id} pausada o fallida")));
    }
    Ok(())
}

/// Cancela una descarga que no está en curso (las en curso se cancelan con `control`).
pub fn cancel_idle(conn: &Connection, id: i64) -> Result<()> {
    let dest: Option<String> = conn
        .query_row("SELECT dest_path FROM downloads WHERE id = ?1 AND state IN ('queued', 'paused', 'failed')", params![id], |r| r.get(0))
        .optional()?;
    let dest = dest.ok_or_else(|| Error::NotFound(format!("descarga {id} cancelable")))?;
    let _ = fs::remove_file(part_path(Path::new(&dest)));
    set_state(conn, id, "cancelled", None)
}

/// Quita una descarga terminada de la lista y, si se pide, borra el archivo.
/// Solo borra archivos dentro de la carpeta de descargas de NATIVE HUB.
pub fn remove(conn: &Connection, downloads_dir: &Path, id: i64, delete_file: bool) -> Result<()> {
    let (dest, state): (String, String) = conn
        .query_row("SELECT dest_path, state FROM downloads WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("descarga {id}")))?;
    if state == "running" || state == "queued" {
        return Err(Error::Invalid("primero cancela la descarga".into()));
    }
    if delete_file {
        let p = PathBuf::from(&dest);
        let inside = p.canonicalize().ok().zip(downloads_dir.canonicalize().ok()).is_some_and(|(f, d)| f.starts_with(d));
        if inside {
            let _ = fs::remove_file(&p);
        }
        let _ = fs::remove_file(part_path(&p));
    }
    conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
    Ok(())
}

/// Al arrancar: lo que quedó «en curso» por un cierre inesperado pasa a pausado.
pub fn recover(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("UPDATE downloads SET state = 'paused' WHERE state = 'running'", [])?)
}
