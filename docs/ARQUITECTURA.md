# NATIVE HUB · Análisis y arquitectura

Documento de partida (apartado 19 del brief). Fecha: 26/11/2026. Estado: fase 1 en curso.

---

## 1. Análisis de requisitos

NATIVE HUB es un **gestor de proyectos de recompilación y ports nativos**, no un emulador ni una tienda. Su valor está en tres cosas:

1. **Un catálogo fiable.** Saber qué juego tiene qué implementaciones para PC, y cuáles se pueden instalar *de verdad* (release oficial con ejecutable Windows). La fiabilidad pesa más que el tamaño.
2. **Instalaciones que funcionan.** Cada proyecto tiene su propio procedimiento: ZIP portable, instalador, ROM a validar, ISO a extraer, archivos de Xbox 360... Un adaptador por proyecto, no un instalador universal.
3. **Una experiencia cuidada.** La interfaz forma parte del producto: editorial, sobria, sin plantillas de dashboard.

Requisitos que condicionan la arquitectura:

| Requisito | Consecuencia técnica |
|---|---|
| No inventar disponibilidad ni versiones | Todo dato del catálogo tiene `origen` y `verificado_en`. Sin verificar se muestra «por verificar», nunca un valor supuesto. |
| Solo instalable si hay release compatible | El estado `instalable` lo calcula el Release Manager a partir de assets reales, no lo escribe nadie a mano. |
| Descubrimiento automático separado de la aprobación | Dos almacenes: `candidatos` (lo que encuentra el escáner) y `catálogo aprobado` (revisado). Ningún candidato pasa solo. |
| Descargas solo desde la fuente original | Lista blanca de dominios por proyecto; nada se aloja en servidores propios. |
| Sin ROMs, ISOs, BIOS, claves ni firmware | El launcher solo *localiza y valida* archivos del usuario (tamaño, hash conocido, cabecera). No hay código de extracción de claves ni de elusión de protecciones. |
| No ejecutar nada sin consentimiento | Ninguna instalación silenciosa. Los instaladores `.exe/.msi` se lanzan solo tras confirmación explícita y se marcan como «asistidos». |
| Varios proyectos por juego | Modelo `juego 1—N proyecto`; el selector vive en la ficha del juego. |
| Windows primero, Linux/macOS después | Rutas y lanzamiento abstraídos por plataforma desde el principio; el catálogo guarda assets por SO. |

## 2. Arquitectura propuesta

