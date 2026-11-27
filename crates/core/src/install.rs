//! Installation Manager y Game File Validator (fase 5).
//!
//! Cada proyecto se instala con un **plan** que se enseña antes de hacer nada. El plan sale
//! del tipo de archivo descargado y, si existe, del **adaptador revisado** del proyecto
//! (`catalog/adapters/*.json`): un JSON declarativo con un vocabulario cerrado. Ningún
//! adaptador ejecuta scripts ni comandos.
//!
//! - ZIP: se extrae dentro de la carpeta del juego, sin rutas que se salgan de ella.
//! - EXE portable: se copia tal cual.
//! - Instalador (.exe/.msi con setup/installer en el nombre): se abre SOLO si el usuario lo
//!   pide, y después elige él el ejecutable instalado.
//! - 7z / RAR: no se extraen aquí; se abre la carpeta para hacerlo a mano.
//!
//! Nada se ejecuta al instalar. Ejecutar el juego es una acción explícita del usuario.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{Error, Result, download, time};

const MAX_UNPACKED: u64 = 64 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;

// ---------- Adaptadores ----------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserFileRule {
    pub key: String,
    pub label: String,
    pub extensions: Vec<String>,
    /// Primeros bytes aceptados, en hexadecimal (p. ej. las tres ordenaciones de una ROM de N64).
    pub magic: Vec<String>,
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    /// SHA-1 aceptados, solo si el proyecto los publica.
    pub sha1: Vec<String>,
    /// "first_launch": el propio juego lo pide al abrirlo; NATIVE HUB solo ayuda a comprobarlo.
    pub when: String,
    pub help: Option<String>,
    /// English texts (optional; Spanish is used when missing).
    pub label_en: Option<String>,
    pub help_en: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Adapter {
    pub id: String,
    pub version: u32,
    pub reviewed_at: Option<String>,
    /// Expresión regular para elegir el ejecutable dentro de lo extraído (solo si se conoce).
    pub exe_hint: Option<String>,
    pub first_run: Option<String>,
    pub user_files: Vec<UserFileRule>,
    /// Rutas que una actualización no debe tocar (fase 6).
    pub preserve: Vec<String>,
    pub notes: Vec<String>,
    pub first_run_en: Option<String>,
    pub notes_en: Vec<String>,
}

