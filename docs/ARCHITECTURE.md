# NATIVE HUB · Analysis and architecture

Starting document, kept up to date with every phase. Updated: 27/11/2026, version 0.3.0. Spanish: [ARQUITECTURA.md](ARQUITECTURA.md).

---

## 1. Requirements analysis

NATIVE HUB is a **manager for recompilation projects and native ports**, not an emulator or a store. Its value rests on three things:

1. **A reliable catalog.** Knowing which game has which PC implementations, and which ones can *actually* be installed (an official release with a Windows executable). Reliability matters more than size.
2. **Installs that work.** Every project has its own procedure: portable ZIP, installer, ROM to validate, ISO to extract, Xbox 360 files... One adapter per project, not a universal installer.
3. **A polished experience.** The interface is part of the product: editorial, restrained, no dashboard templates.

Requirements that shape the architecture:

| Requirement | Technical consequence |
|---|---|
| Never invent availability or versions | Every catalog entry has a `source` and `verified_at`. Unverified data is shown as "to be verified", never as an assumed value. |
| Installable only with a compatible release | The `installable` state is computed by the Release Manager from real assets; nobody writes it by hand. |
| Automatic discovery kept apart from approval | Two stores: `candidates` (what the scanner finds) and the `approved catalog` (reviewed). No candidate goes through on its own. |
| Downloads only from the original source | Per-project domain allow-list; nothing is hosted on our own servers. |
| No ROMs, ISOs, BIOS, keys or firmware | The launcher only *locates and validates* the user's files (size, known hash, header). There is no key extraction or protection-circumvention code. |
| Run nothing without consent | No silent installs. `.exe/.msi` installers only run after explicit confirmation and are marked as "assisted". |
| Several projects per game | `game 1—N project` model; the picker lives on the game page. |
| Windows first, Linux/macOS later | Paths and launching are abstracted per platform from the start; the catalog stores assets per OS. |

## 2. Proposed architecture