```
┌────────────────────────────── Frontend (WebView2) ──────────────────────────────┐
│ React 19 + TypeScript · Vite · CSS propio (tokens)                              │
│ Vistas: Inicio · Biblioteca · Descubrir · Consolas · Actualizaciones · Descargas │
│         · Ajustes · Ficha de juego                                              │
│ Capa de datos: src/lib/api.ts  → invoke() de Tauri  (o catálogo semilla en web) │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ IPC Tauri (comandos tipados, permisos mínimos)
┌───────────────────────────────────────┴─────────────────────────────────────────┐
│ src-tauri (Rust) · capa fina: comandos, eventos de progreso, estado de la app    │
├─────────────────────────────────────────────────────────────────────────────────┤
│ crates/core (Rust, sin dependencia de Tauri → testeable)                         │
│  catalog       Catalog Manager        · juegos, plataformas, proyectos           │
│  scanner       Repository Scanner     · GitHub/GitLab → candidatos               │
│  releases      Release Manager        · releases, assets, selección por SO       │
│  download      Download Manager       · cola, reanudación, SHA-256, dominios     │
│  install       Installation Manager   · ejecuta planes de adaptador              │
│  build         Build Manager          · (futuro) compilación aislada, opt-in     │
│  files         Game File Validator    · localizar y validar archivos del usuario │
│  adapters      Project Adapter System · manifiestos declarativos + nativos       │
│  updates       Update Manager         · comparar instalado vs última release     │
│  library       Library Manager        · instalaciones, lanzamiento, desinstalar  │
│  config        Configuration Manager  · ajustes, rutas, tema                     │
│  db            SQLite (rusqlite) + migraciones                                   │
│  audit         Registro de operaciones importantes                               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Decisiones clave:

- **Núcleo en un crate separado** (`crates/core`). La lógica de dominio no depende de Tauri: se prueba con `cargo test` y se podrá reutilizar en un CLI o en un servicio de catálogo.
- **El catálogo es datos versionados en el repo** (`catalog/`), uno por juego y uno por proyecto, validados por esquema. Al arrancar se cargan en SQLite. Así cada cambio del catálogo es revisable en un diff, y el escáner nunca escribe en él directamente.
- **Datos vivos separados de datos curados.** Lo curado (qué proyecto es, qué archivos pide, cómo se instala) está en `catalog/`. Lo vivo (última versión, fecha, assets) lo obtiene el Release Manager y se guarda en SQLite con su fecha de comprobación.
- **Frontend sin estado de verdad propio.** La interfaz pide todo por `invoke()`. En fase 1, mientras no hay Rust compilado, `api.ts` sirve el catálogo semilla para poder trabajar el diseño en el navegador.
- **Permisos de Tauri mínimos.** Sin plugin de shell genérico. Lanzar un juego es un comando Rust que solo acepta ejecutables registrados en una instalación.

## 3. Riesgos técnicos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Límite de la API de GitHub (60 peticiones/hora sin token) | Escaneo lento o bloqueado | Caché con `ETag`/`If-None-Match` (las respuestas 304 no consumen cuota), comprobaciones escalonadas, token **opcional** del usuario guardado en el Administrador de credenciales de Windows. |
| Nombres de assets heterogéneos (`SoH-…-Win64.zip`, `…-Windows.zip`, `pd-x86_64-windows.zip`) | Elegir el archivo equivocado | Cada adaptador declara un patrón de asset por SO y arquitectura. Si no hay coincidencia única, el proyecto queda «no instalable» y se avisa. |
| Releases «rolling» o de CI (p. ej. una etiqueta `ci-dev-build`) | Versiones que cambian sin cambiar de nombre | Identificar la versión por `tag + fecha de publicación + id del asset`, marcar el proyecto como experimental. |
| Pocos proyectos publican SHA-256 o firmas | Integridad no verificable | Verificar cuando exista; si no, calcular y registrar el hash local, mostrar «sin hash publicado» y comprobar que el origen sea el dominio permitido. |
| SmartScreen y antivirus marcan ejecutables sin firmar | El usuario cree que el launcher es malware | Mensajes claros, nunca desactivar protecciones, enlazar a la release oficial. |
| Instaladores `.exe`/`.msi` que piden UAC | Instalación silenciosa imposible y no deseable | Modo «asistido»: se descarga, se verifica y el usuario lo lanza con confirmación. |
| Actualizaciones que pisan configuración y partidas | Pérdida de datos del usuario | El adaptador declara qué rutas se preservan; copia de seguridad antes de actualizar; el usuario revisa antes de aplicar. |
| Requisitos de archivos originales muy distintos (ROM con hash concreto, ISO a extraer, volcado de Xbox 360) | Validación compleja | Validadores declarativos por proyecto (tamaño, hashes conocidos publicados por el proyecto, cabecera). Si el proyecto trae su propio extractor, se usa el suyo con permiso; NATIVE HUB no implementa extracción de material protegido. |
| Exactitud del catálogo a escala | Datos falsos | Proceso de aprobación manual, fecha de verificación visible, estado «por verificar». |
| Legalidad según jurisdicción | Riesgo para el usuario | Avisos por proyecto, respetar licencias y atribución, no alojar nada protegido. |
| WebView2 ausente en algún Windows 10 | La app no abre | El instalador NSIS de Tauri incluye el arranque de WebView2. |

## 4. Modelo de datos (SQLite)

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

Reglas:

- `UNIQUE(repo_host, repo_owner, repo_name)` en `projects` y en `scan_candidates` evita duplicados.
- `installable` no es una columna: es una vista que exige `listing = library`, una release no retirada y un asset Windows que encaje con el patrón del adaptador.
- `last_checked_at` de cada proyecto = `MAX(releases.fetched_at)`.

## 5. Sistema de adaptadores

Cada proyecto instalable tiene un adaptador **revisado y versionado** en `catalog/adapters/<proyecto>.toml`. Hay dos tipos:

**Declarativo (por defecto).** Un plan con pasos de un vocabulario cerrado. Sin scripts ni comandos libres:

```toml
id = "shipwright"
version = 1
allowed_domains = ["github.com", "objects.githubusercontent.com"]

[asset.windows-x64]
pattern = "^SoH-.*-Win64\\.zip$"

[[steps]]
kind = "download_asset"