impl Adapter {
    /// Puts the texts of the interface language in the main fields.
    pub fn localized(mut self) -> Self {
        if crate::i18n::en() {
            if self.first_run_en.is_some() {
                self.first_run = self.first_run_en.clone();
            }
            if !self.notes_en.is_empty() {
                self.notes = self.notes_en.clone();
            }
            for f in &mut self.user_files {
                if let Some(l) = &f.label_en {
                    f.label = l.clone();
                }
                if f.help_en.is_some() {
                    f.help = f.help_en.clone();
                }
            }
        }
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    ExtractZip,
    CopyExe,
    Installer,
    Manual,
}

pub fn method_for(asset_name: &str) -> Method {
    let n = asset_name.to_lowercase();
    if n.ends_with(".zip") {
        Method::ExtractZip
    } else if n.ends_with(".msi") || (n.ends_with(".exe") && Regex::new(r"(setup|install)").expect("regex").is_match(&n)) {
        Method::Installer
    } else if n.ends_with(".exe") {
        Method::CopyExe
    } else {
        Method::Manual
    }
}

/// Carpeta de un juego dentro de la carpeta raíz de instalación.
pub fn install_dir_for(root: &Path, slug: &str) -> PathBuf {
    root.join(slug)
}

struct ProjectInfo {
    data: Value,
    adapter: Option<Adapter>,
}

fn project(conn: &Connection, slug: &str) -> Result<ProjectInfo> {
    let data: String = conn
        .query_row("SELECT data FROM projects WHERE slug = ?1", params![slug], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::NotFound(crate::t!("proyecto {slug}", "project {slug}")))?;
    let data: Value = serde_json::from_str(&data)?;
    let adapter = data.get("adapter").filter(|a| a.is_object()).and_then(|a| serde_json::from_value::<Adapter>(a.clone()).ok()).map(Adapter::localized);
    Ok(ProjectInfo { data, adapter })
}

/// Descarga terminada que se usará para instalar: la más reciente del proyecto, sea el archivo
/// recomendado o uno elegido en el selector de releases (`_url` se conserva por compatibilidad).
/// Devuelve (id, ruta, versión, nombre del archivo).
fn finished_download(conn: &Connection, slug: &str, _url: &str) -> Result<Option<(i64, String, Option<String>, String)>> {
    Ok(conn
        .query_row(
            "SELECT id, dest_path, release_tag, COALESCE(asset_name, '') FROM downloads
             WHERE project = ?1 AND state = 'done' ORDER BY finished_at DESC, id DESC LIMIT 1",
            params![slug],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?)
}

/// Plan de instalación que se enseña al usuario antes de hacer nada.
pub fn plan(conn: &Connection, slug: &str, root: &Path) -> Result<Value> {
    let p = project(conn, slug)?;
    let url = p.data.pointer("/windowsAsset/url").and_then(Value::as_str).unwrap_or_default().to_owned();
    let dl = finished_download(conn, slug, &url)?;
    if dl.is_none() && p.data["listing"].as_str() != Some("library") {
        return Err(Error::Invalid(crate::i18n::tr("el proyecto no tiene un ejecutable Windows comprobado; elige un archivo de sus releases", "the project has no verified Windows executable; choose a file from its releases").into()));
    }
    let asset_name = match &dl {
        Some((_, _, _, n)) if !n.is_empty() => n.clone(),
        _ => p.data.pointer("/windowsAsset/name").and_then(Value::as_str).unwrap_or_default().to_owned(),
    };
    let method = method_for(&asset_name);
    let dir = install_dir_for(root, slug);
    let existing: Option<i64> =
        conn.query_row("SELECT id FROM installations WHERE project = ?1", params![slug], |r| r.get(0)).optional()?;

    let mut steps: Vec<Value> = Vec::new();
    steps.push(json!({"kind": "download", "text": crate::t!("Usar el archivo descargado de la release oficial: {asset_name}", "Use the file downloaded from the official release: {asset_name}"), "done": dl.is_some()}));
    match method {
        Method::ExtractZip => steps.push(json!({"kind": "extract", "text": crate::t!("Extraer el ZIP en {}", "Extract the ZIP into {}", dir.display())})),
        Method::CopyExe => steps.push(json!({"kind": "copy", "text": crate::t!("Copiar el ejecutable portable a {}", "Copy the portable executable to {}", dir.display())})),
        Method::Installer => steps.push(json!({"kind": "installer", "text": crate::i18n::tr("Es un instalador: NATIVE HUB lo abrirá solo cuando tú lo pidas, y después eliges el ejecutable que haya instalado.", "It is an installer: NATIVE HUB will only run it when you ask, and then you choose the executable it installed.")})),
        Method::Manual => steps.push(json!({"kind": "manual", "text": crate::i18n::tr("Este formato (7z, RAR u otro) no se extrae automáticamente: se abrirá la carpeta para que lo hagas tú y después eliges el ejecutable.", "This format (7z, RAR or other) is not extracted automatically: the folder will open so you can do it, and then you choose the executable.")})),
    }
    if matches!(method, Method::ExtractZip | Method::CopyExe) {
        steps.push(json!({"kind": "exe", "text": crate::i18n::tr("Buscar el ejecutable del juego. Si hay varios, te pediré que elijas.", "Find the game executable. If there are several, you will be asked to choose.")}));
    }
    if let Some(a) = &p.adapter {
        for f in &a.user_files {
            let when = match f.when.as_str() {
                "first_launch" => crate::i18n::tr("El juego te lo pedirá al abrirlo por primera vez; aquí puedes comprobar antes que es el correcto.", "The game will ask for it the first time you open it; here you can check beforehand that it is the right one."),
                // The game does not ask: the user copies it (NATIVE HUB never copies game files).
                "manual" => crate::i18n::tr("Tienes que copiarlo tú donde indica el proyecto; aquí puedes comprobar antes que es el correcto.", "You copy it yourself where the project says; here you can check beforehand that it is the right one."),
                _ => crate::i18n::tr("Te lo pediré durante la instalación.", "You will be asked for it during installation."),
            };
            steps.push(json!({"kind": "user_file", "text": format!("{}. {when}", f.label)}));
        }
        if let Some(fr) = &a.first_run {
            steps.push(json!({"kind": "first_run", "text": fr}));
        }
    } else if let Some(req) = (if crate::i18n::en() { p.data["requirementsTextEn"].as_str() } else { None }).or(p.data["requirementsText"].as_str()) {
        steps.push(json!({"kind": "requirements", "text": crate::t!("Requisitos según el proyecto: {req}", "Requirements according to the project: {req}")}));
    }
    steps.push(json!({"kind": "nothing_runs", "text": crate::i18n::tr("Nada se ejecuta durante la instalación. El juego solo se abre cuando pulses «Ejecutar».", "Nothing runs during installation. The game only opens when you press \"Launch\".")}));

    Ok(json!({
        "project": slug,
        "name": p.data["name"],
        "gameTitle": p.data["gameTitle"],
        "assetName": asset_name,
        "method": method,
        "installDir": dir.to_string_lossy(),
        "dirExists": dir.exists() && fs::read_dir(&dir).map(|mut d| d.next().is_some()).unwrap_or(false),
        "downloaded": dl.is_some(),
        "releaseTag": p.data.pointer("/release/tag"),
        "adapter": p.adapter.as_ref().map(|a| json!({"id": a.id, "version": a.version, "reviewedAt": a.reviewed_at, "userFiles": a.user_files})),
        "reviewed": p.adapter.as_ref().and_then(|a| a.reviewed_at.as_ref()).is_some(),
        "alreadyInstalled": existing,
        "steps": steps,
    }))
}

// ---------- Extracción segura ----------

/// Extrae un ZIP dentro de `dest`. Rechaza rutas absolutas o con `..`, enlaces simbólicos y
/// tamaños desproporcionados. Si todo cuelga de una sola carpeta raíz, la quita.
pub fn extract_zip(zip_path: &Path, dest: &Path) -> Result<usize> {
    let f = File::open(zip_path).map_err(|e| Error::Invalid(crate::t!("no se puede abrir el ZIP: {e}", "cannot open the ZIP: {e}")))?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| Error::Invalid(crate::t!("ZIP no válido: {e}", "invalid ZIP: {e}")))?;
    if zip.len() > MAX_ENTRIES {
        return Err(Error::Invalid(crate::i18n::tr("el ZIP tiene demasiados archivos", "the ZIP has too many files").into()));
    }
    // ¿Raíz común?
    let mut names = Vec::with_capacity(zip.len());
    let mut total: u64 = 0;
    for i in 0..zip.len() {
        let e = zip.by_index(i).map_err(|e| Error::Invalid(e.to_string()))?;
        let Some(p) = e.enclosed_name() else {
            return Err(Error::Invalid(crate::t!("ruta no permitida dentro del ZIP: {}", "path not allowed inside the ZIP: {}", e.name().map(|c| c.to_string()).unwrap_or_default())));
        };
        total = total.saturating_add(e.size());
        names.push(p);
    }
    if total > MAX_UNPACKED {
        return Err(Error::Invalid(crate::i18n::tr("el ZIP descomprimido ocupa demasiado", "the unpacked ZIP is too large").into()));
    }
    let first = |p: &PathBuf| p.components().next().map(|c| c.as_os_str().to_owned());
    let root = names.first().and_then(first);
    let strip = root.as_ref().is_some_and(|r| {
        names.iter().all(|n| first(n).as_ref() == Some(r) && (n.components().count() > 1 || zip_is_dir_name(n)))
    }) && names.iter().any(|n| n.components().count() > 1);

    fs::create_dir_all(dest).map_err(|e| Error::Invalid(crate::t!("no se puede crear la carpeta: {e}", "cannot create the folder: {e}")))?;
    let mut written = 0;
    for i in 0..zip.len() {
        let mut e = zip.by_index(i).map_err(|e| Error::Invalid(e.to_string()))?;
        let rel = e.enclosed_name().expect("comprobado antes");
        let rel: PathBuf = if strip { rel.components().skip(1).collect() } else { rel };
        if rel.as_os_str().is_empty() {
            continue;
        }
        if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
            return Err(Error::Invalid(crate::t!("ruta no permitida dentro del ZIP: {}", "path not allowed inside the ZIP: {}", rel.display())));
        }
        if e.is_symlink() {
            continue; // los enlaces simbólicos no se crean
        }
        let out = dest.join(&rel);
        if e.is_dir() {
            fs::create_dir_all(&out).map_err(|e| Error::Invalid(e.to_string()))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| Error::Invalid(e.to_string()))?;
        }
        let mut w = File::create(&out).map_err(|e| av_or(e, &crate::t!("no se puede escribir {}", "cannot write {}", out.display())))?;
        let mut buf = vec![0u8; 1 << 16];
        loop {
            let n = e.read(&mut buf).map_err(|err| Error::Invalid(crate::t!("ZIP dañado: {err}", "damaged ZIP: {err}")))?;
            if n == 0 {
                break;
            }
            w.write_all(&buf[..n]).map_err(|err| av_or(err, crate::i18n::tr("no se puede escribir", "cannot write")))?;
        }
        written += 1;
    }
    Ok(written)
}