```
┌────────────────────────────── Frontend (WebView2) ──────────────────────────────┐
│ React 19 + TypeScript · Vite · custom CSS (tokens)                              │
│ Views: Home · Library · Discover · Consoles · Updates · Downloads · Settings      │
│        · Game page                                                              │
│ Data layer: src/lib/api.ts → Tauri invoke()  (or the seed catalog on the web)   │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ Tauri IPC (typed commands, minimal permissions)
┌───────────────────────────────────────┴─────────────────────────────────────────┐
│ src-tauri (Rust) · thin layer: commands, progress events, app state             │
├─────────────────────────────────────────────────────────────────────────────────┤
│ crates/core (Rust, no Tauri dependency → testable)                               │
│  catalog       Catalog Manager        · games, platforms, projects              │
│  scanner       Repository Scanner     · GitHub/GitLab → candidates              │
│  releases      Release Manager        · releases, assets, per-OS selection      │
│  download      Download Manager       · queue, resume, SHA-256, domains         │
│  install       Installation Manager   · runs adapter plans                      │
│  build         Build Manager          · (future) isolated, opt-in builds        │
│  files         Game File Validator    · locate and validate the user's files    │
│  adapters      Project Adapter System · declarative + native manifests          │
│  updates       Update Manager         · compare installed vs latest release     │
│  library       Library Manager        · installs, launch, uninstall             │
│  config        Configuration Manager  · settings, paths, theme                  │
│  db            SQLite (rusqlite) + migrations                                   │
│  audit         Log of important operations                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Key decisions:

- **Core in a separate crate** (`crates/core`). Domain logic does not depend on Tauri: it is tested with `cargo test` and can be reused by a CLI or a catalog service.
- **The catalog is versioned data in the repo** (`catalog/`), validated by schema. It is loaded into SQLite on startup. Every catalog change is reviewable in a diff, and the scanner never writes to it directly.
- **Live data kept apart from curated data.** Curated data (what the project is, which files it needs, how it installs) lives in `catalog/`. Live data (latest version, date, assets) comes from the Release Manager and is stored in SQLite with its check date.
- **No source of truth in the frontend.** The UI asks for everything through `invoke()`. In the browser (`npm run dev`), `api.ts` serves the seed catalog so the design can be worked on without Rust.
- **Minimal Tauri permissions.** No generic shell plugin. Launching a game is a Rust command that only accepts executables registered in an install.

## 3. Technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| GitHub API limit (60 requests/hour without a token) | Slow or blocked scanning | `ETag`/`If-None-Match` caching (304 responses do not use quota), staggered checks, an **optional** user token stored in Windows Credential Manager. |
| Inconsistent asset names (`SoH-…-Win64.zip`, `…-Windows.zip`, `pd-x86_64-windows.zip`) | Picking the wrong file | Each adapter declares an asset pattern per OS and architecture. Without a single match, the project stays "not installable" and the user is told. |
| Rolling or CI releases (e.g. a `ci-dev-build` tag) | Versions that change without changing name | Identify the version by `tag + publish date + asset id`, mark the project as experimental. |
| Few projects publish SHA-256 or signatures | Integrity cannot be verified | Verify when available; otherwise compute and record the local hash, show "no published hash" and check that the origin is the allowed domain. |
| SmartScreen and antivirus flag unsigned executables | Users think the launcher is malware | Clear messages, never disable protections, link to the official release. |
| `.exe`/`.msi` installers that ask for UAC | Silent installs are impossible and undesirable | "Assisted" mode: downloaded, verified, and launched by the user after confirming. |
| Updates that overwrite settings and saves | User data loss | The adapter declares which paths are kept; backup before updating; the user reviews before applying. |
| Very different original-file requirements (ROM with a given hash, ISO to extract, Xbox 360 dump) | Complex validation | Declarative per-project validators (size, known hashes published by the project, header). If the project ships its own extractor, its own is used with permission; NATIVE HUB does not implement extraction of protected material. |
| Catalog accuracy at scale | Wrong data | Manual approval, visible verification date, "to be verified" state. |
| Legality depending on jurisdiction | Risk for the user | Per-project notices, respect licenses and attribution, host nothing protected. |
| WebView2 missing on some Windows 10 | The app does not open | Tauri's NSIS installer bootstraps WebView2. |

## 4. Data model (SQLite)

```
platforms        id, slug, name, manufacturer, generation, sort_order
games            id, slug, title, platform_id → platforms, release_year,
                 description, cover_url, cover_source
projects         id, slug, game_id → games, name, developers, kind
                 (decomp_port | static_recomp | engine_reimpl | source_port | other),
                 repo_host (github|gitlab|other), repo_owner, repo_name,
                 homepage_url, releases_url, license, notes,
                 dev_status (stable|beta|experimental|abandoned|unknown),
                 listing (library|in_development|hidden),
                 adapter_id → adapters, curated_at
project_requirements
                 project_id, needs_original_files, original_files_desc,
                 needs_extracted_files, needs_keys, needs_manual_build,
                 dependencies (json)
releases         id, project_id, tag, name, published_at, is_prerelease,
                 url, fetched_at, withdrawn_at
release_assets   id, release_id, name, size, download_url, content_type,
                 os (windows|linux|macos|unknown), arch, sha256_published,
                 signature_url
compatibility    project_id, os, os_version (win10|win11), status
                 (works|issues|unknown), source, verified_at
adapters         id, version, kind (declarative|native), manifest (json),
                 reviewed_at
installations    id, project_id, release_id, install_dir, executable_path,
                 installed_at, updated_at, state (downloaded|needs_files|
                 ready|broken), config (json)
user_files       id, installation_id, requirement_key, path, size, sha1,
                 validated_at, valid
downloads        id, asset_id, dest_path, bytes_done, bytes_total,
                 state (queued|running|paused|done|failed|cancelled),
                 sha256_local, error, started_at, finished_at
scan_candidates  id, repo_host, repo_full_name, detected_at, reason,
                 has_windows_asset, status (new|approved|rejected|duplicate),
                 reviewed_at
update_events    id, project_id, kind (new_version|withdrawn|abandoned|
                 breaking), from_tag, to_tag, detected_at, seen_at
