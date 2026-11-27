use thiserror::Error;

use crate::i18n::tr;

#[derive(Debug, Error)]
pub enum Error {
    #[error("{l}: {0}", l = tr("base de datos", "database"))]
    Db(#[from] rusqlite::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{l}: {0}", l = tr("catálogo no válido", "invalid catalog"))]
    Catalog(String),
    #[error("{l}: {0}", l = tr("red", "network"))]
    Http(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{l}: {0}", l = tr("no encontrado", "not found"))]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, Error>;

// Tauri commands return errors serialized as text.
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
