//! Pruebas del Release Manager y del escáner con un servidor falso (sin red).

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

use native_hub_core::http::{Fetcher, Response};
use native_hub_core::releases::{self, AssetInfo, Forge};
use native_hub_core::scanner::{self, Approval};
use native_hub_core::{Result, catalog, db, query};
use rusqlite::Connection;

/// Respuestas por URL exacta. Cuenta las peticiones y responde 304 si el ETag coincide.
#[derive(Default)]
struct Fake {
    routes: Mutex<HashMap<String, (u16, String)>>,
    calls: Mutex<Vec<String>>,
}

impl Fake {
    fn route(&self, url: &str, status: u16, body: &str) {
        self.routes.lock().unwrap().insert(url.into(), (status, body.into()));
    }
    fn calls(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

impl Fetcher for Fake {
    fn get(&self, url: &str, etag: Option<&str>) -> Result<Response> {
        self.calls.lock().unwrap().push(url.into());
        let (status, body) = self.routes.lock().unwrap().get(url).cloned().unwrap_or((404, "{}".into()));
        let tag = format!("\"{}\"", body.len());
        if status == 200 && etag == Some(tag.as_str()) {
            return Ok(Response { status: 304, etag: Some(tag), body: String::new(), rate: None });
        }
        Ok(Response { status, etag: Some(tag), body, rate: None })
    }
}

const CATALOG: &str = r#"{
  "generatedAt": "2026-11-01T00:00:00Z", "sources": [], "families": ["Nintendo"],
  "platforms": [{"slug": "switch2", "name": "Nintendo Switch 2", "short": "NS2", "family": "Nintendo"}],
  "games": [{"slug": "fefw", "title": "Fire Emblem: Fortune's Weave", "platform": "switch2", "year": 2026}],
  "projects": [
    {"slug": "fefw-recomp", "game": "fefw", "games": ["fefw"], "platform": "switch2", "name": "fefw-recomp",
     "developers": "metrist38", "kind": "static_recomp", "listing": "in_development", "takedown": false,
     "repoUrl": "https://github.com/metrist38/fefw-recomp", "release": {"tag": "v0.4.0", "publishedAt": "2026-11-20T00:00:00Z"},
     "hasWindowsExecutable": false, "checkedAt": "2026-11-01T00:00:00Z"}
  ]
}"#;

fn catalog_version(date: &str) -> String {
    CATALOG.replacen("2026-11-01T00:00:00Z", date, 1)
}

fn setup() -> Connection {
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(CATALOG).unwrap()).unwrap();
    conn
}

fn project(conn: &Connection, slug: &str) -> serde_json::Value {
    query::game(conn, "fefw").unwrap()["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["slug"] == slug)
        .cloned()
        .unwrap()
}

const LATEST: &str = "https://api.github.com/repos/metrist38/fefw-recomp/releases/latest";
const LIST: &str = "https://api.github.com/repos/metrist38/fefw-recomp/releases?per_page=1";
const RELEASE: &str = r#"{"tag_name": "v0.4.1", "html_url": "https://github.com/metrist38/fefw-recomp/releases/tag/v0.4.1",
  "published_at": "2026-11-26T13:42:26Z", "prerelease": false, "assets": [
   {"name": "fefw-recomp-0.4.1-linux-x64.tar.gz", "size": 1, "browser_download_url": "https://x/l"},
   {"name": "fefw-recomp-0.4.1-win64-symbols.zip", "size": 2, "browser_download_url": "https://x/s"},
   {"name": "fefw-recomp-0.4.1-win64.zip", "size": 165675008, "browser_download_url": "https://x/w", "digest": "sha256:f24a"}]}"#;

#[test]
fn nueva_version_con_ejecutable_windows() {
    let conn = setup();
    let fake = Fake::default();
    fake.route(LATEST, 200, RELEASE);
    let out = releases::refresh_project(&conn, &fake, "fefw-recomp").unwrap();
    assert_eq!(out.tag.as_deref(), Some("v0.4.1"));
    assert_eq!(out.events, vec!["new_version", "windows_build"]);
    let p = project(&conn, "fefw-recomp");
    assert_eq!(p["listing"], "library");
    assert_eq!(p["windowsAsset"]["name"], "fefw-recomp-0.4.1-win64.zip");
    assert_eq!(p["windowsAsset"]["sha256"], "f24a");
    assert_eq!(releases::update_events(&conn, 10).unwrap().len(), 2);

    // Segunda comprobación: 304 por ETag, sin novedades.
    let out = releases::refresh_project(&conn, &fake, "fefw-recomp").unwrap();
    assert!(out.events.is_empty());
    assert_eq!(fake.calls(), 2);
}

