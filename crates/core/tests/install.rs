//! Pruebas del Installation Manager y del Game File Validator.

use std::fs;
use std::io::Write;
use std::path::Path;

use native_hub_core::install::{self, Method, UserFileRule};
use native_hub_core::{catalog, db};
use rusqlite::{Connection, params};
use zip::write::SimpleFileOptions;

fn make_zip(path: &Path, files: &[(&str, &[u8])]) {
    let mut z = zip::ZipWriter::new(fs::File::create(path).unwrap());
    for (name, data) in files {
        if name.ends_with('/') {
            z.add_directory(*name, SimpleFileOptions::default()).unwrap();
        } else {
            z.start_file(*name, SimpleFileOptions::default()).unwrap();
            z.write_all(data).unwrap();
        }
    }
    z.finish().unwrap();
}

const URL: &str = "https://github.com/someone/game-recomp/releases/download/v1/game-recomp-win64.zip";

fn setup(asset: &str, adapter: &str) -> (Connection, tempfile::TempDir) {
    let json = format!(
        r#"{{"generatedAt":"2026-11-01T00:00:00Z","sources":[],"families":["Nintendo"],
        "platforms":[{{"slug":"n64","name":"Nintendo 64","short":"N64","family":"Nintendo"}}],
        "games":[{{"slug":"g","title":"Juego","platform":"n64"}}],
        "projects":[{{"slug":"p","game":"g","games":["g"],"platform":"n64","name":"game-recomp","kind":"static_recomp",
          "listing":"library","takedown":false,"repoUrl":"https://github.com/someone/game-recomp",
          "release":{{"tag":"v1"}},"windowsAsset":{{"name":"{asset}","url":"{URL}","size":1}},"adapter":{adapter}}}]}}"#
    );
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(&json).unwrap()).unwrap();
    (conn, tempfile::tempdir().unwrap())
}

/// Simula una descarga terminada del archivo.
fn downloaded(conn: &Connection, file: &Path) {
    conn.execute(
        "INSERT INTO downloads (project, url, dest_path, bytes_done, state, release_tag) VALUES ('p', ?1, ?2, 1, 'done', 'v1')",
        params![URL, file.to_string_lossy()],
    )
    .unwrap();
}

#[test]
fn metodo_segun_el_archivo() {
    assert_eq!(install::method_for("Game-Windows.zip"), Method::ExtractZip);
    assert_eq!(install::method_for("Game.exe"), Method::CopyExe);
    assert_eq!(install::method_for("Game-Setup-1.0.exe"), Method::Installer);
    assert_eq!(install::method_for("Game.msi"), Method::Installer);
    assert_eq!(install::method_for("Game.7z"), Method::Manual);
}

#[test]
fn extrae_quitando_la_carpeta_raiz_y_encuentra_el_ejecutable() {
    let tmp = tempfile::tempdir().unwrap();
    let z = tmp.path().join("a.zip");
    make_zip(&z, &[
        ("Game/", b""),
        ("Game/game.exe", b"MZ"),
        ("Game/unins000.exe", b"MZ"),
        ("Game/crashpad_handler.exe", b"MZ"),
        ("Game/data/x.bin", b"1"),
    ]);
    let dest = tmp.path().join("out");
    install::extract_zip(&z, &dest).unwrap();
    assert!(dest.join("game.exe").is_file());
    assert!(dest.join("data/x.bin").is_file());
    let exes = install::find_executables(&dest, None);
    assert_eq!(exes.len(), 1);
    assert!(exes[0].ends_with("game.exe"));
}

#[test]
fn rechaza_rutas_que_se_salen_de_la_carpeta() {
    let tmp = tempfile::tempdir().unwrap();
    let z = tmp.path().join("evil.zip");
    make_zip(&z, &[("../fuera.txt", b"x")]);
    let dest = tmp.path().join("out");
    assert!(install::extract_zip(&z, &dest).is_err());
    assert!(!tmp.path().join("fuera.txt").exists());
}