[[steps]]
kind = "verify"          # SHA-256 publicado si existe; si no, registra el local

[[steps]]
kind = "extract_zip"
into = "{install_dir}"

[[steps]]
kind = "require_user_file"
key = "rom"
label = "ROM de Ocarina of Time"
accept = [".z64", ".n64", ".v64"]
# los hashes aceptados se copian de la documentación del proyecto, con enlace

[launch]
executable = "soh.exe"
working_dir = "{install_dir}"

[update]
preserve = ["*.json", "Save/**", "mods/**"]
```

Pasos previstos: `download_asset`, `verify`, `extract_zip`, `extract_7z`, `copy`, `require_user_file`, `write_config`, `run_installer_assisted` (con confirmación), `run_project_tool` (herramienta incluida en la release del propio proyecto, con confirmación), `set_launch`.

**Nativo (excepción).** Para un proyecto que no encaje en el vocabulario, un módulo Rust compilado dentro de la app que implementa el trait `Adapter`. Pasa por revisión de código como cualquier otro cambio. Nunca se descargan adaptadores ejecutables desde internet.

```rust
trait Adapter {
    fn id(&self) -> &str;
    fn version(&self) -> u32;
    fn select_asset(&self, release: &Release, target: &Target) -> Option<AssetRef>;
    fn plan(&self, ctx: &InstallContext) -> Result<InstallPlan>;   // lista de pasos
    fn validate_user_file(&self, key: &str, file: &Path) -> Result<Validation>;
    fn launch(&self, inst: &Installation) -> Result<LaunchSpec>;
}
```

El Installation Manager solo ejecuta `InstallPlan`: muestra el plan al usuario, pide confirmación, ejecuta cada paso con posibilidad de cancelar, y lo registra en `audit_log`.

## 6. Seguridad

- URLs de descarga validadas contra `allowed_domains` del adaptador y solo HTTPS.
- Nada descargado se ejecuta sin confirmación; los instaladores van en modo asistido.
- Ningún comando ni script procedente de un repositorio se ejecuta.
- No se guardan claves de juegos. El token de GitHub, si el usuario lo pone, va al almacén de credenciales del sistema.
- Rutas de extracción saneadas (protección contra *zip slip*) y limitadas a la carpeta de instalación.
- La compilación (Build Manager) queda fuera hasta tener aislamiento; es opcional y nunca necesaria para la biblioteca principal.
- Permisos de Tauri mínimos y CSP estricta.

## 7. Estructura de carpetas

```
recomp-hub/
├─ docs/                    Arquitectura, decisiones, guía de adaptadores
├─ catalog/                 Catálogo curado (datos versionados)
│  ├─ seed.json             Semilla de fase 1 (proyectos reales, datos comprobados)
│  ├─ games/                (fase 2) un archivo por juego
│  ├─ projects/             (fase 2) un archivo por proyecto
│  └─ adapters/             (fase 5) un manifiesto por proyecto instalable
├─ src/                     Frontend React + TypeScript
│  ├─ app/                  Shell: barra lateral, cabecera, barra de estado, rutas
│  ├─ views/                Inicio, Biblioteca, Descubrir, Consolas, ...
│  ├─ components/           Piezas de interfaz reutilizables
│  ├─ lib/                  api.ts (IPC), tipos del dominio, utilidades
│  └─ styles/               Tokens de diseño y estilos globales
├─ src-tauri/               App de escritorio (Rust)
│  ├─ src/                  Comandos y arranque
│  ├─ capabilities/         Permisos
│  └─ tauri.conf.json
└─ crates/core/             (fase 2) Núcleo de dominio en Rust
```

## 8. Estado real de cada función

| Función | Estado |
|---|---|
| Interfaz principal, navegación, tema claro/oscuro, ficha con selector | **Fase 1, en curso** |
| Catálogo semilla con proyectos reales comprobados en GitHub el 26/11/2026 | Hecho (solo lectura, sin base de datos) |
| Base de datos SQLite y clasificación por consolas | No implementado (fase 2) |
| Escáner de GitHub/GitLab y detección de releases en vivo | No implementado (fase 3) |
| Descargas | No implementado (fase 4) |
| Adaptadores e instalación | No implementado (fase 5) |
| Biblioteca: ejecutar, actualizar, desinstalar | No implementado (fase 6). En la interfaz aparece vacía. |
