//! Base de datos SQLite y migraciones (PRAGMA user_version).

use std::path::Path;

use rusqlite::Connection;

use crate::Result;

/// Migraciones en orden. Nunca se editan una vez publicadas: se añade una nueva.
const MIGRATIONS: &[&str] = &[
    // v1 · catálogo + tablas del usuario (vacías hasta las fases 4-6)
    r#"
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE platforms (
        slug TEXT PRIMARY KEY, name TEXT NOT NULL, short TEXT, family TEXT NOT NULL, sort INTEGER NOT NULL
    );
    CREATE TABLE games (
        slug TEXT PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL REFERENCES platforms(slug),
        year INTEGER, igdb INTEGER, search TEXT NOT NULL
    );
    CREATE TABLE projects (
        slug TEXT PRIMARY KEY,
        game TEXT NOT NULL REFERENCES games(slug),
        platform TEXT NOT NULL REFERENCES platforms(slug),
        name TEXT NOT NULL, developers TEXT, kind TEXT NOT NULL, dev_status TEXT,
        listing TEXT NOT NULL CHECK (listing IN ('library', 'in_development', 'hidden')),
        has_windows_exe INTEGER, takedown INTEGER NOT NULL DEFAULT 0, abandoned INTEGER NOT NULL DEFAULT 0,
        repo_url TEXT UNIQUE, release_tag TEXT, release_published_at TEXT,
        created_at TEXT, stars INTEGER, checked_at TEXT,
        search TEXT NOT NULL,
        data TEXT NOT NULL
    );
    CREATE INDEX projects_game ON projects(game);
    CREATE INDEX projects_platform ON projects(platform, listing);
    CREATE INDEX projects_published ON projects(release_published_at);
    CREATE TABLE project_games (
        project TEXT NOT NULL REFERENCES projects(slug) ON DELETE CASCADE,
        game TEXT NOT NULL,
        PRIMARY KEY (project, game)
    );

    -- Fase 4-6. Sin claves foráneas al catálogo: un proyecto instalado debe sobrevivir
    -- aunque desaparezca del catálogo.
    CREATE TABLE installations (
        id INTEGER PRIMARY KEY, project TEXT NOT NULL, release_tag TEXT, install_dir TEXT NOT NULL,
        executable_path TEXT, state TEXT NOT NULL CHECK (state IN ('downloaded', 'needs_files', 'ready', 'broken')),
        installed_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT, config TEXT
    );
    CREATE TABLE user_files (
        id INTEGER PRIMARY KEY, installation INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
        requirement_key TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, sha1 TEXT,
        validated_at TEXT, valid INTEGER
    );
    CREATE TABLE downloads (
        id INTEGER PRIMARY KEY, project TEXT NOT NULL, url TEXT NOT NULL, dest_path TEXT NOT NULL,
        bytes_done INTEGER NOT NULL DEFAULT 0, bytes_total INTEGER,
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'paused', 'done', 'failed', 'cancelled')),
        sha256_expected TEXT, sha256_local TEXT, error TEXT, started_at TEXT, finished_at TEXT
    );
    CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')),
        action TEXT NOT NULL, subject TEXT, detail TEXT
    );
    "#,
];

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    setup(conn)
}

pub fn open_in_memory() -> Result<Connection> {
    setup(Connection::open_in_memory()?)
}

fn setup(mut conn: Connection) -> Result<Connection> {
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    migrate(&mut conn)?;
    Ok(conn)
}

pub fn migrate(conn: &mut Connection) -> Result<()> {
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
    }
    Ok(())
}

pub fn schema_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}