#[test]
fn reimportar_el_catalogo_conserva_lo_comprobado_en_vivo() {
    let mut conn = setup();
    let fake = Fake::default();
    fake.route(LATEST, 200, RELEASE);
    releases::refresh_project(&conn, &fake, "fefw-recomp").unwrap();
    catalog::import(&mut conn, &catalog::parse(&catalog_version("2026-11-02T00:00:00Z")).unwrap()).unwrap();
    assert_eq!(project(&conn, "fefw-recomp")["release"]["tag"], "v0.4.1");
}

#[test]
fn release_retirada_y_repo_desaparecido() {
    let conn = setup();
    let fake = Fake::default();
    fake.route(LIST, 200, "[]");
    let out = releases::refresh_project(&conn, &fake, "fefw-recomp").unwrap();
    assert_eq!(out.status, "no_release");
    assert_eq!(out.events, vec!["withdrawn"]);

    let fake = Fake::default(); // todo 404
    let out = releases::refresh_project(&conn, &fake, "fefw-recomp").unwrap();
    assert_eq!(out.status, "repo_missing");
    assert_eq!(project(&conn, "fefw-recomp")["repoExists"], false);
}

#[test]
fn lote_cancelable() {
    let conn = setup();
    let fake = Fake::default();
    fake.route(LATEST, 200, RELEASE);
    let items = releases::stale_projects(&conn, 1, 100).unwrap();
    assert_eq!(items.len(), 1);
    let stop = AtomicBool::new(true);
    let sum = releases::refresh_batch(&conn, &fake, &items, &stop, |_, _, _| {});
    assert!(sum.stopped);
    assert_eq!(sum.checked, 0);
    let go = AtomicBool::new(false);
    let sum = releases::refresh_batch(&conn, &fake, &items, &go, |_, _, _| {});
    assert_eq!(sum.checked, 1);
    assert!(releases::stale_projects(&conn, 1, 100).unwrap().is_empty());
}

#[test]
fn deteccion_de_ejecutable_windows() {
    let a = |n: &str| AssetInfo { name: n.into(), url: String::new(), size: None, sha256: None };
    let assets = vec![a("game-linux.tar.gz"), a("game-windows-x64.zip"), a("game-win32.zip")];
    assert_eq!(releases::pick_windows_asset(&assets, None).asset.unwrap().name, "game-windows-x64.zip");
    let generic = vec![a("game-0.3.zip"), a("game-linux.tar.gz")];
    let p = releases::pick_windows_asset(&generic, None);
    assert!(p.asset.is_none() && p.ambiguous);
    assert_eq!(releases::pick_windows_asset(&generic, Some(r"^game-0\.3\.zip$")).asset.unwrap().name, "game-0.3.zip");
    assert!(releases::pick_windows_asset(&[a("Setup.exe")], None).asset.is_some());
    assert!(releases::pick_windows_asset(&[a("game-macos.zip")], None).asset.is_none());
}

#[test]
fn forjas_soportadas() {
    assert_eq!(Forge::from_repo_url("https://github.com/a/b"), Some(Forge::GitHub { owner: "a".into(), name: "b".into() }));
    assert_eq!(Forge::from_repo_url("https://gitlab.com/g/sub/p"), Some(Forge::GitLab { path: "g/sub/p".into() }));
    assert!(Forge::from_repo_url("https://codeberg.org/L/L").is_some());
    assert!(Forge::from_repo_url("https://evil.example/a/b").is_none());
    assert!(Forge::from_repo_url("https://github.com/a/b?x=1").is_none());
}

