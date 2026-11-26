# NATIVE HUB

Launcher universal de recompilaciones y ports nativos de videojuegos para PC (Windows 10/11, 64 bits).
Tauri 2 + Rust + React + TypeScript + SQLite.

> Estado: **fase 5, instalación.** Catálogo de ≈1.550 proyectos, releases en vivo, escáner con cola de
> revisión, descargas oficiales con SHA-256 e instalación con plan y adaptadores. Las actualizaciones
> de lo instalado **todavía no están implementadas** (fase 6).

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): análisis, arquitectura, riesgos, modelo de datos, adaptadores, seguridad y estructura de carpetas.

## Requisitos

| Herramienta | Para qué |
|---|---|
| Node.js y npm | Interfaz (Vite + React) |
| Rust (`rustup`) | Backend de Tauri |
| Microsoft C++ Build Tools + SDK de Windows | Enlazar el ejecutable en Windows |
| WebView2 | Motor de la interfaz (viene con Windows 11) |

## Comandos

```powershell
npm install                 # dependencias
npm run dev                 # interfaz en el navegador: http://localhost:1420
npm run tauri dev           # app de escritorio (necesita Rust y C++ Build Tools)
npm run tauri build         # instalador NSIS
npm run catalog:update      # reimporta Recompendium y comprueba releases en GitHub
npm run catalog:build       # solo une fuentes y comprueba lo no revisado en 12 h
npm test                    # pruebas del núcleo en Rust
```


## Catálogo

Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md#8-catálogo-fase-2). Incluye datos de [Recompendium](https://recompendium.com) bajo licencia CC BY-SA 4.0.

NATIVE HUB no incluye ni descarga ROMs, ISOs, BIOS, firmware ni claves.
