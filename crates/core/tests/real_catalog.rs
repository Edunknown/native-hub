//! Importa el catálogo real (catalog/catalog.json) en una base de datos en memoria.

use native_hub_core::{catalog, db, query};

#[test]
fn importa_el_catalogo_real() {
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog/catalog.json"))
        .expect("falta catalog/catalog.json: ejecuta npm run catalog:build");
    let cat = catalog::parse(&json).unwrap();
    let mut conn = db::open_in_memory().unwrap();
    catalog::import(&mut conn, &cat).unwrap();

    let s = query::summary(&conn).unwrap();
    assert_eq!(s["projectCount"].as_u64().unwrap() as usize, cat.projects.len());
    assert!(s["installableCount"].as_u64().unwrap() > 0);

    // Ningún proyecto instalable sin archivo Windows identificado.
    for p in &cat.projects {
        if p["listing"] == "library" {
            assert!(p["windowsAsset"].is_object(), "{} es instalable sin archivo Windows", p["slug"]);
            assert_ne!(p["takedown"], true);
        }
    }

    assert!(!query::search(&conn, "pokopia", 50).unwrap().is_empty());
    let switch2 = query::platform_projects(&conn, "switch2").unwrap();
    assert!(switch2.iter().any(|p| p["gameTitle"] == "Fire Emblem: Fortune’s Weave"));
}
