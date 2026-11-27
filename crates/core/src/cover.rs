//! Portadas de los juegos.
//!
//! El catálogo solo guarda el `image_id` de IGDB de cada juego. La imagen es pública
//! (images.igdb.com, sin clave): se descarga la primera vez que se muestra y se guarda en
//! la carpeta de caché de la app, así que después funciona sin conexión.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use crate::{Error, Result};

const HOST: &str = "images.igdb.com";
const USER_AGENT: &str = concat!("NATIVE-HUB/", env!("CARGO_PKG_VERSION"));
/// Una portada de IGDB pesa decenas de KB; más de esto no es una portada.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// Tamaños de IGDB que usa la interfaz (miniatura de las listas y portada de la ficha).
pub const SIZES: &[&str] = &["t_cover_small", "t_cover_small_2x", "t_cover_big", "t_cover_big_2x"];

/// Un image_id de IGDB: minúsculas y dígitos. Se comprueba porque acaba en una ruta y una URL.
pub fn valid_image_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn check(size: &str, image_id: &str) -> Result<()> {
    if !SIZES.contains(&size) {
        return Err(Error::Http(crate::t!("tamaño de portada no válido: {size}", "invalid cover size: {size}")));
    }
    if !valid_image_id(image_id) {
        return Err(Error::Http(crate::t!("portada no válida: {image_id}", "invalid cover: {image_id}")));
    }
    Ok(())
}

/// Lee la ruta de una petición `cover://localhost/<tamaño>/<image_id>` (o
/// `http://cover.localhost/...` en Windows). La interfaz la construye con `convertFileSrc`,
/// que codifica la barra como `%2F`.
pub fn parse_request_path(path: &str) -> Option<(&'static str, String)> {
    let p = path.trim_start_matches('/').replace("%2F", "/").replace("%2f", "/");
    let (size, file) = p.split_once('/')?;
    let id = file.strip_suffix(".jpg").unwrap_or(file);
    let size = SIZES.iter().copied().find(|s| *s == size)?;
    valid_image_id(id).then(|| (size, id.to_owned()))
}

pub fn url(size: &str, image_id: &str) -> String {
    format!("https://{HOST}/igdb/image/upload/{size}/{image_id}.jpg")
}

pub fn cache_path(cache_dir: &Path, size: &str, image_id: &str) -> PathBuf {
    cache_dir.join(size).join(format!("{image_id}.jpg"))
}

/// Algo que sabe descargar una imagen. La app usa `UreqImages`; las pruebas, un doble.
pub trait ImageFetcher: Send + Sync {
    fn get(&self, url: &str) -> Result<Vec<u8>>;
}

pub struct UreqImages {
    agent: ureq::Agent,
}

impl Default for UreqImages {
    fn default() -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .https_only(true)
            .build()
            .into();
        Self { agent }
    }
}

impl ImageFetcher for UreqImages {
    fn get(&self, url: &str) -> Result<Vec<u8>> {
        if crate::http::host_of(url) != Some(HOST) {
            return Err(Error::Http(crate::t!("host no permitido: {url}", "host not allowed: {url}")));
        }
        let mut resp = self.agent.get(url).header("User-Agent", USER_AGENT).call().map_err(|e| Error::Http(e.to_string()))?;
        let mut buf = Vec::new();
        resp.body_mut()
            .as_reader()
            .take(MAX_BYTES + 1)
            .read_to_end(&mut buf)
            .map_err(|e| Error::Http(e.to_string()))?;
        if buf.len() as u64 > MAX_BYTES {
            return Err(Error::Http(crate::i18n::tr("portada demasiado grande", "cover too large").into()));
        }
        Ok(buf)
    }
}

