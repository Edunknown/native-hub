# NATIVE HUB · Análisis y arquitectura

Documento de partida (apartado 19 del brief). Fecha: 26/11/2026. Actualizado: 27/11/2026, versión 0.3.0. En inglés: [ARCHITECTURE.md](ARCHITECTURE.md).

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
├─ docs/                      Arquitectura y decisiones
├─ catalog/
│  ├─ sources/manual.json     Curado a mano: plataformas, proyectos extra y correcciones
│  ├─ sources/recompendium.json  Importado de Recompendium (CC BY-SA 4.0)
│  └─ catalog.json            Generado: fuentes unidas + releases comprobadas en GitHub
├─ scripts/
│  ├─ import-recompendium.mjs Convierte los datos de Recompendium
│  └─ build-catalog.mjs       Une fuentes y comprueba releases y ejecutables Windows
├─ src/                       Frontend React + TypeScript
│  ├─ app/                    Shell, navegación, tema, contexto del catálogo
│  ├─ views/                  Inicio, Biblioteca, Descubrir, Consolas, ...
│  ├─ components/             Piezas de interfaz reutilizables
│  ├─ lib/                    api.ts (IPC), web-backend.ts (modo navegador), tipos
│  └─ styles/                 Tokens de diseño y estilos globales
├─ src-tauri/                 App de escritorio: comandos y arranque
├─ crates/core/               Núcleo en Rust: SQLite, migraciones, importación, consultas
└─ Cargo.toml                 Workspace de Rust
```

## 8. Catálogo (fase 2)

Flujo: `npm run catalog:update` = importar Recompendium → unir con `manual.json` → comprobar en github.com la última release de cada repositorio → escribir `catalog/catalog.json`. La app incluye ese archivo al compilar y lo vuelca en SQLite (`%APPDATA%\dev.nativehub.app\native-hub.db`) cuando cambia de versión.

- **Fuentes.** Recompendium (≈1.550 proyectos de 40 plataformas, datos bajo CC BY-SA 4.0: se muestran con atribución y el catálogo derivado mantiene esa licencia) y la lista manual de NATIVE HUB, que tiene prioridad (corrige repositorios movidos, fija el archivo Windows de un proyecto y añade proyectos que faltan, como Fire Emblem: Fortune’s Weave).
- **Instalable.** Solo si la última release publica un archivo que se identifica como ejecutable Windows y el proyecto no está retirado por DMCA. Si la release tiene archivos genéricos (un `.zip` sin sistema en el nombre), queda «por verificar» hasta revisarlo a mano.
- **Comprobación.** Se usan las páginas públicas de releases de github.com para no chocar con el límite de 60 consultas por hora de la API sin token. En la fase 3 la app lo hará con la API oficial, ETag y token opcional.
- **Switch 2.** Se incluyen porque el catálogo debe ser completo, pero con aviso: juegos comerciales recientes, muchos forks y riesgo legal y de seguridad alto.

## 9. Repositorios en vivo (fase 3)

- **Release Manager** (`crates/core/src/releases.rs`). Consulta la API oficial de GitHub, GitLab o Codeberg según el repositorio, decide si la release publica un ejecutable Windows (la misma lógica que el script del catálogo) y guarda el resultado. Las novedades quedan en `update_events`: versión nueva, primer ejecutable Windows, release retirada y repositorio desaparecido. Lo comprobado en vivo se guarda aparte (`release_state`) y se vuelve a aplicar si se importa un catálogo más antiguo.
- **Cuota.** Cada petición lleva su ETag: un 304 no gasta cuota en GitHub. La cuota restante se guarda y los lotes se detienen solos dejando un margen. Sin token, 60 consultas por hora; con token, 5.000. El token es opcional, se valida contra GitHub antes de guardarlo y vive en el Administrador de credenciales de Windows.
- **Repository Scanner** (`crates/core/src/scanner.rs`). Búsquedas concretas en GitHub (temas `static-recompilation`, `recompilation`, «recomp» en el nombre, «native pc port»…). Descarta lo que ya está en el catálogo, guarda el resto como candidato y comprueba la release de los 30 más populares. Los candidatos no entran en el catálogo: hay que aprobarlos en la cola de revisión y asignarles juego, plataforma y tipo. Lo aprobado es de origen `local` y sobrevive a las reimportaciones del catálogo.
- **Seguridad.** Solo se habla con `api.github.com`, `gitlab.com` y `codeberg.org`, siempre por HTTPS. Las URL de repositorio se validan antes de construir ninguna petición. Nada se descarga ni se ejecuta.
- **Pruebas.** `npm test` usa un servidor falso. `cargo test -p native-hub-core --test network -- --ignored` prueba contra las APIs reales.

## 10. Descargas (fase 4)

- **Download Manager** (`crates/core/src/download.rs`). La interfaz solo pide «descargar el proyecto X»: la URL sale del catálogo, nunca de la interfaz. Antes de poner nada en cola se comprueba que el proyecto es instalable (ejecutable Windows identificado, sin DMCA) y que la URL es un archivo de release de su propio repositorio.
- **Orígenes.** Solo HTTPS y solo `github.com`, sus CDN de archivos (`objects.githubusercontent.com`, `release-assets.githubusercontent.com`), `gitlab.com` y `codeberg.org`. Las redirecciones se siguen a mano y cada salto se valida.
- **Integridad.** Si la release publica el SHA-256 del archivo, se compara al terminar; si no coincide, el archivo se borra y la descarga queda como error. Si no lo publica, se calcula y se guarda el SHA-256 local.
- **Control.** Una descarga a la vez, en cola. Se puede pausar, reanudar (petición `Range` sobre el `.part`), cancelar y reintentar. Un cierre inesperado deja la descarga en pausa al volver a abrir.
- **Dónde.** `%LOCALAPPDATA%\dev.nativehub.app\downloads\<proyecto>\<versión>\<archivo>`. Nada se descomprime ni se ejecuta: eso es la fase 5.
- **Pruebas.** Seis con transporte falso (redirecciones, SHA-256, host no permitido, pausa y reanudación, nombres de archivo) y una real (`--ignored`) que descarga SpaghettiKart y comprueba su SHA-256.

## 11. Instalación (fase 5)

- **Plan antes de actuar.** `install::plan` describe qué se va a hacer (extraer, copiar, abrir un instalador o extracción manual), dónde y qué pedirá el juego. La interfaz lo enseña y solo instala al pulsar «Instalar».
- **Método según el archivo.** ZIP: extracción segura (rutas dentro de la carpeta, sin enlaces simbólicos, límites de tamaño y número de archivos; se quita la carpeta raíz común). EXE portable: se copia. Instalador (setup/installer, .msi): no se abre hasta que el usuario lo confirma, y después elige el ejecutable instalado. 7z/RAR: extracción manual.
- **ZIP automático (1.1).** Cuando termina la descarga de un ZIP (con el SHA-256 ya comprobado) de un proyecto que no está instalado, se extrae enseguida en la carpeta de juegos y, si la extracción sale bien, se borran el ZIP y su entrada en Descargas. Si la extracción falla (ruta peligrosa, archivo dañado, carpeta no vacía), el ZIP se queda y sigue disponible «Instalar…». Si falla la descarga de un archivo que no es ZIP (.exe, instalador), se pone en cola el mejor ZIP de Windows de la misma release oficial. No se ejecuta nada.
- **Ejecutable.** Se buscan los .exe (sin desinstaladores, actualizadores ni gestores de errores). Si hay uno solo en el nivel más alto, se elige; si no, el usuario escoge. Siempre se puede cambiar.
- **Adaptadores revisados** (`catalog/adapters/*.json`, unidos al catálogo por repositorio). JSON declarativo: `firstRun` (qué pedirá el juego al abrirlo), `userFiles` (reglas para comprobar ROM, ISO o volcado: extensión, cabecera, tamaño y SHA-1 solo si el proyecto lo publica), `exeHint` (si se conoce) y `preserve` (fase 6). Primeros siete: Ship of Harkinian, 2 Ship 2 Harkinian, Zelda64Recomp, Starship, SpaghettiKart, sm64coopdx y Unleashed Recompiled. Revisados con la documentación pública; aún sin probar con el juego.
- **Game File Validator.** Comprueba el archivo del usuario sin copiarlo ni modificarlo y guarda solo la ruta. No obtiene claves ni extrae nada protegido.
- **Ejecutar y desinstalar.** Ejecutar solo lanza el ejecutable elegido (dentro de la carpeta del juego, salvo instaladores externos). Desinstalar borra únicamente carpetas dentro de la carpeta de juegos, tras confirmar, y avisa de que se pierden las partidas que el juego guarde dentro.
- **Carpeta de juegos.** `Documentos\NATIVE HUB` por defecto; se cambia en Ajustes.
- **Pruebas.** Siete con archivos ZIP generados (método, extracción, ruta maliciosa, instalar/ejecutar/desinstalar, instalador externo, ROM de N64, adaptador en el plan) y una real (`--ignored`) que descarga e instala SpaghettiKart.

## 12. Fase 6.1: animación de inicio y cargas visibles

- **Inicio.** Animación de ~2,3 s: se traza la N, aparece el punto lima, el nombre y una línea de carga. Cubre la carga del catálogo y se salta con un clic o una tecla. Suena un acorde corto generado con Web Audio (sin archivos de audio de terceros), que se desactiva en Ajustes › Música de inicio. WebView2 arranca con `--autoplay-policy=no-user-gesture-required` para poder reproducirlo.
- **Cargas visibles.** `useTask()` muestra un panel con pasos y barra para instalar, desinstalar, borrar descargas, aprobar o descartar candidatos, comprobar releases, comprobar archivos, cambiar el ejecutable y guardar el token. La acción real se ejecuta a la vez; el panel garantiza una duración mínima (1–3 s según la acción) y, si falla, enseña el error.
- **Accesibilidad.** Con «reducir movimiento» de Windows la animación es estática y las duraciones mínimas bajan a ~0,4 s.

## 13. Actualizaciones de lo instalado (fase 6)

- **Update Manager** (`crates/core/src/update.rs`). Se descarga la versión nueva (la recomendada de la última release o la que elijas), se extrae aparte (`<carpeta de juegos>\.native-hub\staging`) y se compara con la instalación. La interfaz enseña cuántos archivos se reemplazan, cuántos son nuevos y cuáles se conservan, y solo aplica al pulsar «Aplicar».
- **Qué se conserva.** Nada se borra: lo que solo está en tu carpeta (partidas, capturas, mods) se queda. Un archivo que también viene en la versión nueva se conserva si el adaptador lo protege (`preserve`) o si es de partidas o configuración (`*.sav`, `save/`, `saves/`, `mods/`, `*.ini`, `*.cfg`, `*.json`, `*.toml`, `*.xml`…) y cambió después de instalar.
- **Seguridad.** Antes de reemplazar se copia cada archivo afectado a `.native-hub\backups`. Si algo falla a mitad, se restaura todo. Tras actualizar, «Deshacer la actualización» vuelve a la versión anterior (se guarda una copia por juego).
- **Formatos.** ZIP y EXE portable. Los instaladores y 7z/RAR se actualizan a mano.
- **Pruebas.** Cuatro con archivos generados (patrones, conservar partida y configuración, deshacer, protección del adaptador, sin descarga) y una real (`--ignored`) que instala Starship v1.0.0, guarda una partida, actualiza a v2.0.0 y lo deshace.

## 14. Expansión del catálogo y automatización (fase 7)

- **Sincronizar con Recompendium** (`crates/core/src/sync.rs`). La app lee la lista de fichas del repositorio de datos de Recompendium (`github.com/Nio03/unricopie`, CC BY-SA 4.0) con la API de GitHub y descarga de `raw.githubusercontent.com` solo las que aún no conoce, hasta 300 por pasada (el resto queda para la siguiente). Cada ficha nueva entra en la **cola de revisión** con juego, consola, tipo y estado ya sugeridos a partir de sus datos; no pasa al catálogo hasta aprobarla.
- **Aprobar.** En la cola de revisión se aprueba en un clic o en bloque por fuente. Tras aprobar se comprueban las releases de lo aprobado. Lo aprobado es de origen `local` y sobrevive a las reimportaciones del catálogo.
- **Escáner en GitLab.** Búsquedas en la API oficial (`gitlab.com/api/v4/projects`, «recomp», «pc port»…) que también van a la cola. Se descarta lo que ya está en el catálogo o en la cola (comparando la URL sin distinguir mayúsculas).
- **Automatización.** Un hilo en segundo plano mira cada 15 minutos (el primero, un minuto después de arrancar) si toca: comprobar releases (lotes de 1.500 con token o 50 sin él) o buscar proyectos nuevos (GitHub, GitLab y Recompendium). Cada tarea se configura en Ajustes como «cada 6 h», «cada 24 h» (por defecto) o «desactivada», y nunca arranca si ya hay otra en marcha.
- **Base de datos.** Migración v4: `scan_candidates` gana `source` (`github-search`, `gitlab-search`, `recompendium`) y `suggestion` (JSON con los datos sugeridos).
- **Pruebas.** `crates/core/tests/sync.rs` con transporte falso (fichas nuevas y ya conocidas, sugerencias, aprobación individual y en bloque, GitLab) y pruebas reales (`--ignored`) en `tests/network.rs`.

## 15. Idiomas y versión portable (0.2.1)

- **Idioma de la interfaz.** Inglés por defecto y español en Ajustes › Idioma (`src/lib/i18n.ts`; la elección se guarda en el WebView y la ventana se recarga). Los textos se escriben en línea como `tr('español', 'English')`.
- **Mensajes del núcleo.** Errores, planes de instalación y progreso siguen el idioma de la interfaz: la interfaz llama a `set_language` al arrancar y el núcleo usa `t!(es, en, …)` / `tr(es, en)` (`crates/core/src/i18n.rs`).
- **Textos del catálogo.** Recompendium publica descripciones y requisitos en español e inglés: el catálogo guarda ambos (`summary`/`summaryEn`, `requirementsText`/`requirementsTextEn`). La lista manual y los adaptadores también llevan textos en inglés.
- **Versión portable.** Si junto al ejecutable hay un archivo llamado `portable` (o `portable.txt`), la base de datos, las descargas y el perfil de WebView van a `data\` y los juegos a `Games\` a su lado. La ventana se crea al arrancar (no desde `tauri.conf.json`) para poder fijar su carpeta de datos. El token opcional de GitHub sigue en el Administrador de credenciales del usuario de Windows.

## 16. Actualizaciones de la propia app (0.3.0)

- **Plugin.** Updater oficial de Tauri (`tauri-plugin-updater`) y `tauri-plugin-process` para reiniciar. Endpoint: `https://github.com/Edunknown/native-hub/releases/latest/download/latest.json`.
- **Firma.** Cada instalador se firma con la clave del updater (minisign). La pública está en `tauri.conf.json`; la privada vive fuera del repo (`%USERPROFILE%\.native-hub-keys\updater.key`) y hay que respaldarla: sin ella no se puede publicar ninguna actualización para las instalaciones existentes.
- **Flujo.** Ocho segundos después de arrancar, la app consulta `latest.json`. Si hay una versión nueva, una barra bajo la cabecera ofrece «Actualizar y reiniciar», «Novedades» y «Ahora no» (que oculta esa versión hasta la próxima comprobación manual). Nada se descarga sin confirmar. El instalador NSIS se ejecuta en modo pasivo y la app se reinicia. Ajustes › Versión de NATIVE HUB muestra la versión y una comprobación manual.
- **Portable.** `is_portable` indica a la interfaz que está en modo portable: solo avisa de la versión nueva y abre su página de la release.

## 17. Camino a la 1.0

### Catálogo servido desde GitHub

- **Qué.** La app trae el catálogo con el que se compiló y además descarga el último publicado en el repositorio (`catalog/catalog.json` en `main`, desde `raw.githubusercontent.com`), así los proyectos nuevos, las correcciones y los adaptadores llegan sin sacar una versión nueva de la app (`crates/core/src/remote.rs`).
- **Cuándo.** Cada día por defecto (Ajustes › Automatización › «Actualizar el catálogo desde GitHub»: cada 6 h, cada día o nunca) y a mano en Ajustes › Catálogo. La petición lleva el ETag: si no cambió, es un 304.
- **Seguridad.** Solo HTTPS desde `raw.githubusercontent.com`. Se valida antes de importar (al menos 100 proyectos y una décima parte instalables, juegos y plataformas coherentes, slugs únicos, repositorios HTTPS, fecha no futura) y solo se importa si es **más nuevo** que el cargado; el catálogo incluido en el ejecutable nunca pisa uno descargado más reciente. Los datos en vivo de releases y los del usuario se conservan, como en cualquier importación. Las descargas mantienen sus comprobaciones (hosts permitidos, URL dentro del repositorio del proyecto).
- **Formato.** `catalog.json` lleva `schema` (ahora 1). Cada versión de la app solo lee los esquemas que conoce; uno más nuevo espera a que se actualice la app.
- **Pruebas.** `crates/core/tests/remote_catalog.rs`: más nuevo, igual (ETag/304), más antiguo, esquema nuevo, catálogos rotos y el catálogo real pasando la validación.

### Licencia e integración continua

- Código bajo MIT (`LICENSE`); `catalog/` mantiene CC BY-SA 4.0.
- `.github/workflows/ci.yml` en cada push y PR; `.github/workflows/release.yml` genera una release borrador a partir de un tag (ver el README).

### Errores claros y registro copiable

- **Registro.** `native-hub.log` en `%LOCALAPPDATA%\dev.nativehub.app\logs` (`data\logs` en la portable), también en las versiones publicadas: arranque, descargas, instalaciones, actualizaciones, lanzamientos, comprobaciones del catálogo, pánicos y cada comando que falló en la interfaz. Hasta 1 MB, con dos archivos rotados.
- **Errores.** `ErrorNote` enseña una explicación sencilla y qué hacer (sin conexión, límite de GitHub, disco lleno, archivo en uso, acceso denegado, falta un archivo, SHA-256 distinto, antivirus, host no permitido, catálogo no válido; `src/lib/errors.ts`), después el mensaje original, «Copiar detalles» y «Abrir el registro».
- **Copiar detalles** (y Ajustes › Registro › «Copiar el registro») copia versión, sistema, tipo de instalación, versión del catálogo, el error y los últimos 64 KB del registro. La carpeta del usuario se sustituye por `~`.
- **Pruebas.** `src/lib/errors.test.ts` (Vitest, `npm run test:web`, también en CI).

### Búsqueda y filtros

- **Una consulta para las dos vistas.** `query::discover` recibe el texto, la disponibilidad, la consola o la familia de consolas, el tipo, el estado de desarrollo, «ocultar abandonados y retirados» y el orden (relevancia, título, última release, más nuevos, más populares). Descubrir lo enseña como tabla; Búsqueda (el texto de la cabecera), como lista editorial con los mismos filtros.
- **Los filtros se mantienen** mientras la ventana está abierta (sessionStorage; sin él no se rompe nada). Búsqueda empieza con todos los proyectos (los instalables primero); Descubrir, con los instalables.
- **Diseño.** Etiquetas y desplegables subrayados en una línea, sin cajas; el lima solo para la disponibilidad activa.
- **Seguridad.** El texto y los valores van como parámetros SQL; los estados se comprueban contra una lista cerrada.
- **Pruebas.** `query::tests::descubrir_con_texto_familia_estado_y_orden` y `src/lib/discover.test.ts` (el backend del navegador replica la consulta de Rust).

### Primer arranque guiado

- Se enseña una vez por instalación tras la animación de inicio (`onboarding_done` en SQLite, así la portable tiene el suyo). Cinco pasos a ventana completa, sin tarjetas: idioma y tema; qué hace y qué no hace NATIVE HUB (fuentes oficiales, sin ROMs/ISOs/BIOS/claves, plan antes de instalar, solo es instalable lo que tiene ejecutable Windows); carpeta de juegos; comprobaciones automáticas; y un resumen con los instalables. «Saltar» en cada paso; Ajustes › Guía de bienvenida la enseña otra vez.

### Pruebas de adaptadores

- **Automática (instalación).** `crates/core/tests/adapters.rs` descarga la última release oficial para Windows de cada adaptador revisado con el Download Manager real, la instala con el Installation Manager real en una carpeta temporal y comprueba que encuentra el ejecutable. `.github/workflows/adapters.yml` la pasa en Windows en los PR que tocan adaptadores o el código de instalación/descarga, cada lunes y a mano. Nunca abre un juego ni usa archivos del juego.
- **Por una persona (jugado).** Abrir el juego con tus archivos no se puede automatizar (hace falta la ROM/ISO del usuario). Quien lo pruebe añade una entrada con `status: "played"`, versión, fecha, `by` y `os` (`win10`/`win11`).
- **Se guarda en el adaptador.** `tested: [{status, version, date, by, os?, notes?, notesEn?}]`, con estado `install`, `played` o `issues`. La ficha enseña la más relevante («Prueba de NATIVE HUB») y rellena «Windows 10 / 11» con las entradas `played`.
- **Adaptadores nuevos:** DevilutionX (Diablo) y gen1recomp (Pokémon), revisados con su documentación. `when: "manual"` marca archivos que el juego no pide y que copia el usuario (NATIVE HUB nunca copia archivos del juego).
- `node scripts/apply-adapters.mjs` copia los adaptadores a `catalog.json` sin regenerarlo entero; la comprobación del catálogo falla si no coinciden.

## 18. Estado real de cada función

| Función | Estado |
|---|---|
| Interfaz principal, navegación, tema claro/oscuro, ficha con selector | Hecho (fase 1) |
| Catálogo de ≈1.550 proyectos con releases comprobadas en GitHub | Hecho (fase 2) |
| Base de datos SQLite con migraciones, importación y consultas | Hecho (fase 2), con pruebas en `crates/core` |
| Clasificación por consolas y familias | Hecho (fase 2) |
| Comprobación de releases en vivo (GitHub, GitLab, Codeberg) con ETag y control de cuota | Hecho (fase 3) |
| Escáner de GitHub y cola de revisión con aprobación manual | Hecho (fase 3) |
| Token de GitHub opcional en el Administrador de credenciales | Hecho (fase 3) |
| Escáner en GitLab | Hecho (fase 7) |
| Sincronización con Recompendium desde la app, aprobación en un clic o en bloque | Hecho (fase 7) |
| Comprobación de releases y búsqueda automáticas (6 h / 24 h / desactivada) | Hecho (fase 7) |
| Descargas oficiales reanudables con SHA-256 | Hecho (fase 4) |
| Instalación con plan, adaptadores declarativos y validación de archivos del usuario | Hecho (fase 5) |
| Biblioteca: ejecutar, cambiar ejecutable, abrir carpeta, desinstalar | Hecho (fase 5) |
| Animación de inicio con música y paneles de progreso | Hecho (fase 6.1) |
| Actualizar instalaciones conservando partidas y configuración, con deshacer | Hecho (fase 6) |
| Interfaz en inglés (español disponible) y versión portable | Hecho (0.2.1) |
| Actualizaciones firmadas de la propia app | Hecho (0.3.0) |
| Catálogo servido desde GitHub, importado solo si es más nuevo | Hecho (1.0) |
| Registro, errores explicados y «Copiar detalles» | Hecho (1.0) |
| Búsqueda y filtros (consola, familia, tipo, estado, inactivos, orden) | Hecho (1.0) |
| Primer arranque guiado | Hecho (1.0) |
| Pruebas automáticas de instalación de adaptadores; estado probado en la ficha | Hecho (1.0) |
| Adaptadores jugados con archivos reales del juego | Pendiente: requiere a alguien con los archivos del juego |