/// El antivirus de Windows puede bloquear un ejecutable al extraerlo (error 225/226).
fn av_or(e: std::io::Error, context: &str) -> Error {
    match e.raw_os_error() {
        Some(225) | Some(226) => Error::Invalid(crate::t!(
            "{}Windows ha bloqueado un archivo del ZIP porque su antivirus lo considera peligroso. La instalación se ha cancelado.",
            "{}Windows blocked a file in the ZIP because its antivirus considers it dangerous. The installation was cancelled.",
            download::AV_PREFIX
        )),
        _ => Error::Invalid(format!("{context}: {e}")),
    }
}

fn zip_is_dir_name(p: &Path) -> bool {
    p.components().count() == 1
}

/// Ejecutables candidatos dentro de la instalación, el más probable primero.
pub fn find_executables(dir: &Path, hint: Option<&str>) -> Vec<PathBuf> {
    let skip = Regex::new(r"(?i)(unins|setup|install|crash|report|vc_?redist|dxsetup|updater|update|helper|elevate|uninstall|7z|python|zig)").expect("regex");
    let hint = hint.and_then(|h| Regex::new(h).ok());
    let mut found = Vec::new();
    fn walk(d: &Path, depth: usize, out: &mut Vec<(usize, PathBuf)>) {
        if depth > 3 {
            return;
        }
        let Ok(rd) = fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            match e.file_type() {
                Ok(t) if t.is_dir() => walk(&p, depth + 1, out),
                Ok(t) if t.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("exe")) => out.push((depth, p)),
                _ => {}
            }
        }
    }
    walk(dir, 0, &mut found);
    let name = |p: &PathBuf| p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if let Some(h) = &hint {
        let hinted: Vec<_> = found.iter().filter(|(_, p)| h.is_match(&name(p))).map(|(_, p)| p.clone()).collect();
        if !hinted.is_empty() {
            return hinted;
        }
    }
    let mut good: Vec<_> = found.into_iter().filter(|(_, p)| !skip.is_match(&name(p))).collect();
    good.sort_by_key(|(d, p)| (*d, name(p).len()));
    good.into_iter().map(|(_, p)| p).collect()
}

