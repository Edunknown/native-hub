//! Catalog served from GitHub: conditional download, validation and "only if newer" (no network).

use std::sync::Mutex;

use native_hub_core::http::{Fetcher, Response};
use native_hub_core::remote::{self, Outcome};
use native_hub_core::{Result, catalog, db, query};
use serde_json::{Value, json};

const URL: &str = remote::CATALOG_URL;

/// Serves one body with an ETag and answers 304 when the client already has it.
struct Fake {
    body: Mutex<(u16, String, String)>,
    seen_etags: Mutex<Vec<Option<String>>>,
}
impl Fake {
    fn new(status: u16, body: String, etag: &str) -> Self {
        Self { body: Mutex::new((status, body, etag.into())), seen_etags: Mutex::new(vec![]) }
    }
    fn set(&self, body: String, etag: &str) {
        *self.body.lock().unwrap() = (200, body, etag.into());
    }
}
impl Fetcher for Fake {
    fn get(&self, url: &str, etag: Option<&str>) -> Result<Response> {
        assert_eq!(url, URL);
        self.seen_etags.lock().unwrap().push(etag.map(str::to_owned));
        let (status, body, tag) = self.body.lock().unwrap().clone();
        if etag == Some(tag.as_str()) {
            return Ok(Response { status: 304, etag: Some(tag), body: String::new(), rate: None });
        }
        Ok(Response { status, etag: Some(tag), body, rate: None })
    }
}

fn catalog_json(generated_at: &str, projects: usize, schema: i64) -> String {
    let projects: Vec<Value> = (0..projects)
        .map(|i| {
            json!({"slug": format!("p{i}"), "game": "g", "games": ["g"], "platform": "n64", "name": format!("Project {i}"),
                   "kind": "decomp_port", "listing": "in_development", "repoUrl": format!("https://github.com/x/p{i}")})
        })
        .collect();
    json!({
        "schema": schema, "generatedAt": generated_at, "sources": [], "families": ["Nintendo"],
        "platforms": [{"slug": "n64", "name": "Nintendo 64", "short": "N64", "family": "Nintendo"}],
        "games": [{"slug": "g", "title": "Game", "platform": "n64"}],
        "projects": projects,
    })
    .to_string()
}

fn loaded(conn: &rusqlite::Connection) -> String {
    catalog::loaded_version(conn).unwrap().unwrap()
}

#[test]
fn imports_a_newer_catalog_and_then_uses_the_etag() {
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(&catalog_json("2026-11-01T00:00:00Z", 120, 1)).unwrap()).unwrap();

    let f = Fake::new(200, catalog_json("2026-11-20T00:00:00Z", 150, 1), "\"v2\"");
    let out = remote::check(&mut conn, &f, URL).unwrap();
    assert_eq!(out, Outcome::Updated { from: Some("2026-11-01T00:00:00Z".into()), to: "2026-11-20T00:00:00Z".into(), projects: 150 });
    assert_eq!(query::summary(&conn).unwrap()["projectCount"], 150);

    // Second check: sends the ETag, gets a 304, nothing changes.
    let out = remote::check(&mut conn, &f, URL).unwrap();
    assert!(matches!(out, Outcome::UpToDate { .. }));
    assert_eq!(f.seen_etags.lock().unwrap().last().unwrap().as_deref(), Some("\"v2\""));

    let st = remote::status(&conn).unwrap();
    assert_eq!(st["version"], "2026-11-20T00:00:00Z");
    assert!(st["checkedAt"].is_string());
    assert!(st["error"].is_null());
}

#[test]
fn the_embedded_catalog_does_not_replace_a_newer_downloaded_one() {
    let mut conn = db::open_in_memory().unwrap();
    let embedded = catalog::parse(&catalog_json("2026-11-01T00:00:00Z", 120, 1)).unwrap();
    catalog::import_if_newer(&mut conn, &embedded).unwrap();
    let f = Fake::new(200, catalog_json("2026-11-20T00:00:00Z", 130, 1), "a");
    remote::check(&mut conn, &f, URL).unwrap();
    // Next start-up: the app tries the embedded (older) catalog again.
    assert!(!catalog::import_if_newer(&mut conn, &embedded).unwrap());
    assert_eq!(loaded(&conn), "2026-11-20T00:00:00Z");
}

#[test]
fn an_older_remote_catalog_is_not_imported() {
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(&catalog_json("2026-11-20T00:00:00Z", 120, 1)).unwrap()).unwrap();
    let f = Fake::new(200, catalog_json("2026-11-01T00:00:00Z", 500, 1), "a");
    let out = remote::check(&mut conn, &f, URL).unwrap();
    assert!(matches!(out, Outcome::Older { .. }));
    assert_eq!(loaded(&conn), "2026-11-20T00:00:00Z");
}

#[test]
fn a_newer_schema_waits_for_an_app_update() {
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(&catalog_json("2026-11-01T00:00:00Z", 120, 1)).unwrap()).unwrap();
    let f = Fake::new(200, catalog_json("2026-12-01T00:00:00Z", 120, remote::SCHEMA + 1), "s2");
    let out = remote::check(&mut conn, &f, URL).unwrap();
    assert_eq!(out, Outcome::NeedsAppUpdate { schema: remote::SCHEMA + 1 });
    assert_eq!(loaded(&conn), "2026-11-01T00:00:00Z");
    // The ETag is not kept: after updating the app it is downloaded in full again.
    remote::check(&mut conn, &f, URL).unwrap();
    assert_eq!(f.seen_etags.lock().unwrap().last().unwrap(), &None);
}

#[test]
fn broken_catalogs_are_rejected_and_the_error_is_kept() {
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(&catalog_json("2026-11-01T00:00:00Z", 120, 1)).unwrap()).unwrap();

    // Too small: probably a broken publish, not a real catalog.
    let f = Fake::new(200, catalog_json("2026-11-20T00:00:00Z", 3, 1), "a");
    assert!(remote::check(&mut conn, &f, URL).is_err());
    assert!(remote::status(&conn).unwrap()["error"].is_string());
    assert_eq!(loaded(&conn), "2026-11-01T00:00:00Z");

    // Project pointing to a game that does not exist.
    let mut bad: Value = serde_json::from_str(&catalog_json("2026-11-20T00:00:00Z", 120, 1)).unwrap();
    bad["projects"][5]["game"] = json!("missing");
    f.set(bad.to_string(), "b");
    assert!(remote::check(&mut conn, &f, URL).is_err());

    // Not JSON at all.
    f.set("<html>rate limited</html>".into(), "c");
    assert!(remote::check(&mut conn, &f, URL).is_err());

    // HTTP error.
    let f = Fake::new(500, String::new(), "d");
    assert!(remote::check(&mut conn, &f, URL).is_err());
    assert_eq!(loaded(&conn), "2026-11-01T00:00:00Z");

    // A good catalog afterwards clears the error.
    let f = Fake::new(200, catalog_json("2026-11-21T00:00:00Z", 120, 1), "e");
    remote::check(&mut conn, &f, URL).unwrap();
    assert!(remote::status(&conn).unwrap()["error"].is_null());
}

#[test]
fn the_real_catalog_passes_validation() {
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog/catalog.json")).unwrap();
    let raw: Value = serde_json::from_str(&json).unwrap();
    assert!(raw["schema"].as_i64().unwrap() <= remote::SCHEMA, "catalog.json uses a schema this build cannot read");
    remote::validate(&catalog::parse(&json).unwrap(), native_hub_core::time::now_unix()).unwrap();
}
