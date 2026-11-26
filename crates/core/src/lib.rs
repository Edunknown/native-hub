//! Núcleo de NATIVE HUB.
//!
//! Lógica de dominio sin dependencia de Tauri, para poder probarla con `cargo test`.
//! Fase 2: catálogo (Catalog Manager) y base de datos SQLite.

pub mod catalog;
pub mod db;
pub mod error;
pub mod query;
pub mod text;

pub use error::{Error, Result};