#[test]
fn instalar_ejecutar_y_desinstalar() {
    let (conn, tmp) = setup("game-recomp-win64.zip", "null");
    let z = tmp.path().join("game-recomp-win64.zip");
    make_zip(&z, &[("game.exe", b"MZ"), ("tools/other.exe", b"MZ"), ("readme.txt", b"hola")]);
    // (Con dos .exe en el mismo nivel habría que elegir: se prueba abajo con otra carpeta.)
    let root = tmp.path().join("Juegos");
    fs::create_dir_all(&root).unwrap();

    // Sin descarga no se instala; el plan lo dice.
    assert!(install::install(&conn, "p", &root).is_err());
    assert_eq!(install::plan(&conn, "p", &root).unwrap()["downloaded"], false);

    downloaded(&conn, &z);
    let plan = install::plan(&conn, "p", &root).unwrap();
    assert_eq!(plan["method"], "extract_zip");
    assert_eq!(plan["downloaded"], true);

    let inst = install::install(&conn, "p", &root).unwrap();
    // Dos .exe a distinta profundidad: gana el de arriba, y el otro queda como alternativa.
    assert_eq!(inst["state"], "ready");
    assert!(inst["executablePath"].as_str().unwrap().ends_with("game.exe"));
    assert_eq!(inst["config"]["candidates"].as_array().unwrap().len(), 2);
    let id = inst["id"].as_i64().unwrap();
    assert!(install::install(&conn, "p", &root).is_err(), "no se instala dos veces");

    // Un .exe de fuera de la carpeta no vale.
    let outside = tmp.path().join("malo.exe");
    fs::write(&outside, b"MZ").unwrap();
    assert!(install::set_executable(&conn, id, &outside).is_err());
    let exe = root.join("p").join("game.exe");
    assert_eq!(install::set_executable(&conn, id, &exe).unwrap()["state"], "ready");
    let (target, wd) = install::launch_target(&conn, id).unwrap();
    assert!(target.ends_with("game.exe"));
    assert_eq!(wd, root.join("p"));

    // Desinstalar borra solo su carpeta.
    install::uninstall(&conn, id, &root, true).unwrap();
    assert!(!root.join("p").exists());
    assert!(root.exists());
    assert!(install::list(&conn).unwrap().is_empty());
}

#[test]
fn instalador_externo_no_se_ejecuta_solo() {
    let (conn, tmp) = setup("Game-Setup.exe", "null");
    let f = tmp.path().join("Game-Setup.exe");
    fs::write(&f, b"MZ").unwrap();
    downloaded(&conn, &f);
    let root = tmp.path().join("Juegos");
    let inst = install::install(&conn, "p", &root).unwrap();
    assert_eq!(inst["state"], "needs_files");
    assert_eq!(inst["config"]["pending"], "run_installer");
    assert!(install::launch_target(&conn, inst["id"].as_i64().unwrap()).is_err());
    assert_eq!(install::installer_path(&conn, inst["id"].as_i64().unwrap()).unwrap(), f);
}

