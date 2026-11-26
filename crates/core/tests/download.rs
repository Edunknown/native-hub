//! Pruebas del Download Manager con un transporte falso (sin red).

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Mutex;
use std::sync::atomic::AtomicU8;

use native_hub_core::download::{self, Opened, Transport};
use native_hub_core::{Result, catalog, db};
use rusqlite::Connection;

const BODY: &[u8] = b"contenido del ejecutable de prueba, 0123456789";
// sha256 de BODY
fn body_sha() -> String {
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("x");
    std::fs::File::create(&p).unwrap().write_all(BODY).unwrap();
    download::sha256_file(&p).unwrap()
}

#[derive(Default)]
struct Fake {
    /// url → (status, location, body)
    routes: Mutex<HashMap<String, (u16, Option<String>, Vec<u8>)>>,
    ranges: Mutex<Vec<Option<u64>>>,
}

impl Fake {
    fn route(&self, url: &str, status: u16, location: Option<&str>, body: &[u8]) {
        self.routes.lock().unwrap().insert(url.into(), (status, location.map(Into::into), body.to_vec()));
    }
}

impl Transport for Fake {
    fn open(&self, url: &str, from: Option<u64>) -> Result<Opened> {
        self.ranges.lock().unwrap().push(from);
        let (status, location, body) = self.routes.lock().unwrap().get(url).cloned().unwrap_or((404, None, vec![]));
        if status == 200 {
            if let Some(n) = from.filter(|n| *n > 0) {
                let rest = body[n as usize..].to_vec();
                return Ok(Opened { status: 206, location: None, content_length: Some(rest.len() as u64), range_total: Some(body.len() as u64), body: Box::new(Cursor::new(rest)) });
            }
        }
        let len = body.len() as u64;
        Ok(Opened { status, location, content_length: Some(len), range_total: None, body: Box::new(Cursor::new(body)) })
    }
}

const ASSET: &str = "https://github.com/someone/game-recomp/releases/download/v1/game-recomp-win64.zip";
const CDN: &str = "https://release-assets.githubusercontent.com/abc?sig=1";

fn catalog_json(url: &str, sha: Option<&str>, listing: &str) -> String {
    format!(
        r#"{{"generatedAt":"2026-11-01T00:00:00Z","sources":[],"families":["Nintendo"],
        "platforms":[{{"slug":"switch2","name":"Nintendo Switch 2","short":"NS2","family":"Nintendo"}}],
        "games":[{{"slug":"g","title":"Juego","platform":"switch2"}}],
        "projects":[{{"slug":"p","game":"g","games":["g"],"platform":"switch2","name":"game-recomp","kind":"static_recomp",
          "listing":"{listing}","takedown":false,"repoUrl":"https://github.com/someone/game-recomp",
          "release":{{"tag":"v1"}},
          "windowsAsset":{{"name":"game-recomp-win64.zip","url":"{url}","size":{size},"sha256":{sha}}}}}]}}"#,
        size = BODY.len(),
        sha = sha.map(|s| format!("\"{s}\"")).unwrap_or("null".into()),
    )
}

fn setup(url: &str, sha: Option<&str>, listing: &str) -> (Connection, tempfile::TempDir) {
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(&catalog_json(url, sha, listing)).unwrap()).unwrap();
    (conn, tempfile::tempdir().unwrap())
}

#[test]
fn descarga_con_redireccion_y_sha256_correcto() {
    let sha = body_sha();
    let (conn, dir) = setup(ASSET, Some(&sha), "library");
    let fake = Fake::default();
    fake.route(ASSET, 302, Some(CDN), b"");
    fake.route(CDN, 200, None, BODY);
    let id = download::enqueue(&conn, dir.path(), "p").unwrap();
    // Pedirlo otra vez no duplica.
    assert_eq!(download::enqueue(&conn, dir.path(), "p").unwrap(), id);
    let state = download::run(&conn, &fake, id, &AtomicU8::new(download::RUN), |_| {}).unwrap();
    assert_eq!(state, "done");
    let list = download::list(&conn).unwrap();
    assert_eq!(list[0]["verified"], true);
    let path = list[0]["path"].as_str().unwrap();
    assert_eq!(std::fs::read(path).unwrap(), BODY);
}