fn is_inside(path: &Path, dir: &Path) -> bool {
    match (path.canonicalize(), dir.canonicalize()) {
        (Ok(p), Ok(d)) => p.starts_with(d),
        _ => false,
    }
}

// ---------- Instalar ----------

/// Instala un proyecto ya descargado. Devuelve la fila de la instalación.
pub fn install(conn: &Connection, slug: &str, root: &Path) -> Result<Value> {
    let p = project(conn, slug)?;
    if p.data["takedown"].as_bool() == Some(true) {
        return Err(Error::Invalid(crate::i18n::tr("el proyecto está retirado por DMCA", "the project was taken down by DMCA").into()));
    }
    if conn.query_row("SELECT 1 FROM installations WHERE project = ?1", params![slug], |_| Ok(())).optional()?.is_some() {
        return Err(Error::Invalid(crate::i18n::tr("ya está instalado", "already installed").into()));
    }
    let url = p.data.pointer("/windowsAsset/url").and_then(Value::as_str).unwrap_or_default().to_owned();
    let (_, file, tag, dl_name) = finished_download(conn, slug, &url)?.ok_or_else(|| Error::Invalid(crate::i18n::tr("primero descarga el archivo", "download the file first").into()))?;
    let asset_name = if dl_name.is_empty() {
        p.data.pointer("/windowsAsset/name").and_then(Value::as_str).unwrap_or_default().to_owned()
    } else {
        dl_name
    };
    let file = PathBuf::from(file);
    if !file.exists() {
        return Err(Error::Invalid(crate::i18n::tr("el archivo descargado ya no está en disco; vuelve a descargarlo", "the downloaded file is no longer on disk; download it again").into()));
    }
    let dir = install_dir_for(root, slug);
    if dir.exists() && fs::read_dir(&dir).map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err(Error::Invalid(crate::t!("la carpeta {} ya existe y no está vacía", "the folder {} already exists and is not empty", dir.display())));
    }
    fs::create_dir_all(&dir).map_err(|e| Error::Invalid(crate::t!("no se puede crear la carpeta: {e}", "cannot create the folder: {e}")))?;

    let method = method_for(&asset_name);
    let hint = p.adapter.as_ref().and_then(|a| a.exe_hint.clone());
    let (exe, candidates, pending) = match method {
        Method::ExtractZip => {
            if let Err(e) = extract_zip(&file, &dir) {
                let _ = fs::remove_dir_all(&dir);
                return Err(e);
            }
            let c = find_executables(&dir, hint.as_deref());
            // Si solo hay uno en el nivel más alto, ese es el juego; si no, el usuario elige.
            let depth = |p: &PathBuf| p.strip_prefix(&dir).map(|r| r.components().count()).unwrap_or(usize::MAX);
            let top = c.iter().map(depth).min().unwrap_or(0);
            let at_top: Vec<_> = c.iter().filter(|p| depth(p) == top).cloned().collect();
            match (c.len(), at_top.len()) {
                (0, _) => (None, c, Some("no_exe")),
                (_, 1) => (Some(at_top[0].clone()), c, None),
                _ => (None, c, Some("choose_exe")),
            }
        }
        Method::CopyExe => {
            let name = download::safe_file_name(&asset_name).ok_or_else(|| Error::Invalid(crate::i18n::tr("nombre de archivo no válido", "invalid file name").into()))?;
            let to = dir.join(name);
            fs::copy(&file, &to).map_err(|e| Error::Invalid(crate::t!("no se puede copiar: {e}", "cannot copy: {e}")))?;
            (Some(to.clone()), vec![to], None)
        }
        Method::Installer => (None, vec![], Some("run_installer")),
        Method::Manual => {
            let name = download::safe_file_name(&asset_name).unwrap_or_else(|| "archivo".into());
            let _ = fs::copy(&file, dir.join(name));
            (None, vec![], Some("manual_extract"))
        }
    };
    let state = if exe.is_some() { "ready" } else { "needs_files" };
    let config = json!({
        "method": method,
        "pending": pending,
        "candidates": candidates.iter().map(|c| c.to_string_lossy()).collect::<Vec<_>>(),
        "installerPath": if method == Method::Installer { Some(file.to_string_lossy().to_string()) } else { None },
        "adapter": p.adapter.as_ref().map(|a| json!({"id": a.id, "version": a.version})),
        "userFiles": {},
    });
    conn.execute(
        "INSERT INTO installations (project, release_tag, install_dir, executable_path, state, installed_at, config)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![slug, tag, dir.to_string_lossy(), exe.as_ref().map(|e| e.to_string_lossy().to_string()), state, time::now_iso(), config.to_string()],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute("INSERT INTO audit_log (action, subject, detail) VALUES ('install', ?1, ?2)", params![slug, dir.to_string_lossy()])?;
    get(conn, id)
}

