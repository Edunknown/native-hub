//! Núcleo de NATIVE HUB.
//!
//! Lógica de dominio sin dependencia de Tauri, para poder probarla con `cargo test`.
//! Fase 2: catálogo (Catalog Manager) y base de datos SQLite.
//! Fase 3: Release Manager (releases en vivo) y Repository Scanner (cola de revisión).
//! Fase 4: Download Manager (descargas oficiales, reanudables, con SHA-256).
//! Fase 5: Installation Manager, adaptadores declarativos y Game File Validator.
//! Fase 6: Update Manager (actualizar sin perder partidas, con copia y deshacer).
//! Fase 7: sincronización con Recompendium y escáner de GitLab (siempre vía cola de revisión).
//! Catálogo servido desde GitHub (remote): se descarga, se valida y se importa si es más nuevo.
//! Portadas: image_id de IGDB en el catálogo, imagen descargada de images.igdb.com y cacheada.

pub mod catalog;
pub mod cover;
pub mod db;
pub mod download;
pub mod error;
pub mod http;
pub mod i18n;
pub mod install;
pub mod query;
pub mod releases;
pub mod remote;
pub mod scanner;
pub mod sync;
pub mod text;
pub mod time;
pub mod update;

pub use error::{Error, Result};
