<p align="center">
  <img src="docs/assets/logo.svg" width="112" height="112" alt="NATIVE HUB logo">
</p>

<h1 align="center">NATIVE HUB</h1>

<p align="center">
  A universal launcher for native PC recompilations and ports of video games (Windows 10/11, 64-bit).<br>
  Tauri 2 + Rust + React + TypeScript + SQLite.
</p>

<p align="center"><b>English</b> · <a href="README.es.md">Español</a></p>

> **Version 0.2.1 · phase 7, expansion.** A catalog of ≈1,550 projects across 40 platforms, live
> release checks, a GitHub and GitLab scanner with a review queue, Recompendium sync, official
> downloads with SHA-256, installation with a plan and adapters, updates that keep your saves,
> automatic checks every 6 or 24 hours, and a portable build.

## What it does

- **A reliable catalog.** Which game has which recompilation, decompilation or native port, and which ones can actually be installed (an official release with a Windows executable). Every entry records its source and when it was last checked.
- **Live releases.** Checks GitHub, GitLab and Codeberg through their official APIs, with ETag caching and quota control. An optional GitHub token is stored in Windows Credential Manager.
- **Discover new projects.** GitHub and GitLab scanner plus Recompendium sync. Everything new goes through a review queue; nothing enters the catalog on its own.
- **Download and install.** Only from the project's own official release, over HTTPS, with SHA-256 verification when published. The install plan is shown first; external installers only open after you confirm.
- **Library and updates.** Launch, change the executable, open the folder and uninstall. Updates keep saves and settings, take a backup first and can be undone.
- **Automation.** Release checks and project discovery every 6 h, every 24 h, or off (Settings).
- **English and Spanish.** English by default; switch language in Settings.

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
```

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

## Licenses and attribution

- **Catalog.** Includes data from [Recompendium](https://recompendium.com) under the [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) license. The derived catalog (`catalog/`) is distributed under the same license; see [catalog/LICENSE.md](catalog/LICENSE.md).
- **Covers.** Cover art comes from [IGDB](https://www.igdb.com). The catalog only stores IGDB image IDs; the app downloads each image from images.igdb.com the first time it is shown and caches it locally. The images belong to their publishers.
- **Linked projects.** Each recompilation or port belongs to its authors and has its own license; NATIVE HUB only links to and downloads their official releases.
- **Game and console names.** They are trademarks of their respective owners. NATIVE HUB is not affiliated with any of them.
