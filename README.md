# NATIVE HUB

Launcher universal de recompilaciones y ports nativos de videojuegos para PC (Windows 10/11, 64 bits).
Tauri 2 + Rust + React + TypeScript + SQLite.

> Estado: **fase 1, prototipo visual.** El catálogo usa datos reales comprobados en la API de GitHub.
> Descargas, instalación, biblioteca y actualizaciones **todavía no están implementadas**.

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
npm run catalog:snapshot    # refresca catalog/seed.json desde la API de GitHub
```

`catalog:snapshot` usa la API pública (60 consultas por hora). Con `GITHUB_TOKEN` en el entorno el límite sube.

## Catálogo

- `catalog/curated.json`: datos curados a mano (juego, proyecto, tipo, requisitos, patrón del ejecutable Windows).
- `catalog/seed.json`: generado. Añade versión, fecha, assets, licencia y SHA-256 publicado. No editar a mano.

Un proyecto solo es instalable si su última release oficial tiene un asset Windows que encaja con su patrón.
Los que no lo tienen aparecen en «Proyectos en desarrollo».

NATIVE HUB no incluye ni descarga ROMs, ISOs, BIOS, firmware ni claves.