pub fn get(conn: &Connection, id: i64) -> Result<Value> {
    list_where(conn, "WHERE i.id = ?1", params![id])?.into_iter().next().ok_or_else(|| Error::NotFound(crate::t!("instalación {id}", "installation {id}")))
}

pub fn list(conn: &Connection) -> Result<Vec<Value>> {
    list_where(conn, "", [])
}

fn list_where(conn: &Connection, w: &str, p: impl rusqlite::Params) -> Result<Vec<Value>> {
    let sql = format!(
        "SELECT i.id, i.project, i.release_tag, i.install_dir, i.executable_path, i.state, i.installed_at, i.updated_at, i.config, p.data
         FROM installations i LEFT JOIN projects p ON p.slug = i.project {w} ORDER BY i.installed_at DESC"
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(p, |r| {
        let config: Option<String> = r.get(8)?;
        let data: Option<String> = r.get(9)?;
        let data: Value = data.and_then(|d| serde_json::from_str(&d).ok()).unwrap_or(Value::Null);
        let tag: Option<String> = r.get(2)?;
        let latest = data.pointer("/release/tag").and_then(Value::as_str).map(str::to_owned);
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "project": r.get::<_, String>(1)?,
            "releaseTag": tag,
            "latestTag": latest,
            "updateAvailable": matches!((&tag, &latest), (Some(a), Some(b)) if a != b),
            "installDir": r.get::<_, String>(3)?,
            "executablePath": r.get::<_, Option<String>>(4)?,
            "state": r.get::<_, String>(5)?,
            "installedAt": r.get::<_, String>(6)?,
            "lastPlayedAt": r.get::<_, Option<String>>(7)?,
            "config": config.and_then(|c| serde_json::from_str::<Value>(&c).ok()).unwrap_or(json!({})),
            "projectData": data,
        }))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn row(conn: &Connection, id: i64) -> Result<(String, String, Option<String>, Value)> {
    conn.query_row(
        "SELECT project, install_dir, executable_path, config FROM installations WHERE id = ?1",
        params![id],
        |r| {
            let c: Option<String> = r.get(3)?;
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, c.and_then(|c| serde_json::from_str(&c).ok()).unwrap_or(json!({}))))
        },
    )
    .optional()?
    .ok_or_else(|| Error::NotFound(crate::t!("instalación {id}", "installation {id}")))
}

