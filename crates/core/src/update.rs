//! Update Manager (fase 6): actualiza una instalación a una versión descargada sin perder
//! partidas, configuración ni mods.
//!
//! Reglas:
//! 1. Nada se borra: los archivos que solo están en tu carpeta (partidas, capturas, mods) se quedan.
//! 2. Los archivos nuevos de la versión se añaden.
//! 3. Un archivo que existe en ambos lados se reemplaza, salvo que se deba conservar:
//!    - siempre, si coincide con `preserve` del adaptador revisado;
//!    - si coincide con los patrones habituales de partidas y configuración y además se modificó
//!      después de instalar (lo cambió el juego o tú).
//! 4. Antes de reemplazar, se guarda una copia de cada archivo afectado. Si algo falla a mitad, se
//!    restaura todo. Después se puede deshacer la actualización.
//!
//! Nada se ejecuta. Los instaladores externos se actualizan abriendo el instalador nuevo.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::install::{self, Method};
use crate::{Error, Result, time};

/// Partidas y configuración habituales. Solo se conservan si cambiaron después de instalar.
pub const DEFAULT_PRESERVE: &[&str] = &[
    "**/*.sav", "**/*.save", "**/*.srm", "**/*.sav.bak",
    "**/save/**", "**/saves/**", "**/savedata/**", "**/saved/**", "**/userdata/**", "**/user/**",
    "**/mods/**", "**/screenshots/**",
    "**/*.ini", "**/*.cfg", "**/*.conf", "**/*.toml", "**/*.json", "**/*.yaml", "**/*.yml", "**/*.xml",
];

/// Convierte un patrón tipo glob (`**`, `*`, `?`) en una expresión regular, sin distinguir mayúsculas.
pub fn glob_to_regex(glob: &str) -> Regex {
    let mut re = String::from("(?i)^");
    let g = glob.replace('\\', "/");
    let chars: Vec<char> = g.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '*' if chars.get(i + 1) == Some(&'*') => {
                // `**/` = cualquier número de carpetas (también ninguna)
                if chars.get(i + 2) == Some(&'/') {
                    re.push_str("(?:.*/)?");
                    i += 3;
                } else {
                    re.push_str(".*");
                    i += 2;
                }
                continue;
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            c if "\\.+()|[]{}^$".contains(c) => {
                re.push('\\');
                re.push(c);
            }
            c => re.push(c),
        }
        i += 1;
    }
    re.push('$');
    Regex::new(&re).unwrap_or_else(|_| Regex::new("^$").expect("regex"))
}

fn rel_string(p: &Path) -> String {
    p.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

fn walk_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            match e.file_type() {
                Ok(t) if t.is_dir() => stack.push(p),
                Ok(t) if t.is_file() => {
                    if let Ok(r) = p.strip_prefix(root) {
                        out.push(r.to_path_buf());
                    }
                }
                _ => {}
            }
        }
    }
    out.sort();
    out
}

fn mtime(p: &Path) -> Option<i64> {
    fs::metadata(p).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
}

struct Inst {
    project: String,
    dir: PathBuf,
    tag: Option<String>,
    installed_at: i64,
    config: Value,
    preserve: Vec<String>,
}

fn load(conn: &Connection, id: i64) -> Result<Inst> {
    let (project, dir, tag, installed_at, config, data): (String, String, Option<String>, String, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT i.project, i.install_dir, i.release_tag, i.installed_at, i.config, p.data
             FROM installations i LEFT JOIN projects p ON p.slug = i.project WHERE i.id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("instalación {id}")))?;
    let config: Value = config.and_then(|c| serde_json::from_str(&c).ok()).unwrap_or(json!({}));
    let data: Value = data.and_then(|d| serde_json::from_str(&d).ok()).unwrap_or(Value::Null);
    let preserve = data
        .pointer("/adapter/preserve")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default();
    // Las instalaciones guardan la hora de la última actualización en config, si la hubo.
    let since = config["updatedFilesAt"].as_str().unwrap_or(&installed_at).to_owned();
    Ok(Inst { project, dir: PathBuf::from(dir), tag, installed_at: time::parse_iso(&since).unwrap_or(0), config, preserve })
}

/// Descarga terminada con una versión distinta de la instalada (la más reciente).
fn update_download(conn: &Connection, inst: &Inst) -> Result<Option<(i64, PathBuf, String, String)>> {
    Ok(conn
        .query_row(
            "SELECT id, dest_path, COALESCE(release_tag, ''), COALESCE(asset_name, '') FROM downloads
             WHERE project = ?1 AND state = 'done' AND COALESCE(release_tag, '') <> COALESCE(?2, '')
             ORDER BY finished_at DESC, id DESC LIMIT 1",
            params![inst.project, inst.tag],
            |r| Ok((r.get(0)?, PathBuf::from(r.get::<_, String>(1)?), r.get(2)?, r.get(3)?)),
        )
        .optional()?)
}