#[test]
fn sha256_distinto_descarta_el_archivo() {
    let (conn, dir) = setup(ASSET, Some("00ff"), "library");
    let fake = Fake::default();
    fake.route(ASSET, 200, None, BODY);
    let id = download::enqueue(&conn, dir.path(), "p").unwrap();
    assert_eq!(download::run(&conn, &fake, id, &AtomicU8::new(download::RUN), |_| {}).unwrap(), "failed");
    let list = download::list(&conn).unwrap();
    assert!(list[0]["error"].as_str().unwrap().contains("SHA-256"));
    assert!(!std::path::Path::new(list[0]["path"].as_str().unwrap()).exists());
}

#[test]
fn redireccion_a_un_host_no_permitido() {
    let (conn, dir) = setup(ASSET, None, "library");
    let fake = Fake::default();
    fake.route(ASSET, 302, Some("https://evil.example/x.zip"), b"");
    let id = download::enqueue(&conn, dir.path(), "p").unwrap();
    assert_eq!(download::run(&conn, &fake, id, &AtomicU8::new(download::RUN), |_| {}).unwrap(), "failed");
    assert!(download::list(&conn).unwrap()[0]["error"].as_str().unwrap().contains("no permitido"));
}

#[test]
fn solo_proyectos_instalables_y_de_su_repositorio() {
    let (conn, dir) = setup(ASSET, None, "in_development");
    assert!(download::enqueue(&conn, dir.path(), "p").is_err());
    let (conn, dir) = setup("https://github.com/otro/repo/releases/download/v1/x.zip", None, "library");
    assert!(download::enqueue(&conn, dir.path(), "p").is_err());
    let (conn, dir) = setup("http://github.com/someone/game-recomp/releases/download/v1/x.zip", None, "library");
    assert!(download::enqueue(&conn, dir.path(), "p").is_err());
}

#[test]
fn pausar_reanudar_y_cancelar() {
    let (conn, dir) = setup(ASSET, None, "library");
    let fake = Fake::default();
    fake.route(ASSET, 200, None, BODY);
    let id = download::enqueue(&conn, dir.path(), "p").unwrap();

    // Pausa inmediata: queda pausada.
    assert_eq!(download::run(&conn, &fake, id, &AtomicU8::new(download::PAUSE), |_| {}).unwrap(), "paused");
    // Simular que había 10 bytes descargados en el .part.
    let dest = download::list(&conn).unwrap()[0]["path"].as_str().unwrap().to_owned();
    std::fs::create_dir_all(std::path::Path::new(&dest).parent().unwrap()).unwrap();
    std::fs::write(format!("{dest}.part"), &BODY[..10]).unwrap();
    download::resume(&conn, id).unwrap();
    assert_eq!(download::run(&conn, &fake, id, &AtomicU8::new(download::RUN), |_| {}).unwrap(), "done");
    assert_eq!(fake.ranges.lock().unwrap().last().copied().flatten(), Some(10));
    assert_eq!(std::fs::read(&dest).unwrap(), BODY);

    // Quitar de la lista borrando el archivo.
    download::remove(&conn, dir.path(), id, true).unwrap();
    assert!(!std::path::Path::new(&dest).exists());
    assert!(download::list(&conn).unwrap().is_empty());

    // Cancelar una en cola.
    let id = download::enqueue(&conn, dir.path(), "p").unwrap();
    download::cancel_idle(&conn, id).unwrap();
    assert_eq!(download::list(&conn).unwrap()[0]["state"], "cancelled");
}

#[test]
fn nombres_de_archivo_seguros() {
    assert_eq!(download::safe_file_name("game-1.0-win64.zip").as_deref(), Some("game-1.0-win64.zip"));
    assert_eq!(download::safe_file_name("../../evil.exe").as_deref(), Some("evil.exe"));
    assert!(download::safe_file_name("..").is_none());
    assert!(download::safe_file_name("a;rm -rf.zip").is_none());
}
