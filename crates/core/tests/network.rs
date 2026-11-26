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
