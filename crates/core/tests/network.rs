//! Pruebas contra las APIs reales. No se ejecutan por defecto (gastan cuota y necesitan red):
//!     cargo test -p native-hub-core --test network -- --ignored --nocapture

use native_hub_core::http::UreqFetcher;
use native_hub_core::{catalog, db, releases, scanner, time};

fn setup() -> rusqlite::Connection {
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog/catalog.json")).unwrap();
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(&json).unwrap()).unwrap();
    conn
}

#[test]
#[ignore]
fn github_gitlab_y_codeberg_reales() {
    let conn = setup();
    let f = UreqFetcher::new(std::env::var("GITHUB_TOKEN").ok());
    for slug in ["metrist38-fefw-recomp", "harbourmasters-shipwright"] {
        let out = releases::refresh_project(&conn, &f, slug).unwrap();
        println!("{slug}: {:?}", out);
        assert_eq!(out.status, "release");
    }
    let gl: String = conn
        .query_row("SELECT slug FROM projects WHERE repo_url LIKE 'https://gitlab.com/%' LIMIT 1", [], |r| r.get(0))
        .unwrap();
    println!("gitlab {gl}: {:?}", releases::refresh_project(&conn, &f, &gl).unwrap());
    let cb: String = conn
        .query_row("SELECT slug FROM projects WHERE repo_url LIKE 'https://codeberg.org/%' LIMIT 1", [], |r| r.get(0))
        .unwrap();
    println!("codeberg {cb}: {:?}", releases::refresh_project(&conn, &f, &cb).unwrap());
    println!("cuota: {:?}", native_hub_core::http::rate_limit(&conn).unwrap());
}

#[test]
#[ignore]
fn escaner_real() {
    let conn = setup();
    let f = UreqFetcher::new(std::env::var("GITHUB_TOKEN").ok());
    let q = scanner::default_queries(time::now_unix());
    let sum = scanner::scan(&conn, &f, &q[..2]);
    println!("{sum:?}");
    assert!(sum.seen > 0, "{:?}", sum.errors);
    for c in scanner::list_candidates(&conn, "new", 10).unwrap() {
        println!("  {} ★{} {}", c["fullName"], c["stars"], c["description"]);
    }
}

#[test]
#[ignore]
fn descarga_real_con_sha256() {
    use std::sync::atomic::AtomicU8;
    use native_hub_core::download;
    let conn = setup();
    let dir = tempfile::tempdir().unwrap();
    // SpaghettiKart: ~8 MB y GitHub publica su SHA-256.
    let id = download::enqueue(&conn, dir.path(), "harbourmasters-spaghettikart").unwrap();
    let state = download::run(&conn, &download::UreqTransport::default(), id, &AtomicU8::new(download::RUN), |p| {
        println!("  {} / {:?} bytes · {} B/s", p.done, p.total, p.bytes_per_sec)
    })
    .unwrap();
    let row = &download::list(&conn).unwrap()[0];
    println!("{state}: {row}");
    assert_eq!(state, "done");
    assert_eq!(row["verified"], true);
}

#[test]
#[ignore]
fn instalacion_real_de_spaghettikart() {
    use std::sync::atomic::AtomicU8;
    use native_hub_core::{download, install};
    let conn = setup();
    let dir = tempfile::tempdir().unwrap();
    let slug = "harbourmasters-spaghettikart";
    let id = download::enqueue(&conn, &dir.path().join("dl"), slug).unwrap();
    assert_eq!(download::run(&conn, &download::UreqTransport::default(), id, &AtomicU8::new(download::RUN), |_| {}).unwrap(), "done");
    let root = dir.path().join("Juegos");
    println!("{}", install::plan(&conn, slug, &root).unwrap());
    let inst = install::install(&conn, slug, &root).unwrap();
    println!("estado {} · exe {} · candidatos {}", inst["state"], inst["executablePath"], inst["config"]["candidates"]);
    assert!(inst["executablePath"].is_string() || inst["config"]["pending"] == "choose_exe");
}

#[test]
#[ignore]
fn releases_reales_de_tomodachi() {
    let conn = setup();
    let f = UreqFetcher::new(std::env::var("GITHUB_TOKEN").ok());
    let r = releases::project_releases(&conn, &f, "josiahg2502-glitch-tomodachilife-recomp", 10).unwrap();
    for rel in r["releases"].as_array().unwrap() {
        println!("{} {}", rel["tag"], rel["publishedAt"]);
        for a in rel["assets"].as_array().unwrap() {
            println!("   {} · {} · {} · rec={}", a["name"], a["os"], a["size"], a["recommended"]);
        }
    }
}

#[test]
#[ignore]
fn actualizacion_real_de_starship() {
    use std::sync::atomic::AtomicU8;
    use native_hub_core::{download, install, update};
    let conn = setup();
    let f = UreqFetcher::new(std::env::var("GITHUB_TOKEN").ok());
    let dir = tempfile::tempdir().unwrap();
    let slug = "harbourmasters-starship";
    let rels = releases::project_releases(&conn, &f, slug, 10).unwrap();
    let list = rels["releases"].as_array().unwrap();
    // Primera release anterior con un archivo de Windows.
    let old = list.iter().skip(1).find(|r| r["assets"].as_array().unwrap().iter().any(|a| a["os"] == "windows")).expect("release anterior");
    let asset = old["assets"].as_array().unwrap().iter().find(|a| a["os"] == "windows" && a["name"].as_str().unwrap().ends_with(".zip")).unwrap();
    println!("antigua {} {}", old["tag"], asset["name"]);
    let (rel, a) = releases::find_release_asset(&conn, &f, slug, asset["url"].as_str().unwrap()).unwrap();
    let t = download::UreqTransport::default();
    let id = download::enqueue_asset(&conn, &dir.path().join("dl"), slug, Some(download::ChosenAsset { url: a.url, name: a.name, size: a.size, sha256: a.sha256, tag: rel.tag })).unwrap();
    assert_eq!(download::run(&conn, &t, id, &AtomicU8::new(download::RUN), |_| {}).unwrap(), "done");
    let root = dir.path().join("Juegos");
    let inst = install::install(&conn, slug, &root).unwrap();
    let iid = inst["id"].as_i64().unwrap();
    std::fs::write(root.join(slug).join("mi-partida.sav"), b"partida").unwrap();
    println!("instalada {}", inst["releaseTag"]);

    let id2 = download::enqueue(&conn, &dir.path().join("dl"), slug).unwrap();
    assert_eq!(download::run(&conn, &t, id2, &AtomicU8::new(download::RUN), |_| {}).unwrap(), "done");
    let plan = update::plan(&conn, iid, &root).unwrap();
    println!("plan: nuevos {} reemplazados {} conservados {} solo tuyos {}", plan["added"], plan["replaced"], plan["preserved"].as_array().map(|a| a.len()).unwrap_or(0), plan["keptOnlyYours"]);
    let r = update::apply(&conn, iid, &root).unwrap();
    println!("aplicada {} → {}", r["fromTag"], r["toTag"]);
    assert_eq!(std::fs::read(root.join(slug).join("mi-partida.sav")).unwrap(), b"partida");
    let back = update::rollback(&conn, iid, &root).unwrap();
    println!("deshecha: {}", back["releaseTag"]);
}