/// Fija el ejecutable que se abrirá con «Ejecutar». Debe estar dentro de la carpeta del juego,
/// salvo en los instalados con un instalador externo, donde lo elige el usuario.
pub fn set_executable(conn: &Connection, id: i64, exe: &Path) -> Result<Value> {
    let (_, dir, _, mut config) = row(conn, id)?;
    if !exe.is_file() || !exe.extension().is_some_and(|x| x.eq_ignore_ascii_case("exe")) {
        return Err(Error::Invalid(crate::i18n::tr("elige un archivo .exe que exista", "choose an existing .exe file").into()));
    }
    let external = matches!(config["method"].as_str(), Some("installer") | Some("manual"));
    if !external && !is_inside(exe, Path::new(&dir)) {
        return Err(Error::Invalid(crate::i18n::tr("el ejecutable tiene que estar dentro de la carpeta del juego", "the executable must be inside the game folder").into()));
    }
    config["pending"] = Value::Null;
    conn.execute(
        "UPDATE installations SET executable_path = ?2, state = 'ready', config = ?3 WHERE id = ?1",
        params![id, exe.to_string_lossy(), config.to_string()],
    )?;
    get(conn, id)
}

/// Lo que hay que lanzar para «Ejecutar»: ejecutable y carpeta de trabajo, ya validados.
pub fn launch_target(conn: &Connection, id: i64) -> Result<(PathBuf, PathBuf)> {
    let (_, dir, exe, config) = row(conn, id)?;
    let exe = PathBuf::from(exe.ok_or_else(|| Error::Invalid(crate::i18n::tr("todavía no hay ejecutable elegido", "no executable chosen yet").into()))?);
    if !exe.is_file() {
        return Err(Error::Invalid(crate::t!("no se encuentra {}", "cannot find {}", exe.display())));
    }
    let external = matches!(config["method"].as_str(), Some("installer") | Some("manual"));
    if !external && !is_inside(&exe, Path::new(&dir)) {
        return Err(Error::Invalid(crate::i18n::tr("el ejecutable está fuera de la carpeta del juego", "the executable is outside the game folder").into()));
    }
    let wd = exe.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(&dir));
    conn.execute("UPDATE installations SET updated_at = ?2 WHERE id = ?1", params![id, time::now_iso()])?;
    conn.execute("INSERT INTO audit_log (action, subject, detail) VALUES ('launch', ?1, ?2)", params![id.to_string(), exe.to_string_lossy()])?;
    Ok((exe, wd))
}