#[test]
fn valida_una_rom_de_n64_por_cabecera() {
    let rule = UserFileRule {
        key: "rom".into(),
        label: "ROM".into(),
        extensions: vec!["z64".into(), "n64".into(), "v64".into()],
        magic: vec!["80371240".into(), "37804012".into(), "40123780".into()],
        min_size: Some(16),
        ..Default::default()
    };
    let tmp = tempfile::tempdir().unwrap();
    let good = tmp.path().join("juego.z64");
    fs::write(&good, [0x80, 0x37, 0x12, 0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).unwrap();
    assert_eq!(install::validate_user_file(&good, &rule).unwrap()["ok"], true);
    let bad = tmp.path().join("otro.z64");
    fs::write(&bad, b"no es una rom de n64 de verdad").unwrap();
    assert_eq!(install::validate_user_file(&bad, &rule).unwrap()["ok"], false);
    let wrong_ext = tmp.path().join("juego.iso");
    fs::write(&wrong_ext, [0x80, 0x37, 0x12, 0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).unwrap();
    assert_eq!(install::validate_user_file(&wrong_ext, &rule).unwrap()["ok"], false);

    // SHA-1 publicado: "abc" → a9993e36…
    let abc = tmp.path().join("abc.z64");
    fs::write(&abc, b"abc").unwrap();
    let r = UserFileRule { sha1: vec!["a9993e364706816aba3e25717850c26c9cd0d89d".into()], ..Default::default() };
    assert_eq!(install::validate_user_file(&abc, &r).unwrap()["ok"], true);
}

#[test]
fn adaptador_aparece_en_el_plan() {
    let adapter = r#"{"id":"x","version":1,"reviewedAt":"2026-11-27","firstRun":"Te pedirá tu ROM.",
        "userFiles":[{"key":"rom","label":"ROM de prueba","extensions":["z64"],"when":"first_launch"}]}"#;
    let (conn, tmp) = setup("game-recomp-win64.zip", adapter);
    let plan = install::plan(&conn, "p", tmp.path()).unwrap();
    assert_eq!(plan["reviewed"], true);
    let texts: Vec<String> = plan["steps"].as_array().unwrap().iter().map(|s| s["text"].as_str().unwrap().to_owned()).collect();
    assert!(texts.iter().any(|t| t.contains("ROM de prueba")));
    assert!(texts.iter().any(|t| t.contains("Te pedirá tu ROM")));
    assert_eq!(install::adapter_rule(&conn, "p", "rom").unwrap().label, "ROM de prueba");
}

#[test]
fn zip_se_borra_tras_extraerlo_bien() {
    let (conn, tmp) = setup("game-recomp-win64.zip", "null");
    let downloads = tmp.path().join("Descargas");
    fs::create_dir_all(&downloads).unwrap();
    let z = downloads.join("game-recomp-win64.zip");
    make_zip(&z, &[("game.exe", b"MZ")]);
    downloaded(&conn, &z);
    let root = tmp.path().join("Juegos");
    let inst = install::install_and_clean(&conn, "p", &root, &downloads).unwrap();
    assert_eq!(inst["state"], "ready");
    assert_eq!(inst["zipRemoved"], true);
    assert!(!z.exists(), "el ZIP se borra");
    assert!(root.join("p").join("game.exe").exists());
    let left: i64 = conn.query_row("SELECT COUNT(*) FROM downloads", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0, "y sale de Descargas");
}

#[test]
fn zip_peligroso_no_se_instala_ni_se_borra() {
    let (conn, tmp) = setup("game-recomp-win64.zip", "null");
    let downloads = tmp.path().join("Descargas");
    fs::create_dir_all(&downloads).unwrap();
    let z = downloads.join("game-recomp-win64.zip");
    make_zip(&z, &[("../fuera.exe", b"MZ")]);
    downloaded(&conn, &z);
    let root = tmp.path().join("Juegos");
    assert!(install::install_and_clean(&conn, "p", &root, &downloads).is_err());
    assert!(z.exists(), "si falla, el ZIP se queda para reintentar");
    assert!(!tmp.path().join("fuera.exe").exists());
    assert!(!root.join("p").exists());
}

#[test]
fn instalador_no_se_borra() {
    let (conn, tmp) = setup("Game-Setup.exe", "null");
    let downloads = tmp.path().join("Descargas");
    fs::create_dir_all(&downloads).unwrap();
    let f = downloads.join("Game-Setup.exe");
    fs::write(&f, b"MZ").unwrap();
    downloaded(&conn, &f);
    let inst = install::install_and_clean(&conn, "p", &tmp.path().join("Juegos"), &downloads).unwrap();
    assert!(inst.get("zipRemoved").is_none());
    assert!(f.exists(), "el instalador hace falta para ejecutarlo");
}

#[test]
fn elige_el_zip_de_windows_de_una_release() {
    use native_hub_core::releases::{AssetInfo, pick_windows_zip};
    let a = |n: &str| AssetInfo { name: n.into(), url: format!("https://github.com/o/r/releases/download/v1/{n}"), size: None, sha256: None };
    let assets = vec![a("Game-Setup.exe"), a("game-linux.zip"), a("game-win64.zip"), a("game-macos.zip"), a("game.exe")];
    assert_eq!(pick_windows_zip(&assets).unwrap().name, "game-win64.zip");
    assert!(pick_windows_zip(&[a("Game-Setup.exe"), a("game-linux.zip")]).is_none());
}
