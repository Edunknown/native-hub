//! Núcleo de NATIVE HUB.
//!
//! Lógica de dominio sin dependencia de Tauri, para poder probarla con `cargo test`.
//! Fase 2: catálogo (Catalog Manager) y base de datos SQLite.
//! Fase 3: Release Manager (releases en vivo) y Repository Scanner (cola de revisión).
//! Fase 4: Download Manager (descargas oficiales, reanudables, con SHA-256).
//! Fase 5: Installation Manager, adaptadores declarativos y Game File Validator.

pub mod catalog;
pub mod db;
pub mod download;
pub mod error;
pub mod http;
pub mod install;
pub mod query;
pub mod releases;
pub mod scanner;
pub mod text;
pub mod time;

pub use error::{Error, Result};
