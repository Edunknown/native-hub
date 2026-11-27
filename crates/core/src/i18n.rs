//! Language of the messages the core returns to the interface (errors, install plans,
//! progress). English by default; the app switches it with the `set_language` command.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(true);

pub fn set_english(on: bool) {
    ENGLISH.store(on, Ordering::Relaxed);
}

pub fn en() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// Picks the Spanish or English text for the current language.
pub fn tr(es: &'static str, en_text: &'static str) -> &'static str {
    if en() { en_text } else { es }
}

/// `t!("español {x}", "English {x}", args…)`: like `format!`, in the current language.
#[macro_export]
macro_rules! t {
    ($es:literal, $en:literal $(,)?) => {
        if $crate::i18n::en() { format!($en) } else { format!($es) }
    };
    ($es:literal, $en:literal, $($arg:expr),+ $(,)?) => {
        if $crate::i18n::en() { format!($en, $($arg),+) } else { format!($es, $($arg),+) }
    };
}