/// Instalador descargado de una instalación de tipo «installer».
pub fn installer_path(conn: &Connection, id: i64) -> Result<PathBuf> {
    let (_, _, _, config) = row(conn, id)?;
    let p = config["installerPath"].as_str().ok_or_else(|| Error::Invalid(crate::i18n::tr("esta instalación no usa instalador", "this installation does not use an installer").into()))?;
    Ok(PathBuf::from(p))
}

/// Desinstala: borra la carpeta del juego (solo si está dentro de `root`) y la fila.
/// Los programas instalados con su propio instalador se desinstalan desde Windows.
pub fn uninstall(conn: &Connection, id: i64, root: &Path, delete_files: bool) -> Result<()> {
    let (slug, dir, _, _) = row(conn, id)?;
    if delete_files {
        let d = PathBuf::from(&dir);
        if d.exists() {
            if !is_inside(&d, root) || d.canonicalize().ok() == root.canonicalize().ok() {
                return Err(Error::Invalid(crate::i18n::tr("la carpeta no está dentro de la carpeta de juegos de NATIVE HUB; bórrala a mano", "the folder is not inside the NATIVE HUB games folder; delete it by hand").into()));
            }
            fs::remove_dir_all(&d).map_err(|e| Error::Invalid(crate::t!("no se pudo borrar la carpeta: {e}", "could not delete the folder: {e}")))?;
        }
    }
    conn.execute("DELETE FROM installations WHERE id = ?1", params![id])?;
    conn.execute("INSERT INTO audit_log (action, subject, detail) VALUES ('uninstall', ?1, ?2)", params![slug, dir])?;
    Ok(())
}

// ---------- Game File Validator ----------