audit_log        id, at, action, subject, detail (json)
settings         key, value
```

Rules:

- `UNIQUE(repo_host, repo_owner, repo_name)` on `projects` and `scan_candidates` prevents duplicates.
- `installable` is not a column: it is a view that requires `listing = library`, a non-withdrawn release and a Windows asset matching the adapter's pattern.
- A project's `last_checked_at` = `MAX(releases.fetched_at)`.

## 5. Adapter system

Every installable project has a **reviewed, versioned** adapter. There are two kinds:

**Declarative (default).** A plan made of steps from a closed vocabulary. No scripts or free-form commands. (Original design in TOML; the implementation uses JSON, see section 11.)

```toml
id = "shipwright"
version = 1
allowed_domains = ["github.com", "objects.githubusercontent.com"]

[asset.windows-x64]
pattern = "^SoH-.*-Win64\\.zip$"

[[steps]]
kind = "download_asset"

[[steps]]
kind = "verify"          # published SHA-256 if any; otherwise record the local one

[[steps]]
kind = "extract_zip"
into = "{install_dir}"

[[steps]]
kind = "require_user_file"
key = "rom"
label = "Ocarina of Time ROM"
accept = [".z64", ".n64", ".v64"]
# accepted hashes are copied from the project's documentation, with a link

[launch]
executable = "soh.exe"
working_dir = "{install_dir}"