/// Devuelve la portada en JPEG: de la caché si está, si no la descarga y la guarda.
pub fn get(cache_dir: &Path, f: &dyn ImageFetcher, size: &str, image_id: &str) -> Result<Vec<u8>> {
    check(size, image_id)?;
    let path = cache_path(cache_dir, size, image_id);
    if let Ok(bytes) = fs::read(&path) {
        if is_jpeg(&bytes) {
            return Ok(bytes);
        }
    }
    let bytes = f.get(&url(size, image_id))?;
    if !is_jpeg(&bytes) {
        return Err(Error::Http(crate::i18n::tr("la portada no es una imagen JPEG", "the cover is not a JPEG image").into()));
    }
    // Se escribe a un temporal y se renombra: una descarga cortada nunca queda como portada.
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(io)?;
    }
    // Nombre temporal único: dos peticiones simultáneas de la misma portada no se pisan.
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let tmp = path.with_extension(format!("{}-{}.part", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
    fs::write(&tmp, &bytes).map_err(io)?;
    fs::rename(&tmp, &path).map_err(io)?;
    Ok(bytes)
}

fn io(e: std::io::Error) -> Error {
    Error::Invalid(crate::t!("caché de portadas: {e}", "cover cache: {e}"))
}

fn is_jpeg(b: &[u8]) -> bool {
    b.len() > 3 && b[..3] == [0xFF, 0xD8, 0xFF]
}

/// Tamaño total de la caché de portadas, en bytes.
pub fn cache_size(cache_dir: &Path) -> u64 {
    SIZES
        .iter()
        .filter_map(|s| fs::read_dir(cache_dir.join(s)).ok())
        .flatten()
        .filter_map(|e| e.ok()?.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

/// Borra la caché de portadas. Se vuelven a descargar cuando hagan falta.
pub fn clear_cache(cache_dir: &Path) -> Result<()> {
    for s in SIZES {
        let dir = cache_dir.join(s);
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(io)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    struct Fake {
        calls: AtomicUsize,
        body: Vec<u8>,
    }
    impl ImageFetcher for Fake {
        fn get(&self, url: &str) -> Result<Vec<u8>> {
            assert_eq!(url, "https://images.igdb.com/igdb/image/upload/t_cover_big/co3pah.jpg");
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.body.clone())
        }
    }

    #[test]
    fn valida_identificadores() {
        assert!(valid_image_id("co3pah"));
        assert!(!valid_image_id(""));
        assert!(!valid_image_id("../x"));
        assert!(!valid_image_id("CO3PAH"));
        assert!(check("t_original", "co3pah").is_err());
    }

    #[test]
    fn lee_la_ruta_de_la_peticion() {
        assert_eq!(parse_request_path("/t_cover_big%2Fco3pah"), Some(("t_cover_big", "co3pah".into())));
        assert_eq!(parse_request_path("/t_cover_small/co3pah.jpg"), Some(("t_cover_small", "co3pah".into())));
        assert_eq!(parse_request_path("/t_original/co3pah"), None);
        assert_eq!(parse_request_path("/t_cover_big/..%2F..%2Fx"), None);
        assert_eq!(parse_request_path("/"), None);
    }

    #[test]
    fn descarga_una_vez_y_luego_sirve_de_cache() {
        let dir = tempfile::tempdir().unwrap();
        let f = Fake { calls: AtomicUsize::new(0), body: vec![0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3] };
        let a = get(dir.path(), &f, "t_cover_big", "co3pah").unwrap();
        let b = get(dir.path(), &f, "t_cover_big", "co3pah").unwrap();
        assert_eq!(a, b);
        assert_eq!(f.calls.load(Ordering::SeqCst), 1);
        assert_eq!(cache_size(dir.path()), 7);
        clear_cache(dir.path()).unwrap();
        assert_eq!(cache_size(dir.path()), 0);
    }

    #[test]
    fn rechaza_lo_que_no_es_jpeg() {
        let dir = tempfile::tempdir().unwrap();
        let f = Fake { calls: AtomicUsize::new(0), body: b"<html>".to_vec() };
        assert!(get(dir.path(), &f, "t_cover_big", "co3pah").is_err());
        assert!(!cache_path(dir.path(), "t_cover_big", "co3pah").exists());
    }
}
