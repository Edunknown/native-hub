//! Install test of every reviewed adapter against the project's real, latest official release.
//! It needs the network and downloads a few hundred MB, so it does not run by default:
//!
//!     cargo test -p native-hub-core --test adapters -- --ignored --nocapture
//!
//! For each `catalog/adapters/*.json`: check the latest release on the official API, download
//! the recommended Windows file (HTTPS, allowed hosts, SHA-256 when published), install it
//! into a temporary games folder and check that the game executable is found. It writes
//! `target/adapter-report.json`. It does not run the game: "played" results are recorded by
//! a person in the adapter's `tested` list.
//!
//! Optional: `ADAPTERS=shipwright,zelda64recomp` to test only some; `GITHUB_TOKEN` for quota.

use std::sync::atomic::AtomicU8;

use native_hub_core::http::UreqFetcher;
use native_hub_core::{catalog, db, download, install, releases};
use serde_json::{Value, json};

fn setup() -> rusqlite::Connection {
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog/catalog.json")).unwrap();
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(&json).unwrap()).unwrap();
    conn
}

fn adapters() -> Vec<(String, Value)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog/adapters");
    let only: Option<Vec<String>> = std::env::var("ADAPTERS").ok().map(|v| v.split(',').map(|s| s.trim().to_owned()).collect());
    let mut out: Vec<(String, Value)> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .map(|e| {
            let v: Value = serde_json::from_str(&std::fs::read_to_string(e.path()).unwrap()).unwrap();
            (v["repo"].as_str().unwrap().to_owned(), v["adapter"].clone())
        })
        .filter(|(_, a)| only.as_ref().is_none_or(|o| o.iter().any(|id| a["id"] == id.as_str())))
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn test_one(conn: &rusqlite::Connection, f: &UreqFetcher, repo: &str, adapter: &Value, work: &std::path::Path) -> Value {
    let id = adapter["id"].as_str().unwrap_or_default();
    let slug: String = match conn.query_row(
        "SELECT slug FROM projects WHERE LOWER(repo_url) = LOWER(?1)",
        [format!("https://github.com/{repo}")],
        |r| r.get(0),
    ) {
        Ok(s) => s,
        Err(e) => return json!({ "adapter": id, "repo": repo, "ok": false, "stage": "catalog", "error": e.to_string() }),
    };
    let fail = |stage: &str, e: String| json!({ "adapter": id, "repo": repo, "slug": slug, "ok": false, "stage": stage, "error": e });

    if let Err(e) = releases::refresh_project(conn, f, &slug) {
        return fail("release", e.to_string());
    }
    let dl_id = match download::enqueue(conn, &work.join("downloads"), &slug) {
        Ok(i) => i,
        Err(e) => return fail("download", e.to_string()),
    };
    let t = download::UreqTransport::default();
    match download::run(conn, &t, dl_id, &AtomicU8::new(download::RUN), |_| {}) {
        Ok(s) if s == "done" => {}
        Ok(s) => {
            let err: Option<String> = conn.query_row("SELECT error FROM downloads WHERE id = ?1", [dl_id], |r| r.get(0)).ok().flatten();
            return fail("download", format!("{s}: {}", err.unwrap_or_default()));
        }
        Err(e) => return fail("download", e.to_string()),
    }
    let (asset, size, sha_expected, sha_local, tag): (Option<String>, Option<i64>, Option<String>, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT dest_path, bytes_done, sha256_expected, sha256_local, release_tag FROM downloads WHERE id = ?1",
            [dl_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    let root = work.join("Games");
    let inst = match install::install(conn, &slug, &root) {
        Ok(i) => i,
        Err(e) => return fail("install", e.to_string()),
    };
    let dir = std::path::PathBuf::from(inst["installDir"].as_str().unwrap_or_default());
    let rel = |p: &str| std::path::Path::new(p).strip_prefix(&dir).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| p.to_owned());
    let exe = inst["executablePath"].as_str().map(rel);
    let candidates: Vec<String> = inst["config"]["candidates"].as_array().map(|a| a.iter().filter_map(Value::as_str).map(rel).collect()).unwrap_or_default();
    let pending = inst["config"]["pending"].as_str().map(str::to_owned);
    let ok = exe.is_some();
    let _ = std::fs::remove_dir_all(work);
    json!({
        "adapter": id,
        "repo": repo,
        "slug": slug,
        "ok": ok,
        "stage": if ok { "done" } else { "executable" },
        "releaseTag": tag,
        "asset": asset.as_deref().and_then(|p| std::path::Path::new(p).file_name()).map(|n| n.to_string_lossy()),
        "bytes": size,
        "sha256": { "published": sha_expected.is_some(), "matches": sha_expected.is_some() && sha_expected == sha_local },
        "method": inst["config"]["method"],
        "executable": exe,
        "candidates": candidates,
        "pending": pending,
    })
}

#[test]
#[ignore]
fn every_adapter_installs_from_its_official_release() {
    let conn = setup();
    let f = UreqFetcher::new(std::env::var("GITHUB_TOKEN").ok());
    let base = tempfile::tempdir().unwrap();
    let mut results = Vec::new();
    for (i, (repo, adapter)) in adapters().iter().enumerate() {
        let work = base.path().join(format!("a{i}"));
        let r = test_one(&conn, &f, repo, adapter, &work);
        println!("{} {} · {} · {} · exe {}", if r["ok"] == true { "OK  " } else { "FAIL" }, r["adapter"], r["releaseTag"], r["asset"], r["executable"]);
        if r["ok"] != true {
            println!("     {} {}", r["stage"], r["error"]);
        }
        results.push(r);
    }
    let report = json!({ "testedAt": native_hub_core::time::now_iso(), "os": std::env::consts::OS, "results": results });
    let out = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/adapter-report.json");
    let _ = std::fs::create_dir_all(std::path::Path::new(out).parent().unwrap());
    std::fs::write(out, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!("report: target/adapter-report.json");
    let failed: Vec<_> = results.iter().filter(|r| r["ok"] != true).map(|r| r["adapter"].clone()).collect();
    assert!(failed.is_empty(), "adapters that did not install: {failed:?}");
}