[update]
preserve = ["*.json", "Save/**", "mods/**"]
```

Planned steps: `download_asset`, `verify`, `extract_zip`, `extract_7z`, `copy`, `require_user_file`, `write_config`, `run_installer_assisted` (with confirmation), `run_project_tool` (a tool shipped in the project's own release, with confirmation), `set_launch`.

**Native (exception).** For a project that does not fit the vocabulary, a Rust module compiled into the app implementing the `Adapter` trait. It goes through code review like any other change. Executable adapters are never downloaded from the internet.

```rust
trait Adapter {
    fn id(&self) -> &str;
    fn version(&self) -> u32;
    fn select_asset(&self, release: &Release, target: &Target) -> Option<AssetRef>;
    fn plan(&self, ctx: &InstallContext) -> Result<InstallPlan>;   // list of steps
    fn validate_user_file(&self, key: &str, file: &Path) -> Result<Validation>;
    fn launch(&self, inst: &Installation) -> Result<LaunchSpec>;
}
```

The Installation Manager only runs an `InstallPlan`: it shows the plan to the user, asks for confirmation, runs each step with the option to cancel, and records it in `audit_log`.

## 6. Security

- Download URLs are checked against the adapter's `allowed_domains`, HTTPS only.
- Nothing downloaded runs without confirmation; installers run in assisted mode.
- No command or script coming from a repository is ever run.
- No game keys are stored. The GitHub token, if the user adds one, goes to the system credential store.
- Extraction paths are sanitized (*zip slip* protection) and limited to the install folder.
- Building from source (Build Manager) stays out until it can be isolated; it is optional and never needed for the main library.
- Minimal Tauri permissions and a strict CSP.

## 7. Folder layout

```
recomp-hub/
├─ docs/                      Architecture and decisions (English and Spanish)
├─ catalog/
│  ├─ sources/manual.json     Hand-curated: platforms, extra projects and corrections
│  ├─ sources/recompendium.json  Imported from Recompendium (CC BY-SA 4.0)
│  ├─ adapters/*.json         Reviewed install adapters
│  └─ catalog.json            Generated: merged sources + releases checked on GitHub
├─ scripts/
│  ├─ import-recompendium.mjs Converts Recompendium's data
│  └─ build-catalog.mjs       Merges sources and checks releases and Windows executables
├─ src/                       React + TypeScript frontend
│  ├─ app/                    Shell, navigation, theme, catalog context
│  ├─ views/                  Home, Library, Discover, Consoles, ...
│  ├─ components/             Reusable UI pieces
│  ├─ lib/                    api.ts (IPC), web-backend.ts (browser mode), i18n.ts, types
│  └─ styles/                 Design tokens and global styles
├─ src-tauri/                 Desktop app: commands and startup
├─ crates/core/               Rust core: SQLite, migrations, import, queries, i18n
└─ Cargo.toml                 Rust workspace
```

## 8. Catalog (phase 2)

Flow: `npm run catalog:update` = import Recompendium → merge with `manual.json` → check the latest release of each repository on github.com → write `catalog/catalog.json`. The app embeds that file at build time and loads it into SQLite (`%APPDATA%\dev.nativehub.app\native-hub.db`) when its version changes.

- **Sources.** Recompendium (≈1,550 projects across 40 platforms, data under CC BY-SA 4.0: shown with attribution, and the derived catalog keeps that license) and NATIVE HUB's manual list, which takes priority (it fixes moved repositories, pins a project's Windows file and adds missing projects, such as Fire Emblem: Fortune's Weave).
- **Installable.** Only if the latest release publishes a file identified as a Windows executable and the project was not taken down by DMCA. If the release has generic files (a `.zip` with no OS in its name), it stays "to be verified" until reviewed by hand.
- **Checking.** The public release pages on github.com are used to avoid the 60 requests/hour limit of the unauthenticated API. In phase 3 the app does it with the official API, ETag and an optional token.
- **Switch 2.** Included because the catalog must be complete, but with a warning: recent commercial games, many forks and high legal and security risk.

## 9. Live repositories (phase 3)

- **Release Manager** (`crates/core/src/releases.rs`). Queries the official GitHub, GitLab or Codeberg API depending on the repository, decides whether the release publishes a Windows executable (the same logic as the catalog script) and stores the result. Changes go to `update_events`: new version, first Windows executable, withdrawn release and missing repository. What is checked live is stored separately (`release_state`) and reapplied if an older catalog is imported.
- **Quota.** Every request carries its ETag: a 304 uses no GitHub quota. The remaining quota is stored and batches stop on their own, leaving a margin. Without a token, 60 requests per hour; with one, 5,000. The token is optional, validated against GitHub before saving, and lives in Windows Credential Manager.
- **Repository Scanner** (`crates/core/src/scanner.rs`). Targeted GitHub searches (topics `static-recompilation`, `recompilation`, "recomp" in the name, "native pc port"…). It skips what is already in the catalog, stores the rest as candidates and checks the release of the 30 most popular. Candidates do not enter the catalog: they must be approved in the review queue and given a game, platform and type. Approved entries have origin `local` and survive catalog re-imports.
- **Security.** Only `api.github.com`, `gitlab.com` and `codeberg.org` are contacted, always over HTTPS. Repository URLs are validated before building any request. Nothing is downloaded or run.
- **Tests.** `npm test` uses a fake server. `cargo test -p native-hub-core --test network -- --ignored` tests against the real APIs.

## 10. Downloads (phase 4)

- **Download Manager** (`crates/core/src/download.rs`). The UI only asks to "download project X": the URL comes from the catalog, never from the UI. Before queuing anything it checks the project is installable (identified Windows executable, no DMCA) and that the URL is a release file of its own repository.
- **Origins.** HTTPS only, and only `github.com`, its file CDNs (`objects.githubusercontent.com`, `release-assets.githubusercontent.com`), `gitlab.com` and `codeberg.org`. Redirects are followed by hand and every hop is validated.
- **Integrity.** If the release publishes the file's SHA-256, it is compared at the end; on mismatch the file is deleted and the download marked as failed. Otherwise the local SHA-256 is computed and stored.
- **Control.** One download at a time, queued. Downloads can be paused, resumed (`Range` request on the `.part` file), cancelled and retried. An unexpected shutdown leaves the download paused on next start.
- **Where.** `%LOCALAPPDATA%\dev.nativehub.app\downloads\<project>\<version>\<file>` (or `data\downloads` in the portable build).
- **Tests.** Six with a fake transport (redirects, SHA-256, disallowed host, pause and resume, file names) and one real (`--ignored`) that downloads SpaghettiKart and checks its SHA-256.

## 11. Installation (phase 5)

- **Plan before acting.** `install::plan` describes what will happen (extract, copy, open an installer or manual extraction), where, and what the game will ask for. The UI shows it and only installs when "Install" is pressed.
- **Method by file type.** ZIP: safe extraction (paths inside the folder, no symlinks, size and file-count limits; a common root folder is removed). Portable EXE: copied. Installer (setup/installer, .msi): not opened until the user confirms, then the user picks the installed executable. 7z/RAR: manual extraction.
- **Executable.** `.exe` files are searched (excluding uninstallers, updaters and crash handlers). If there is only one at the top level, it is chosen; otherwise the user picks. It can always be changed.
- **Reviewed adapters** (`catalog/adapters/*.json`, joined to the catalog by repository). Declarative JSON: `firstRun` (what the game will ask for when opened), `userFiles` (rules to check a ROM, ISO or dump: extension, header, size and SHA-1 only if the project publishes it), `exeHint` (if known) and `preserve` (phase 6). Texts carry an English version (`firstRunEn`, `labelEn`, `helpEn`, `notesEn`). First seven: Ship of Harkinian, 2 Ship 2 Harkinian, Zelda64Recomp, Starship, SpaghettiKart, sm64coopdx and Unleashed Recompiled. Reviewed against public documentation; not yet tested with the game.
- **Game File Validator.** Checks the user's file without copying or modifying it and stores only the path. It does not obtain keys or extract anything protected.
- **Launch and uninstall.** Launch only runs the chosen executable (inside the game folder, except external installers). Uninstall only deletes folders inside the games folder, after confirming, and warns that saves the game keeps inside are lost.
- **Games folder.** `Documents\NATIVE HUB` by default (`Games\` next to the executable in the portable build); it can be changed in Settings.
- **Tests.** Seven with generated ZIP files (method, extraction, malicious path, install/launch/uninstall, external installer, N64 ROM, adapter in the plan) and one real (`--ignored`) that downloads and installs SpaghettiKart.

## 12. Phase 6.1: startup animation and visible progress

- **Startup.** A ~2.3 s animation: the N is drawn, the lime dot appears, then the name and a loading line. It covers the catalog load and is skipped with a click or a key. A short chord generated with Web Audio plays (no third-party audio files), and can be turned off in Settings › Startup music. WebView2 starts with `--autoplay-policy=no-user-gesture-required` so it can play.
- **Visible progress.** `useTask()` shows a panel with steps and a bar for installing, uninstalling, deleting downloads, approving or discarding candidates, checking releases, checking files, changing the executable and saving the token. The real action runs at the same time; the panel guarantees a minimum duration (1–3 s depending on the action) and shows the error if it fails.
- **Accessibility.** With Windows "reduce motion", the animation is static and minimum durations drop to ~0.4 s.

## 13. Updating installs (phase 6)

- **Update Manager** (`crates/core/src/update.rs`). The new version is downloaded (the recommended file of the latest release, or the one you pick), extracted to a separate folder (`<games folder>\.native-hub\staging`) and compared with the install. The UI shows how many files are replaced, how many are new and which are kept, and only applies when "Apply" is pressed.
- **What is kept.** Nothing is deleted: whatever only exists in your folder (saves, screenshots, mods) stays. A file that also comes in the new version is kept if the adapter protects it (`preserve`) or if it is a save or settings file (`*.sav`, `save/`, `saves/`, `mods/`, `*.ini`, `*.cfg`, `*.json`, `*.toml`, `*.xml`…) changed after installing.
- **Safety.** Before replacing, every affected file is copied to `.native-hub\backups`. If something fails halfway, everything is restored. After updating, "Undo the update" goes back to the previous version (one backup per game).
- **Formats.** ZIP and portable EXE. Installers and 7z/RAR are updated by hand.
- **Tests.** Four with generated files (patterns, keeping saves and settings, undo, adapter protection, no download) and one real (`--ignored`) that installs Starship v1.0.0, saves a game, updates to v2.0.0 and undoes it.

## 14. Catalog expansion and automation (phase 7)

- **Sync with Recompendium** (`crates/core/src/sync.rs`). The app reads the list of entries in Recompendium's data repository (`github.com/Nio03/unricopie`, CC BY-SA 4.0) through the GitHub API and downloads from `raw.githubusercontent.com` only those it does not know yet, up to 300 per pass (the rest wait for the next one). Every new entry lands in the **review queue** with game, console, type and status already suggested from its data; it does not enter the catalog until approved.
- **Approving.** In the review queue, approve in one click or in bulk by source. Releases of what is approved are checked afterwards. Approved entries have origin `local` and survive catalog re-imports.
- **GitLab scanner.** Searches on the official API (`gitlab.com/api/v4/projects`, "recomp", "pc port"…) that also go to the queue. Whatever is already in the catalog or the queue is skipped (comparing the URL case-insensitively).
- **Automation.** A background thread checks every 15 minutes (the first time, one minute after startup) whether it is time to: check releases (batches of 1,500 with a token or 50 without) or search for new projects (GitHub, GitLab and Recompendium). Each task can be set in Settings to "every 6 h", "daily" (default) or "never", and never starts while another one is running.
- **Database.** Migration v4: `scan_candidates` gains `source` (`github-search`, `gitlab-search`, `recompendium`) and `suggestion` (JSON with the suggested details).
- **Tests.** `crates/core/tests/sync.rs` with a fake transport (new and known entries, suggestions, single and bulk approval, GitLab) and real tests (`--ignored`) in `tests/network.rs`.

## 15. Languages and portable build (0.2.1)

- **Interface language.** English by default, Spanish in Settings › Language (`src/lib/i18n.ts`; the choice is stored in the WebView and the window reloads). Texts are written inline as `tr('español', 'English')`.
- **Core messages.** Errors, install plans and progress follow the interface language: the UI calls `set_language` on startup and the core uses `t!(es, en, …)` / `tr(es, en)` (`crates/core/src/i18n.rs`).
- **Catalog texts.** Recompendium publishes descriptions and requirements in Spanish and English: the catalog keeps both (`summary`/`summaryEn`, `requirementsText`/`requirementsTextEn`). The manual list and the adapters also carry English texts.
- **Portable build.** If a file named `portable` (or `portable.txt`) sits next to the executable, the database, downloads and WebView profile go to `data\` and games to `Games\` beside it. The window is created at startup (not from `tauri.conf.json`) so its data folder can be set. The optional GitHub token stays in the current Windows user's Credential Manager.

## 16. Self-updates (0.3.0)

- **Plugin.** Official Tauri updater (`tauri-plugin-updater`) plus `tauri-plugin-process` to restart. Endpoint: `https://github.com/Edunknown/native-hub/releases/latest/download/latest.json`.
- **Signing.** Every installer is signed with the updater key (minisign). The public key is in `tauri.conf.json`; the private key lives outside the repo (`%USERPROFILE%\.native-hub-keys\updater.key`) and must be backed up: without it, no further update can be published to existing installs.
- **Flow.** Eight seconds after startup the app checks `latest.json`. If there is a newer version, a bar under the header offers "Update and restart", "What's new" and "Not now" (which hides that version until the next manual check). Nothing is downloaded without confirming. The NSIS installer runs in passive mode and the app restarts. Settings › NATIVE HUB version shows the current version and a manual check.
- **Portable.** `is_portable` tells the UI it runs in portable mode: it only announces the new version and opens its release page.

## 17. Road to 1.0

### Catalog served from GitHub

- **What.** The app ships with the catalog it was built with and also downloads the latest one published in the repository (`catalog/catalog.json` on `main`, from `raw.githubusercontent.com`), so new projects, fixes and adapters reach users without a new app version (`crates/core/src/remote.rs`).
- **When.** Daily by default (Settings › Automation › "Update the catalog from GitHub": every 6 h, daily or never), and by hand in Settings › Catalog. The request carries the ETag, so an unchanged catalog costs a 304.
- **Safety.** Only HTTPS from `raw.githubusercontent.com`. The file is validated before importing (at least 100 projects, at least a tenth of them installable, consistent games and platforms, unique slugs, HTTPS repositories, date not in the future) and only imported if it is **newer** than the loaded one; the catalog embedded in the executable never replaces a newer downloaded one. Live release data and user data are kept, as with any import. Downloads keep their own checks (allowed hosts, URL inside the project's repository).
- **Format.** `catalog.json` carries `schema` (now 1). A build only reads catalogs whose schema it knows; a newer one waits until the app is updated.
- **Tests.** `crates/core/tests/remote_catalog.rs`: newer, same (ETag/304), older, newer schema, broken catalogs and the real catalog passing validation.

### Licence and continuous integration

- Code under MIT (`LICENSE`); `catalog/` keeps CC BY-SA 4.0.
- `.github/workflows/ci.yml` on every push and pull request; `.github/workflows/release.yml` builds a draft release from a tag (see the README).

### Clear errors and a copyable log

- **Log file.** `native-hub.log` in `%LOCALAPPDATA%\dev.nativehub.app\logs` (`data\logs` in the portable build), also in release builds: start-up, downloads, installs, updates, launches, catalog checks, panics, and every command that failed in the interface. Up to 1 MB, two rotated files kept.
- **Errors.** `ErrorNote` shows a plain explanation and what to do (no connection, GitHub limit, disk full, file in use, access denied, missing file, SHA-256 mismatch, antivirus, host not allowed, invalid catalog; `src/lib/errors.ts`), then the original message, "Copy details" and "Open the log".
- **Copy details** (and Settings › Log › "Copy the log") copies the version, OS, build type, catalog version, the error and the last 64 KB of the log. The user's home folder is replaced with `~`.
- **Tests.** `src/lib/errors.test.ts` (Vitest, `npm run test:web`, also in CI).

### Search and filters

- **One query for both views.** `query::discover` takes the text, availability, console or console family, type, development status, "hide abandoned and taken down" and the sort order (relevance, title, latest release, newest, most popular). Discover shows it as a table; Search (text from the header) as an editorial list with the same filters.
- **Filters stay** while the window is open (session storage; nothing breaks without it). Search starts with every project (installable first); Discover starts with the installable ones.
- **Design.** Plain labels and underlined selects on one line, no boxes; lime only for the active availability.
- **Safety.** Text and values go in as SQL parameters; statuses are checked against a closed list.
- **Tests.** `query::tests::descubrir_con_texto_familia_estado_y_orden` and `src/lib/discover.test.ts` (the browser backend mirrors the Rust query).

## 18. Actual status of each feature

| Feature | Status |
|---|---|
| Main UI, navigation, light/dark theme, game page with picker | Done (phase 1) |
| Catalog of ≈1,550 projects with releases checked on GitHub | Done (phase 2) |
| SQLite database with migrations, import and queries | Done (phase 2), with tests in `crates/core` |
| Grouping by consoles and families | Done (phase 2) |
| Live release checks (GitHub, GitLab, Codeberg) with ETag and quota control | Done (phase 3) |
| GitHub scanner and review queue with manual approval | Done (phase 3) |
| Optional GitHub token in Credential Manager | Done (phase 3) |
| GitLab scanner | Done (phase 7) |
| Recompendium sync from the app, one-click or bulk approval | Done (phase 7) |
| Automatic release checks and discovery (6 h / 24 h / off) | Done (phase 7) |
| Resumable official downloads with SHA-256 | Done (phase 4) |
| Installation with a plan, declarative adapters and user file validation | Done (phase 5) |
| Library: launch, change executable, open folder, uninstall | Done (phase 5) |
| Startup animation with music and progress panels | Done (phase 6.1) |
| Updating installs while keeping saves and settings, with undo | Done (phase 6) |
| English interface (Spanish available) and portable build | Done (0.2.1) |
| Signed self-updates of the app | Done (0.3.0) |
| Catalog served from GitHub, imported only if newer | Done (1.0) |
| Log file, plain error explanations and "Copy details" | Done (1.0) |
| Search and filters (console, family, type, status, inactive, sort) | Done (1.0) |