/// Comprueba un archivo del usuario contra las reglas del adaptador. No lo copia ni lo modifica.
pub fn validate_user_file(path: &Path, rule: &UserFileRule) -> Result<Value> {
    let meta = fs::metadata(path).map_err(|e| Error::Invalid(crate::t!("no se puede leer el archivo: {e}", "cannot read the file: {e}")))?;
    if !meta.is_file() {
        return Err(Error::Invalid(crate::i18n::tr("eso no es un archivo", "that is not a file").into()));
    }
    let size = meta.len();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut head = [0u8; 16];
    let n = File::open(path).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    let head_hex: String = head[..n].iter().map(|b| format!("{b:02x}")).collect();

    let mut checks = Vec::new();
    let ext_ok = rule.extensions.is_empty() || rule.extensions.iter().any(|e| e.trim_start_matches('.').eq_ignore_ascii_case(&ext));
    checks.push(json!({"check": "extension", "ok": ext_ok, "text": crate::t!("Extensión .{ext}", "Extension .{ext}")}));
    let magic_ok = rule.magic.is_empty() || rule.magic.iter().any(|m| head_hex.starts_with(&m.to_lowercase()));
    if !rule.magic.is_empty() {
        checks.push(json!({"check": "header", "ok": magic_ok, "text": if magic_ok { crate::i18n::tr("La cabecera corresponde al tipo de archivo esperado", "The header matches the expected file type") } else { crate::i18n::tr("La cabecera no es la esperada", "The header is not the expected one") }}));
    }
    let size_ok = rule.min_size.is_none_or(|m| size >= m) && rule.max_size.is_none_or(|m| size <= m);
    if rule.min_size.is_some() || rule.max_size.is_some() {
        checks.push(json!({"check": "size", "ok": size_ok, "text": crate::t!("Tamaño: {size} bytes", "Size: {size} bytes")}));
    }
    let mut sha1_ok = true;
    if !rule.sha1.is_empty() {
        // SHA-1 solo cuando el proyecto publica los valores aceptados.
        use sha1::Digest;
        let mut h = sha1::Sha1::new();
        let mut f = File::open(path).map_err(|e| Error::Invalid(e.to_string()))?;
        let mut buf = vec![0u8; 1 << 16];
        loop {
            let n = f.read(&mut buf).map_err(|e| Error::Invalid(e.to_string()))?;
            if n == 0 {
                break;
            }
            h.update(&buf[..n]);
        }
        let got: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
        sha1_ok = rule.sha1.iter().any(|s| s.eq_ignore_ascii_case(&got));
        checks.push(json!({"check": "sha1", "ok": sha1_ok, "text": format!("SHA-1 {got}")}));
    }
    let ok = ext_ok && magic_ok && size_ok && sha1_ok;
    Ok(json!({"ok": ok, "size": size, "checks": checks}))
}

/// Guarda en la instalación el archivo del usuario validado (solo la ruta, nada se copia).
pub fn record_user_file(conn: &Connection, id: i64, key: &str, path: &Path, valid: bool) -> Result<()> {
    conn.execute("DELETE FROM user_files WHERE installation = ?1 AND requirement_key = ?2", params![id, key])?;
    conn.execute(
        "INSERT INTO user_files (installation, requirement_key, path, size, validated_at, valid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, key, path.to_string_lossy(), fs::metadata(path).map(|m| m.len() as i64).ok(), time::now_iso(), valid],
    )?;
    Ok(())
}

pub fn user_files(conn: &Connection, id: i64) -> Result<Vec<Value>> {
    let mut st = conn.prepare("SELECT requirement_key, path, size, validated_at, valid FROM user_files WHERE installation = ?1")?;
    let rows = st.query_map(params![id], |r| {
        Ok(json!({"key": r.get::<_, String>(0)?, "path": r.get::<_, String>(1)?, "size": r.get::<_, Option<i64>>(2)?,
                  "validatedAt": r.get::<_, Option<String>>(3)?, "valid": r.get::<_, Option<bool>>(4)?}))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn adapter_rule(conn: &Connection, slug: &str, key: &str) -> Result<UserFileRule> {
    let p = project(conn, slug)?;
    p.adapter
        .and_then(|a| a.user_files.into_iter().find(|f| f.key == key))
        .ok_or_else(|| Error::NotFound(crate::t!("requisito {key}", "requirement {key}")))
}