#[derive(Debug, Default)]
struct Diff {
    added: Vec<String>,
    replaced: Vec<String>,
    preserved: Vec<(String, &'static str)>,
    kept_only_yours: usize,
}

fn diff(inst: &Inst, staging: &Path) -> Diff {
    let adapter_re: Vec<Regex> = inst.preserve.iter().map(|g| glob_to_regex(g)).collect();
    let default_re: Vec<Regex> = DEFAULT_PRESERVE.iter().map(|g| glob_to_regex(g)).collect();
    let new_files: Vec<String> = walk_files(staging).iter().map(|p| rel_string(p)).collect();
    let mut d = Diff::default();
    for rel in &new_files {
        let cur = inst.dir.join(rel);
        if !cur.is_file() {
            d.added.push(rel.clone());
        } else if adapter_re.iter().any(|r| r.is_match(rel)) {
            d.preserved.push((rel.clone(), "adapter"));
        } else if default_re.iter().any(|r| r.is_match(rel)) && mtime(&cur).is_some_and(|m| m > inst.installed_at + 2) {
            d.preserved.push((rel.clone(), "modified"));
        } else {
            d.replaced.push(rel.clone());
        }
    }
    let new_set: std::collections::HashSet<&String> = new_files.iter().collect();
    d.kept_only_yours = walk_files(&inst.dir).iter().filter(|p| !new_set.contains(&rel_string(p))).count();
    d
}

fn staging_dir(root: &Path, slug: &str) -> PathBuf {
    root.join(".native-hub").join("staging").join(slug)
}

fn backup_dir(root: &Path, slug: &str, tag: &str) -> PathBuf {
    let safe: String = tag.chars().map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '_' }).collect();
    root.join(".native-hub").join("backups").join(format!("{slug}-{safe}-{}", time::now_unix()))
}

/// Prepara la nueva versión en una carpeta aparte y devuelve qué cambiaría. No toca la instalación.
pub fn plan(conn: &Connection, id: i64, root: &Path) -> Result<Value> {
    let inst = load(conn, id)?;
    let Some((_, file, new_tag, asset)) = update_download(conn, &inst)? else {
        return Ok(json!({"ready": false, "reason": "download", "currentTag": inst.tag}));
    };
    if !file.exists() {
        return Ok(json!({"ready": false, "reason": "download", "currentTag": inst.tag}));
    }
    let method = install::method_for(&asset);
    if method != Method::ExtractZip && method != Method::CopyExe {
        return Ok(json!({"ready": false, "reason": "method", "method": method, "currentTag": inst.tag, "newTag": new_tag}));
    }
    let staging = staging_dir(root, &inst.project);
    let _ = fs::remove_dir_all(&staging);
    match method {
        Method::ExtractZip => {
            install::extract_zip(&file, &staging)?;
        }
        _ => {
            fs::create_dir_all(&staging).map_err(|e| Error::Invalid(e.to_string()))?;
            let name = crate::download::safe_file_name(&asset).ok_or_else(|| Error::Invalid("nombre de archivo no válido".into()))?;
            fs::copy(&file, staging.join(name)).map_err(|e| Error::Invalid(e.to_string()))?;
        }
    }
    let d = diff(&inst, &staging);
    Ok(json!({
        "ready": true,
        "currentTag": inst.tag,
        "newTag": new_tag,
        "assetName": asset,
        "installDir": inst.dir.to_string_lossy(),
        "added": d.added.len(),
        "replaced": d.replaced.len(),
        "preserved": d.preserved.iter().map(|(p, why)| json!({"path": p, "why": why})).collect::<Vec<_>>(),
        "keptOnlyYours": d.kept_only_yours,
        "sampleReplaced": d.replaced.iter().take(12).collect::<Vec<_>>(),
        "sampleAdded": d.added.iter().take(12).collect::<Vec<_>>(),
        "hasPreviousBackup": inst.config["updateBackup"].is_object(),
    }))
}

