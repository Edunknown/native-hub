//! Token de GitHub opcional. Se guarda en el Administrador de credenciales de Windows,
//! nunca en la base de datos ni en archivos, y no se escribe en los registros.

use native_hub_core::{Error, Result};

const SERVICE: &str = "NATIVE HUB";
const USER: &str = "github-token";

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| Error::Invalid(native_hub_core::t!("almacén de credenciales: {e}", "credential store: {e}")))
}

pub fn get() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}

pub fn set(token: &str) -> Result<()> {
    entry()?.set_password(token).map_err(|e| Error::Invalid(native_hub_core::t!("no se pudo guardar el token: {e}", "could not save the token: {e}")))
}

pub fn clear() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Invalid(native_hub_core::t!("no se pudo borrar el token: {e}", "could not delete the token: {e}"))),
    }
}

/// Formatos de token de GitHub: clásicos (ghp_), de grano fino (github_pat_) y de OAuth (gho_).
pub fn validate_format(token: &str) -> Result<()> {
    let ok_prefix = ["ghp_", "github_pat_", "gho_"].iter().any(|p| token.starts_with(p));
    let ok_chars = token.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok_prefix && ok_chars && (20..=255).contains(&token.len()) {
        Ok(())
    } else {
        Err(Error::Invalid(native_hub_core::i18n::tr("eso no parece un token de GitHub (empieza por ghp_ o github_pat_)", "that does not look like a GitHub token (it starts with ghp_ or github_pat_)").into()))
    }
}
