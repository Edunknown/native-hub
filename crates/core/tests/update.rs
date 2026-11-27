//! Pruebas del Update Manager: conservar partidas y configuración, deshacer y recuperarse de fallos.

use std::fs;
use std::io::Write;
use std::path::Path;

use native_hub_core::{catalog, db, install, update};
use rusqlite::{Connection, params};
use zip::write::SimpleFileOptions;

fn make_zip(path: &Path, files: &[(&str, &[u8])]) {
    let mut z = zip::ZipWriter::new(fs::File::create(path).unwrap());
    for (name, data) in files {
        z.start_file(*name, SimpleFileOptions::default()).unwrap();
        z.write_all(data).unwrap();
    }
    z.finish().unwrap();
}

const URL: &str = "https://github.com/someone/game/releases/download/v1/game-win64.zip";

fn setup(preserve: &str) -> (Connection, tempfile::TempDir) {
    let json = format!(
        r#"{{"generatedAt":"2026-11-01T00:00:00Z","sources":[],"families":["Nintendo"],
        "platforms":[{{"slug":"n64","name":"Nintendo 64","short":"N64","family":"Nintendo"}}],
        "games":[{{"slug":"g","title":"Juego","platform":"n64"}}],
        "projects":[{{"slug":"p","game":"g","games":["g"],"platform":"n64","name":"game","kind":"decomp_port",
          "listing":"library","takedown":false,"repoUrl":"https://github.com/someone/game",
          "release":{{"tag":"v2"}},"windowsAsset":{{"name":"game-win64.zip","url":"{URL}","size":1}},
          "adapter":{{"id":"x","version":1,"preserve":{preserve}}}}}]}}"#
    );
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(&json).unwrap()).unwrap();
    (conn, tempfile::tempdir().unwrap())
}

fn add_download(conn: &Connection, file: &Path, tag: &str, finished: &str) {
    conn.execute(
        "INSERT INTO downloads (project, url, dest_path, bytes_done, state, release_tag, asset_name, finished_at)
         VALUES ('p', ?1, ?2, 1, 'done', ?3, 'game-win64.zip', ?4)",
        params![URL, file.to_string_lossy(), tag, finished],
    )
    .unwrap();
}

/// Instala v1, simula que el juego guarda partida y cambia su configuración, y prepara v2.
fn installed_v1(preserve: &str) -> (Connection, tempfile::TempDir, std::path::PathBuf, i64) {
    let (conn, tmp) = setup(preserve);
    let root = tmp.path().join("Juegos");
    let v1 = tmp.path().join("v1.zip");
    make_zip(&v1, &[("game.exe", b"exe v1"), ("data/assets.bin", b"assets v1"), ("settings.json", b"{\"default\":1}"), ("readme.txt", b"v1")]);
    add_download(&conn, &v1, "v1", "2026-11-01T00:00:00Z");
    let inst = install::install(&conn, "p", &root).unwrap();
    let id = inst["id"].as_i64().unwrap();
    // Que la instalación parezca de hace un rato, para distinguir lo que «cambió después».
    conn.execute("UPDATE installations SET installed_at = '2020-01-01T00:00:00Z' WHERE id = ?1", [id]).unwrap();
    let dir = root.join("p");
    fs::write(dir.join("settings.json"), b"{\"volumen\":3}").unwrap(); // tu configuración
    fs::create_dir_all(dir.join("Save")).unwrap();
    fs::write(dir.join("Save/slot1.sav"), b"partida").unwrap(); // tu partida (no está en el ZIP)

    let v2 = tmp.path().join("v2.zip");
    make_zip(&v2, &[
        ("game.exe", b"exe v2"),
        ("data/assets.bin", b"assets v2"),
        ("data/new.bin", b"nuevo"),
        ("settings.json", b"{\"default\":2}"),
        ("readme.txt", b"v2"),
        ("Save/slot1.sav", b"partida de ejemplo"),
    ]);
    add_download(&conn, &v2, "v2", "2026-11-02T00:00:00Z");
    (conn, tmp, root, id)
}

#[test]
fn patrones_glob() {
    let r = update::glob_to_regex("**/save/**");
    assert!(r.is_match("save/slot.dat") && r.is_match("x/Save/slot.dat"));
    assert!(!update::glob_to_regex("**/*.ini").is_match("game.exe"));
    assert!(update::glob_to_regex("mods/**").is_match("mods/a/b.zip"));
    assert!(update::glob_to_regex("*.json").is_match("settings.json"));
    assert!(!update::glob_to_regex("*.json").is_match("a/settings.json"));
}

#[test]
fn actualiza_conservando_partidas_y_configuracion() {
    let (conn, _tmp, root, id) = installed_v1("[]");
    let dir = root.join("p");
    let plan = update::plan(&conn, id, &root).unwrap();
    assert_eq!(plan["ready"], true);
    assert_eq!(plan["newTag"], "v2");
    assert_eq!(plan["added"], 1); // data/new.bin
    let preserved: Vec<&str> = plan["preserved"].as_array().unwrap().iter().map(|p| p["path"].as_str().unwrap()).collect();
    assert!(preserved.contains(&"settings.json"));
    assert!(preserved.contains(&"Save/slot1.sav"));

    let res = update::apply(&conn, id, &root).unwrap();
    assert_eq!(res["toTag"], "v2");
    assert_eq!(fs::read(dir.join("game.exe")).unwrap(), b"exe v2");
    assert_eq!(fs::read(dir.join("data/new.bin")).unwrap(), b"nuevo");
    assert_eq!(fs::read(dir.join("settings.json")).unwrap(), b"{\"volumen\":3}", "tu configuración se conserva");
    assert_eq!(fs::read(dir.join("Save/slot1.sav")).unwrap(), b"partida", "tu partida se conserva");
    assert_eq!(install::get(&conn, id).unwrap()["releaseTag"], "v2");

    // Deshacer vuelve a v1.
    let back = update::rollback(&conn, id, &root).unwrap();
    assert_eq!(back["releaseTag"], "v1");
    assert_eq!(fs::read(dir.join("game.exe")).unwrap(), b"exe v1");
    assert!(!dir.join("data/new.bin").exists());
    assert_eq!(fs::read(dir.join("Save/slot1.sav")).unwrap(), b"partida");
    assert!(update::rollback(&conn, id, &root).is_err(), "solo se deshace una vez");
}

#[test]
fn el_adaptador_puede_proteger_archivos_aunque_no_hayan_cambiado() {
    let (conn, _tmp, root, id) = installed_v1(r#"["readme.txt"]"#);
    let plan = update::plan(&conn, id, &root).unwrap();
    let preserved: Vec<&str> = plan["preserved"].as_array().unwrap().iter().map(|p| p["path"].as_str().unwrap()).collect();
    assert!(preserved.contains(&"readme.txt"));
    update::apply(&conn, id, &root).unwrap();
    assert_eq!(fs::read(root.join("p/readme.txt")).unwrap(), b"v1");
}

#[test]
fn sin_descarga_nueva_no_hay_plan() {
    let (conn, tmp) = setup("[]");
    let root = tmp.path().join("Juegos");
    let v1 = tmp.path().join("v1.zip");
    make_zip(&v1, &[("game.exe", b"x")]);
    add_download(&conn, &v1, "v1", "2026-11-01T00:00:00Z");
    let id = install::install(&conn, "p", &root).unwrap()["id"].as_i64().unwrap();
    let plan = update::plan(&conn, id, &root).unwrap();
    assert_eq!(plan["ready"], false);
    assert_eq!(plan["reason"], "download");
    assert!(update::apply(&conn, id, &root).is_err());
}