/// Aplica la actualización preparada por `plan`. Si algo falla, deja la instalación como estaba.
pub fn apply(conn: &Connection, id: i64, root: &Path) -> Result<Value> {
    let mut inst = load(conn, id)?;
    let (_, _, new_tag, _) = update_download(conn, &inst)?.ok_or_else(|| Error::Invalid("primero descarga la versión nueva".into()))?;
    let staging = staging_dir(root, &inst.project);
    if !staging.is_dir() {
        return Err(Error::Invalid("prepara la actualización otra vez".into()));
    }
    let d = diff(&inst, &staging);
    let old_tag = inst.tag.clone().unwrap_or_else(|| "sin-version".into());
    let backup = backup_dir(root, &inst.project, &old_tag);
    fs::create_dir_all(&backup).map_err(|e| Error::Invalid(format!("no se puede crear la copia de seguridad: {e}")))?;

    let mut done_replaced: Vec<String> = Vec::new();
    let mut done_added: Vec<String> = Vec::new();
    let result = (|| -> Result<()> {
        for rel in &d.replaced {
            let cur = inst.dir.join(rel);
            let bak = backup.join(rel);
            if let Some(p) = bak.parent() {
                fs::create_dir_all(p).map_err(|e| Error::Invalid(e.to_string()))?;
            }
            fs::copy(&cur, &bak).map_err(|e| Error::Invalid(format!("copia de seguridad de {rel}: {e}")))?;
            fs::copy(staging.join(rel), &cur).map_err(|e| Error::Invalid(format!("no se pudo reemplazar {rel}: {e}")))?;
            done_replaced.push(rel.clone());
        }
        for rel in &d.added {
            let to = inst.dir.join(rel);
            if let Some(p) = to.parent() {
                fs::create_dir_all(p).map_err(|e| Error::Invalid(e.to_string()))?;
            }
            fs::copy(staging.join(rel), &to).map_err(|e| Error::Invalid(format!("no se pudo añadir {rel}: {e}")))?;
            done_added.push(rel.clone());
        }
        Ok(())
    })();

    if let Err(e) = result {
        // Deshacer lo hecho: restaurar reemplazados y quitar añadidos.
        for rel in &done_replaced {
            let _ = fs::copy(backup.join(rel), inst.dir.join(rel));
        }
        for rel in &done_added {
            let _ = fs::remove_file(inst.dir.join(rel));
        }
        let _ = fs::remove_dir_all(&backup);
        return Err(Error::Invalid(format!("la actualización no se completó y se ha dejado todo como estaba: {e}")));
    }

    // Borrar la copia de la actualización anterior: solo se guarda una para deshacer.
    if let Some(prev) = inst.config["updateBackup"]["path"].as_str() {
        let prev = PathBuf::from(prev);
        if prev.starts_with(root.join(".native-hub").join("backups")) {
            let _ = fs::remove_dir_all(prev);
        }
    }
    let _ = fs::remove_dir_all(&staging);

    inst.config["updateBackup"] = json!({
        "path": backup.to_string_lossy(),
        "fromTag": old_tag,
        "toTag": new_tag,
        "replaced": done_replaced,
        "added": done_added,
        "at": time::now_iso(),
    });
    inst.config["updatedFilesAt"] = json!(time::now_iso());
    // Si el ejecutable desapareció con la versión nueva, volver a buscarlo.
    let exe: Option<String> = conn.query_row("SELECT executable_path FROM installations WHERE id = ?1", params![id], |r| r.get(0))?;
    let mut state = "ready";
    let mut exe_new = exe.clone();
    if exe.as_ref().is_none_or(|e| !Path::new(e).is_file()) {
        let c = install::find_executables(&inst.dir, None);
        exe_new = (c.len() == 1).then(|| c[0].to_string_lossy().to_string());
        if exe_new.is_none() {
            state = "needs_files";
            inst.config["pending"] = json!("choose_exe");
            inst.config["candidates"] = json!(c.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>());
        }
    }
    conn.execute(
        "UPDATE installations SET release_tag = ?2, executable_path = ?3, state = ?4, config = ?5 WHERE id = ?1",
        params![id, new_tag, exe_new, state, inst.config.to_string()],
    )?;
    conn.execute(
        "INSERT INTO audit_log (action, subject, detail) VALUES ('update', ?1, ?2)",
        params![inst.project, format!("{old_tag} → {new_tag}: {} reemplazados, {} añadidos, {} conservados", d.replaced.len(), d.added.len(), d.preserved.len())],
    )?;
    Ok(json!({
        "fromTag": old_tag, "toTag": new_tag,
        "replaced": d.replaced.len(), "added": d.added.len(), "preserved": d.preserved.len(),
        "installation": install::get(conn, id)?,
    }))
}

/// Deshace la última actualización: restaura los archivos reemplazados y quita los añadidos.
pub fn rollback(conn: &Connection, id: i64, root: &Path) -> Result<Value> {
    let mut inst = load(conn, id)?;
    let b = inst.config["updateBackup"].clone();
    let path = PathBuf::from(b["path"].as_str().ok_or_else(|| Error::Invalid("no hay ninguna actualización que deshacer".into()))?);
    if !path.starts_with(root.join(".native-hub").join("backups")) || !path.is_dir() {
        return Err(Error::Invalid("la copia de seguridad ya no está disponible".into()));
    }
    for rel in b["replaced"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        fs::copy(path.join(rel), inst.dir.join(rel)).map_err(|e| Error::Invalid(format!("no se pudo restaurar {rel}: {e}")))?;
    }
    for rel in b["added"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        let _ = fs::remove_file(inst.dir.join(rel));
    }
    let from = b["fromTag"].as_str().map(str::to_owned);
    let _ = fs::remove_dir_all(&path);
    inst.config["updateBackup"] = Value::Null;
    conn.execute(
        "UPDATE installations SET release_tag = ?2, config = ?3 WHERE id = ?1",
        params![id, from, inst.config.to_string()],
    )?;
    conn.execute("INSERT INTO audit_log (action, subject, detail) VALUES ('update_rollback', ?1, ?2)", params![inst.project, from])?;
    install::get(conn, id)
}

/// Descarta una actualización preparada que no se aplicó.
pub fn discard(conn: &Connection, id: i64, root: &Path) -> Result<()> {
    let inst = load(conn, id)?;
    let _ = fs::remove_dir_all(staging_dir(root, &inst.project));
    Ok(())
}
