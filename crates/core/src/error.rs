use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("base de datos: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("catálogo no válido: {0}")]
    Catalog(String),
    #[error("no encontrado: {0}")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, Error>;

// Los comandos de Tauri devuelven errores serializables como texto.
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
