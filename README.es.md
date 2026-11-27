<p align="center">
  <img src="docs/assets/logo.svg" width="112" height="112" alt="Logo de NATIVE HUB">
</p>

<h1 align="center">NATIVE HUB</h1>

<p align="center"><a href="README.md">English</a> · <b>Español</b></p>

<p align="center">
  Launcher universal de recompilaciones y ports nativos de videojuegos para PC (Windows 10/11, 64 bits).<br>
  Tauri 2 + Rust + React + TypeScript + SQLite.
</p>

> **Versión 0.2.1 · fase 7, expansión.** Catálogo de ≈1.550 proyectos de 40 plataformas, releases
> en vivo, escáner de GitHub y GitLab con cola de revisión, sincronización con Recompendium,
> descargas oficiales con SHA-256, instalación con plan y adaptadores, actualizaciones que
> conservan partidas y comprobaciones automáticas cada 6 o 24 h.

## Qué hace

- **Catálogo fiable.** Qué juego tiene qué recompilación, decompilación o port nativo, y cuáles se pueden instalar de verdad (release oficial con ejecutable Windows). Cada dato lleva su origen y su fecha de comprobación.
- **Releases en vivo.** Comprueba GitHub, GitLab y Codeberg con la API oficial, ETag y control de cuota. Token de GitHub opcional, guardado en el Administrador de credenciales de Windows.
- **Descubrir proyectos nuevos.** Escáner de GitHub y GitLab y sincronización con Recompendium. Todo lo nuevo pasa por una cola de revisión; nada entra solo en el catálogo.
- **Descargar e instalar.** Solo desde la release oficial del propio proyecto, por HTTPS, con verificación SHA-256 cuando se publica. Antes de instalar enseña el plan; los instaladores externos solo se abren con tu confirmación.
- **Biblioteca y actualizaciones.** Ejecutar, cambiar el ejecutable, abrir la carpeta y desinstalar. Las actualizaciones conservan partidas y configuración, hacen copia de seguridad y se pueden deshacer.
- **Automatización.** Comprobación de releases y búsqueda de proyectos cada 6 h, cada 24 h o desactivada (Ajustes).

NATIVE HUB **no incluye ni descarga ROMs, ISOs, BIOS, firmware ni claves**. Solo localiza y valida los archivos que ya tienes.

## Instalar

Descarga el instalador `NATIVE.HUB_<versión>_x64-setup.exe` desde [Releases](../../releases). No está firmado, así que Windows SmartScreen puede avisar: pulsa «Más información» › «Ejecutar de todas formas». El instalador incluye el arranque de WebView2 si falta.

### Portable

Descarga `NATIVE-HUB_<versión>_x64-portable.zip`, descomprímelo donde quieras (también en un USB) y abre `NATIVE HUB.exe`. Como la carpeta trae un archivo llamado `portable`, todo se guarda junto al ejecutable: `data\` (base de datos, descargas y perfil de WebView) y `Games\`. Para usarlo como la versión instalada, borra el archivo `portable`. Necesita WebView2, que viene con Windows 11. El token opcional de GitHub sigue en el Administrador de credenciales del usuario de Windows.

Datos de la app: `%APPDATA%\dev.nativehub.app` (base de datos) y `%LOCALAPPDATA%\dev.nativehub.app` (descargas). Juegos: `Documentos\NATIVE HUB` por defecto.

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): análisis, arquitectura, riesgos, modelo de datos, adaptadores, seguridad, estructura de carpetas y detalle de cada fase. En inglés: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Desarrollo

| Herramienta | Para qué |
|---|---|
| Node.js y npm | Interfaz (Vite + React) |
| Rust (`rustup`) | Backend de Tauri |
| Microsoft C++ Build Tools + SDK de Windows | Enlazar el ejecutable en Windows |
| WebView2 | Motor de la interfaz (viene con Windows 11) |

```powershell
npm install                 # dependencias
npm run dev                 # interfaz en el navegador: http://localhost:1420
npm run tauri dev           # app de escritorio (necesita Rust y C++ Build Tools)
npm run tauri build         # instalador NSIS en target\release\bundle\nsis
npm run catalog:update      # reimporta Recompendium y comprueba releases en GitHub
npm run catalog:build       # solo une fuentes y comprueba lo no revisado en 12 h
npm run catalog:covers      # resuelve portadas de IGDB (necesita IGDB_CLIENT_ID / IGDB_CLIENT_SECRET)
npm test                    # pruebas del núcleo en Rust
```

Estructura: `src/` interfaz, `src-tauri/` app de escritorio, `crates/core/` núcleo en Rust (SQLite, releases, escáner, descargas, instalación, actualizaciones, sincronización), `catalog/` datos del catálogo y adaptadores, `scripts/` generación del catálogo.

## Historial

| Fase | Contenido |
|---|---|
| 1 | Interfaz, navegación, tema claro/oscuro, ficha con selector de proyecto |
| 2 | Catálogo de Recompendium + lista manual, SQLite, consolas y familias |
| 3 | Releases en vivo, escáner de GitHub, cola de revisión, token opcional |
| 4 | Descargas oficiales reanudables con SHA-256 |
| 5 | Instalación con plan, adaptadores, validación de archivos, biblioteca |
| 6 / 6.1 | Actualizaciones que conservan partidas; animación de inicio y paneles de progreso |
| 7 | Sincronización con Recompendium, escáner de GitLab, automatización |
| 0.2.1 | Interfaz en inglés (español disponible), versión portable con los datos junto al ejecutable |

## Licencias y atribución

- **Catálogo.** Incluye datos de [Recompendium](https://recompendium.com) bajo licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es). El catálogo derivado (`catalog/`) se distribuye bajo esa misma licencia; ver [catalog/LICENSE.md](catalog/LICENSE.md).
- **Portadas.** Las portadas vienen de [IGDB](https://www.igdb.com). El catálogo guarda solo los identificadores de imagen de IGDB; la app descarga cada imagen de images.igdb.com la primera vez que se muestra y la guarda en caché local. Las imágenes pertenecen a sus editores.
- **Proyectos enlazados.** Cada recompilación o port pertenece a sus autores y tiene su propia licencia; NATIVE HUB solo enlaza y descarga sus releases oficiales.
- **Nombres de juegos y consolas.** Son marcas de sus respectivos propietarios. NATIVE HUB no está afiliado a ninguno.
