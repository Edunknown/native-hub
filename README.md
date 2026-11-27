<p align="center">
  <img src="docs/assets/logo.svg" width="112" height="112" alt="NATIVE HUB logo">
</p>

<h1 align="center">NATIVE HUB</h1>

<p align="center">
  A universal launcher for native PC recompilations and ports of video games (Windows 10/11, 64-bit).<br>
  Tauri 2 + Rust + React + TypeScript + SQLite.
</p>

<p align="center"><b>English</b> · <a href="README.es.md">Español</a></p>

> **Version 1.1.0.** A catalog of ≈1,550 projects across 40 platforms, live
> release checks, a GitHub and GitLab scanner with a review queue, Recompendium sync, official
> downloads with SHA-256, installation with a plan and adapters, updates that keep your saves,
> automatic checks every 6 or 24 hours, game covers from IGDB, self-updates, a portable build,
> search and filters, a guided first run, an always-fresh catalog served from GitHub and adapters tested in CI.

## What it does

- **A reliable catalog.** Which game has which recompilation, decompilation or native port, and which ones can actually be installed (an official release with a Windows executable). Every entry records its source and when it was last checked.
- **Live releases.** Checks GitHub, GitLab and Codeberg through their official APIs, with ETag caching and quota control. An optional GitHub token is stored in Windows Credential Manager.
- **Discover new projects.** GitHub and GitLab scanner plus Recompendium sync. Everything new goes through a review queue; nothing enters the catalog on its own.
- **Download and install.** Only from the project's own official release, over HTTPS, with SHA-256 verification when published. The install plan is shown first; external installers only open after you confirm.
- **Library and updates.** Launch, change the executable, open the folder and uninstall. Updates keep saves and settings, take a backup first and can be undone.
- **Automation.** Release checks and project discovery every 6 h, every 24 h, or off (Settings).
- **English and Spanish.** English by default; switch language in Settings.
- **Self-updating.** On startup NATIVE HUB checks GitHub for a new version of itself and asks before installing it. Updates are signed; the portable build only tells you and opens the release page.

NATIVE HUB **does not include or download ROMs, ISOs, BIOS, firmware or keys**. It only locates and validates files you already own.

## Install

Download `NATIVE.HUB_<version>_x64-setup.exe` from [Releases](../../releases). It is not signed, so Windows SmartScreen may warn you: click "More info" › "Run anyway". The installer bootstraps WebView2 if it is missing.

App data: `%APPDATA%\dev.nativehub.app` (database) and `%LOCALAPPDATA%\dev.nativehub.app` (downloads). Games: `Documents\NATIVE HUB` by default.

### Portable

Download `NATIVE-HUB_<version>_x64-portable.zip`, unzip it anywhere (a USB drive works) and open `NATIVE HUB.exe`. Because the folder contains a file named `portable`, everything stays next to the executable: `data\` (database, downloads and WebView profile) and `Games\`. Requires WebView2, which ships with Windows 11. Delete the `portable` file to make it behave like the installed version. The optional GitHub token still lives in the Credential Manager of the current Windows user.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): analysis, architecture, risks, data model, adapters, security, folder layout and details of every phase. Spanish: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Development

| Tool | Used for |
|---|---|
| Node.js and npm | UI (Vite + React) |
| Rust (`rustup`) | Tauri backend |
| Microsoft C++ Build Tools + Windows SDK | Linking the Windows executable |
| WebView2 | UI engine (ships with Windows 11) |

```powershell
npm install                 # dependencies
npm run dev                 # UI in the browser: http://localhost:1420
npm run tauri dev           # desktop app (needs Rust and C++ Build Tools)
npm run tauri build         # NSIS installer in target\release\bundle\nsis
npm run catalog:update      # re-import Recompendium and check releases on GitHub
npm run catalog:build       # only merge sources and check entries not reviewed in 12 h
npm run catalog:covers      # resolve IGDB covers (needs IGDB_CLIENT_ID / IGDB_CLIENT_SECRET)
npm test                    # Rust core tests
npm run test:web            # frontend tests (Vitest)
```

### Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`):

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Write the notes in `docs/releases/v<version>.md`. Its first paragraph is the summary the app shows in the update prompt.
3. Push a tag: `git tag v<version> && git push origin v<version>`.

The workflow runs the core tests, builds the signed installer, `latest.json` and the portable ZIP, and leaves everything in a **draft** release with the SHA-256 checksums. Nothing reaches users until the draft is published on GitHub.

It needs two repository secrets: `TAURI_SIGNING_PRIVATE_KEY` (the contents of the updater private key, which never goes in the repo) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if the key has no password). To build by hand instead:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.native-hub-keys\updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
```

Every push and pull request runs `.github/workflows/ci.yml`: core tests on Windows and Linux, lint, type check and frontend build, catalog and adapter validation (`node scripts/check-catalog.mjs`) and a check of the desktop app on Windows.

Layout: `src/` UI, `src-tauri/` desktop app, `crates/core/` Rust core (SQLite, releases, scanner, downloads, installation, updates, sync), `catalog/` catalog data and adapters, `scripts/` catalog generation.

## History

| Phase | Contents |
|---|---|
| 1 | UI, navigation, light/dark theme, game page with project picker |
| 2 | Recompendium catalog + manual list, SQLite, consoles and families |
| 3 | Live releases, GitHub scanner, review queue, optional token |
| 4 | Resumable official downloads with SHA-256 |
| 5 | Installation with a plan, adapters, file validation, library |
| 6 / 6.1 | Updates that keep saves; startup animation and progress panels |
| 7 | Recompendium sync, GitLab scanner, automation |
| 0.2.1 | English UI (Spanish available), portable build with data next to the executable |
| 0.3.0 | IGDB game covers, signed self-updates from GitHub Releases |
| 1.0.0 | MIT license, catalog served from GitHub, search and filters, guided first run, clear errors and a copyable log, adapters tested in CI, the N app icon |
| 1.1.0 | ZIP downloads install on their own and the ZIP is deleted; fallback to the ZIP when an .exe cannot be downloaded |

## Licenses and attribution

- **Code.** NATIVE HUB's source code is under the [MIT license](LICENSE). The catalog data in `catalog/` is not: it keeps its own license, below.
- **Catalog.** Includes data from [Recompendium](https://recompendium.com) under the [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) license. The derived catalog (`catalog/`) is distributed under the same license; see [catalog/LICENSE.md](catalog/LICENSE.md).
- **Covers.** Cover art comes from [IGDB](https://www.igdb.com). The catalog only stores IGDB image IDs; the app downloads each image from images.igdb.com the first time it is shown and caches it locally. The images belong to their publishers.
- **Linked projects.** Each recompilation or port belongs to its authors and has its own license; NATIVE HUB only links to and downloads their official releases.
- **Game and console names.** They are trademarks of their respective owners. NATIVE HUB is not affiliated with any of them.
