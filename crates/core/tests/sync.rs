//! Pruebas de la sincronización con Recompendium y del escáner de GitLab (sin red).

use std::collections::HashMap;
use std::sync::Mutex;

use native_hub_core::http::{Fetcher, Response};
use native_hub_core::{Result, catalog, db, query, scanner, sync};
use rusqlite::Connection;

#[derive(Default)]
struct Fake(Mutex<HashMap<String, (u16, String)>>);
impl Fake {
    fn route(&self, url: &str, body: &str) {
        self.0.lock().unwrap().insert(url.into(), (200, body.into()));
    }
}
impl Fetcher for Fake {
    fn get(&self, url: &str, _etag: Option<&str>) -> Result<Response> {
        let (status, body) = self.0.lock().unwrap().get(url).cloned().unwrap_or((404, "{}".into()));
        Ok(Response { status, etag: None, body, rate: None })
    }
}

const CATALOG: &str = r#"{"generatedAt":"2026-11-01T00:00:00Z","sources":[],"families":["Nintendo"],
  "platforms":[{"slug":"switch2","name":"Nintendo Switch 2","short":"NS2","family":"Nintendo"},
               {"slug":"other","name":"Otras","short":"ETC","family":"Nintendo"}],
  "games":[{"slug":"pokemon-pokopia","title":"Pokémon Pokopia","platform":"switch2"}],
  "projects":[{"slug":"a","sourceId":"recomps/pokemon-pokopia","game":"pokemon-pokopia","games":["pokemon-pokopia"],"platform":"switch2",
     "name":"switch2-recomp","kind":"static_recomp","listing":"library","repoUrl":"https://github.com/drakolordx7/switch2-recomp"}]}"#;

const RAW: &str = "https://raw.githubusercontent.com/Nio03/unricopie/main/";

fn setup() -> (Connection, Fake) {
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &catalog::parse(CATALOG).unwrap()).unwrap();
    let f = Fake::default();
    f.route(
        "https://api.github.com/repos/Nio03/unricopie/git/trees/main?recursive=1",
        r#"{"tree":[
          {"path":"src/data/recomps/pokemon-pokopia.yaml"},
          {"path":"src/data/recomps/nuevo-juego.yaml"},
          {"path":"src/data/ports/otro-port.yaml"},
          {"path":"src/data/ports/ya-por-repo.yaml"},
          {"path":"public/arte/x.webp"}]}"#,
    );
    f.route(&format!("{RAW}src/data/games.yaml"), "nuevo-juego:\n  name: Juego Nuevo\n  year: 2026\n  platforms: [switch2]\notro:\n  name: Otro Juego\n  platforms: [ps9]\n");
    f.route(
        &format!("{RAW}src/data/recomps/nuevo-juego.yaml"),
        "name: \"Juego Nuevo (alguien)\"\ngames: [nuevo-juego]\nconsole: switch2\nstatus: experimental\nrepo: alguien/nuevo-recomp\ndesc:\n  es: \"Una recompilación nueva.\"\n  en: \"A new recomp.\"\ntags: [vulkan]\n",
    );
    f.route(
        &format!("{RAW}src/data/ports/otro-port.yaml"),
        "name: Otro Port\ngames: [otro]\ncategory: decomp-port\nstatus: playable\nrepo: gente/otro-port\ndesc: \"Port nativo.\"\n",
    );
    f.route(
        &format!("{RAW}src/data/ports/ya-por-repo.yaml"),
        "name: Duplicado\ngames: [nuevo-juego]\nrepo: drakolordx7/switch2-recomp\ndesc: x\n",
    );
    (conn, f)
}

#[test]
fn sincroniza_solo_lo_nuevo_y_a_la_cola() {
    let (conn, f) = setup();
    let s = sync::sync_recompendium(&conn, &f, 100);
    assert_eq!(s.entries, 4);
    assert_eq!(s.already_known, 1, "la ficha ya importada no se pide");
    assert_eq!(s.new_candidates, 2, "el duplicado por repositorio no entra: {s:?}");
    assert!(s.errors.is_empty(), "{:?}", s.errors);

    // Nada entra en el catálogo sin aprobar.
    assert!(query::search(&conn, "nuevo-recomp", 10).unwrap().is_empty());
    let list = scanner::list_candidates_from(&conn, "new", Some("recompendium"), 50).unwrap();
    assert_eq!(list.len(), 2);
    let nuevo = list.iter().find(|c| c["fullName"] == "alguien/nuevo-recomp").unwrap();
    assert_eq!(nuevo["suggestion"]["gameTitle"], "Juego Nuevo");
    assert_eq!(nuevo["suggestion"]["platform"], "switch2");
    assert_eq!(nuevo["suggestion"]["name"], "nuevo-recomp");

    // Una segunda pasada no repite nada.
    let s2 = sync::sync_recompendium(&conn, &f, 100);
    assert_eq!(s2.new_candidates, 0);
    assert_eq!(s2.already_known, 4);
}

#[test]
fn aprobar_con_datos_sugeridos_y_en_bloque() {
    let (mut conn, f) = setup();
    sync::sync_recompendium(&conn, &f, 100);
    let list = scanner::list_candidates_from(&conn, "new", Some("recompendium"), 50).unwrap();
    let id = list.iter().find(|c| c["fullName"] == "alguien/nuevo-recomp").unwrap()["id"].as_i64().unwrap();
    let slug = sync::approve_suggested(&mut conn, id).unwrap();
    let found = query::search(&conn, "nuevo-recomp", 10).unwrap();
    assert_eq!(found[0]["slug"], slug.as_str());
    assert_eq!(found[0]["gameTitle"], "Juego Nuevo");
    assert_eq!(found[0]["listing"], "in_development", "hasta comprobar su release no es instalable");
    assert!(sync::approve_suggested(&mut conn, id).is_err());

    // El resto en bloque; una consola desconocida («ps9») acaba en «other».
    let done = sync::approve_all_suggested(&mut conn, "recompendium").unwrap();
    assert_eq!(done.len(), 1);
    assert_eq!(query::search(&conn, "otro-port", 10).unwrap()[0]["platform"], "other");
}

#[test]
fn escaner_de_gitlab() {
    let (conn, f) = setup();
    f.route(
        "https://gitlab.com/api/v4/projects?search=recomp&order_by=last_activity_at&sort=desc&per_page=40&simple=true",
        r#"[{"web_url":"https://gitlab.com/grupo/juego-recomp","path_with_namespace":"grupo/juego-recomp","description":"Recomp","star_count":3},
            {"web_url":"https://github.com/drakolordx7/switch2-recomp","path_with_namespace":"x"}]"#,
    );
    let s = sync::scan_gitlab(&conn, &f);
    assert_eq!(s.new_candidates, 1);
    assert_eq!(s.already_known, 1);
    let list = scanner::list_candidates_from(&conn, "new", Some("gitlab-search"), 10).unwrap();
    assert_eq!(list[0]["fullName"], "grupo/juego-recomp");
}