#[test]
fn escaner_cola_y_aprobacion() {
    let mut conn = setup();
    let fake = Fake::default();
    let q = vec![("topic:static-recompilation".to_string(), "prueba")];
    let url = "https://api.github.com/search/repositories?q=topic%3Astatic-recompilation&sort=updated&order=desc&per_page=50";
    fake.route(url, 200, r#"{"items": [
        {"full_name": "metrist38/fefw-recomp", "html_url": "https://github.com/metrist38/fefw-recomp", "stargazers_count": 5},
        {"full_name": "someone/new-recomp", "html_url": "https://github.com/someone/new-recomp", "stargazers_count": 50,
         "description": "Static recompilation of X", "pushed_at": "2026-11-20T00:00:00Z", "fork": false, "topics": ["recomp"]},
        {"full_name": "other/thing", "html_url": "https://github.com/other/thing", "stargazers_count": 1}
    ]}"#);
    let sum = scanner::scan(&conn, &fake, &q);
    assert_eq!((sum.seen, sum.already_known, sum.new_candidates), (3, 1, 2));
    // Repetir la búsqueda no duplica.
    assert_eq!(scanner::scan(&conn, &fake, &q).new_candidates, 0);

    let new = scanner::list_candidates(&conn, "new", 50).unwrap();
    assert_eq!(new.len(), 2);
    assert_eq!(new[0]["fullName"], "someone/new-recomp");
    let (good, bad) = (new[0]["id"].as_i64().unwrap(), new[1]["id"].as_i64().unwrap());

    scanner::reject(&conn, bad).unwrap();
    assert!(scanner::reject(&conn, bad).is_err());

    // Nada entra solo: hasta aprobarlo, no hay proyecto.
    assert!(query::search(&conn, "new-recomp", 10).unwrap().is_empty());
    let slug = scanner::approve(
        &mut conn,
        &Approval {
            candidate_id: good,
            game: None,
            new_game_title: Some("Juego X".into()),
            platform: "switch2".into(),
            kind: "static_recomp".into(),
            name: None,
        },
    )
    .unwrap();
    let found = query::search(&conn, "new-recomp", 10).unwrap();
    assert_eq!(found[0]["slug"], slug.as_str());
    assert_eq!(found[0]["listing"], "in_development");

    // Una reimportación del catálogo no borra lo aprobado a mano.
    catalog::import(&mut conn, &catalog::parse(&catalog_version("2026-11-03T00:00:00Z")).unwrap()).unwrap();
    assert_eq!(query::search(&conn, "new-recomp", 10).unwrap().len(), 1);
    assert_eq!(scanner::candidate_counts(&conn).unwrap()["approved"], 1);

    // Plataforma inventada: rechazado.
    let bad_platform = Approval {
        candidate_id: good,
        game: Some("fefw".into()),
        new_game_title: None,
        platform: "xx".into(),
        kind: "static_recomp".into(),
        name: None,
    };
    assert!(scanner::approve(&mut conn, &bad_platform).is_err());
}

#[test]
fn selector_de_releases_y_archivos() {
    let conn = setup();
    let fake = Fake::default();
    let list = format!("[{RELEASE}, {{\"tag_name\": \"v0.3.0\", \"html_url\": \"https://x\", \"prerelease\": true, \"assets\": [{{\"name\": \"old-windows.zip\", \"size\": 5, \"browser_download_url\": \"https://github.com/metrist38/fefw-recomp/releases/download/v0.3.0/old-windows.zip\"}}]}}]");
    fake.route("https://api.github.com/repos/metrist38/fefw-recomp/releases?per_page=10", 200, &list);
    fake.route("https://api.github.com/repos/metrist38/fefw-recomp/releases?per_page=30", 200, &list);
    let r = releases::project_releases(&conn, &fake, "fefw-recomp", 10).unwrap();
    let rels = r["releases"].as_array().unwrap();
    assert_eq!(rels.len(), 2);
    let a = rels[0]["assets"].as_array().unwrap();
    assert_eq!(a.iter().find(|x| x["recommended"] == true).unwrap()["name"], "fefw-recomp-0.4.1-win64.zip");
    assert_eq!(a[0]["os"], "linux");
    assert_eq!(a[1]["os"], "debug");

    // Un archivo de una release antigua sí; una URL inventada, no.
    let old = "https://github.com/metrist38/fefw-recomp/releases/download/v0.3.0/old-windows.zip";
    let (rel, asset) = releases::find_release_asset(&conn, &fake, "fefw-recomp", old).unwrap();
    assert_eq!((rel.tag.as_str(), asset.name.as_str()), ("v0.3.0", "old-windows.zip"));
    assert!(releases::find_release_asset(&conn, &fake, "fefw-recomp", "https://github.com/metrist38/fefw-recomp/releases/download/v9/evil.exe").is_err());
}

#[test]
fn sistema_por_nombre_de_archivo() {
    assert_eq!(releases::os_guess("Game-Windows-x64.zip"), "windows");
    assert_eq!(releases::os_guess("game.AppImage"), "linux");
    assert_eq!(releases::os_guess("game-macos-arm64.zip"), "macos");
    assert_eq!(releases::os_guess("game.zip"), "unknown");
    assert_eq!(releases::os_guess("game.zip.sha256"), "metadata");
}
