import { useEffect, useState } from 'react'
import { useCatalog } from '../app/catalog'
import { useLive } from '../app/live'
import { useTask } from '../app/task'
import { AppUpdateSetting } from '../app/appUpdate'
import { showWelcome } from '../app/Welcome'
import { playStartupChime, setStartupSound, startupSoundEnabled } from '../app/sound'

import type { Theme } from '../app/theme'
import { api, copyReport, isTauri, openExternal, pickPath } from '../lib/api'
import type { Automation, CatalogStatus } from '../lib/types'
import { fmtDateTime, fmtSize } from '../lib/format'
import { lang, setLang, tr } from '../lib/i18n'
import { ErrorNote } from '../components/ErrorNote'

function CoverCacheSetting() {
  const [size, setSize] = useState<number | null>(null)
  useEffect(() => { if (isTauri) api.coversCacheSize().then(setSize, () => {}) }, [])
  if (!isTauri) return <span className="tbd">{tr('Solo en la app de escritorio', 'Desktop app only')}</span>
  return (
    <>
      <span className="num">{size == null ? '—' : size === 0 ? tr('Vacía', 'Empty') : fmtSize(size)}</span>
      {size ? <> <button type="button" className="link" onClick={() => api.coversClearCache().then(() => setSize(0))}>{tr('Vaciar', 'Clear')}</button></> : null}
      <p className="note-line">{tr('Las portadas se descargan una vez de images.igdb.com y se guardan aquí para verlas sin conexión.', 'Covers are downloaded once from images.igdb.com and kept here so they show offline.')}</p>
    </>
  )
}

const AUTO: { id: string; label: string }[] = [{ id: 'off', label: tr('Nunca', 'Never') }, { id: '6h', label: tr('Cada 6 h', 'Every 6 h') }, { id: '24h', label: tr('Cada día', 'Daily') }]

export function AutomationSetting() {
  const [a, setA] = useState<Automation | null>(null)
  useEffect(() => { if (isTauri) api.automation().then(setA, () => {}) }, [])
  if (!isTauri) return <span className="tbd">{tr('Solo en la app de escritorio', 'Desktop app only')}</span>
  if (!a) return null
  const set = (releases: string, discover: string, catalog = a.catalog) => api.setAutomation(releases, discover, catalog).then(setA)
  return (
    <>
      <p className="muted">{tr('Comprobar versiones nuevas', 'Check for new versions')}</p>
      <span className="seg">{AUTO.map((o) => <button key={o.id} type="button" aria-pressed={a.releases === o.id} onClick={() => set(o.id, a.discover)}>{o.label}</button>)}</span>
      <p className="muted" style={{ marginTop: 12 }}>{tr('Actualizar el catálogo desde GitHub', 'Update the catalog from GitHub')}</p>
      <span className="seg">{AUTO.map((o) => <button key={o.id} type="button" aria-pressed={a.catalog === o.id} onClick={() => set(a.releases, a.discover, o.id)}>{o.label}</button>)}</span>
      <p className="muted" style={{ marginTop: 12 }}>{tr('Buscar proyectos nuevos (GitHub, GitLab y Recompendium)', 'Find new projects (GitHub, GitLab and Recompendium)')}</p>
      <span className="seg">{AUTO.map((o) => <button key={o.id} type="button" aria-pressed={a.discover === o.id} onClick={() => set(a.releases, o.id)}>{o.label}</button>)}</span>
      <p className="note-line">{tr('Funciona mientras NATIVE HUB está abierto. Lo encontrado va a la cola de revisión; nada se descarga ni se instala solo.', 'Runs while NATIVE HUB is open. Findings go to the review queue; nothing is downloaded or installed on its own.')}
        {a.lastAutoRefresh && <> {tr('Última comprobación automática', 'Last automatic check')}: {fmtDateTime(a.lastAutoRefresh)}.</>}
        {a.lastScan && <> {tr('Última búsqueda', 'Last search')}: {fmtDateTime(a.lastScan)}.</>}</p>
    </>
  )
}

function CatalogSetting() {
  const { summary } = useCatalog()
  const live = useLive()
  const [st, setSt] = useState<CatalogStatus | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // Reload after any background job, including the catalog check itself.
  useEffect(() => { if (isTauri) api.automation().then((a) => setSt(a.catalogStatus), () => {}) }, [live.version])
  const running = live.progress?.job === 'catalog'
  const check = async () => {
    setMsg(null)
    try { if (!(await api.catalogRemoteCheck())) setMsg(tr('Hay otra tarea en marcha; inténtalo en un momento.', 'Another task is running; try again in a moment.')) }
    catch (e) { setMsg(String(e)) }
  }
  const result = live.lastFinished?.job === 'catalog' ? (live.lastFinished.result.catalog as { result: string } | undefined)?.result : undefined
  return (
    <>
      <p className="num">{tr('Versión del', 'Version of')} {fmtDateTime(summary.generatedAt) ?? '—'} · {summary.projectCount} {tr('proyectos', 'projects')}{summary.schemaVersion != null && <span className="muted">{tr(' · base de datos', ' · database')} v{summary.schemaVersion}</span>}</p>
      {isTauri && (
        <div className="actions">
          <button type="button" className="btn-line" disabled={running} onClick={check}>{running ? tr('Comprobando…', 'Checking…') : tr('Buscar catálogo nuevo', 'Check for a new catalog')}</button>
        </div>
      )}
      <p className="note-line">
        {tr('El catálogo se publica en el repositorio de NATIVE HUB en GitHub y se descarga solo cuando hay uno más nuevo, sin esperar a una versión nueva de la app.', 'The catalog is published in the NATIVE HUB repository on GitHub and is downloaded only when there is a newer one, without waiting for a new app version.')}
        {st?.checkedAt && <> {tr('Última comprobación', 'Last check')}: {fmtDateTime(st.checkedAt)}.</>}
      </p>
      {result === 'updated' && <p className="note-line yes">{tr('Catálogo actualizado.', 'Catalog updated.')}</p>}
      {result === 'upToDate' && <p className="note-line">{tr('Ya tienes el catálogo más reciente.', 'You already have the latest catalog.')}</p>}
      {result === 'needsAppUpdate' && <p className="note-line">{tr('Hay un catálogo nuevo que necesita una versión más reciente de NATIVE HUB.', 'There is a new catalog that needs a newer version of NATIVE HUB.')}</p>}
      {st?.error && <ErrorNote error={st.error} />}
      {msg && <ErrorNote error={msg} />}
    </>
  )
}

function LogSetting() {
  const [copied, setCopied] = useState<boolean | null>(null)
  if (!isTauri) return <span className="tbd">{tr('Solo en la app de escritorio', 'Desktop app only')}</span>
  return (
    <>
      <div className="actions">
        <button type="button" className="btn-line" onClick={async () => setCopied(await copyReport())}>{copied ? tr('Copiado', 'Copied') : tr('Copiar el registro', 'Copy the log')}</button>
        <button type="button" className="link" onClick={() => api.openLogFolder().catch(() => {})}>{tr('Abrir la carpeta', 'Open the folder')}</button>
      </div>
      <p className="note-line">{tr('Lo que hace NATIVE HUB (descargas, instalaciones, errores) queda en un archivo de registro. Si algo falla, copia el registro y pégalo al avisar del problema. Tu carpeta de usuario aparece como ~.', 'What NATIVE HUB does (downloads, installs, errors) is written to a log file. If something fails, copy the log and paste it when you report the problem. Your user folder shows as ~.')}</p>
      {copied === false && <p className="note-line err">{tr('No se pudo copiar al portapapeles.', 'Could not copy to the clipboard.')}</p>}
    </>
  )
}

function SoundSetting() {
  const [on, setOn] = useState(startupSoundEnabled())
  const set = (v: boolean) => { setStartupSound(v); setOn(v); if (v) playStartupChime() }
  return (
    <>
      <span className="seg">
        <button type="button" aria-pressed={on} onClick={() => set(true)}>{tr('Activada', 'On')}</button>
        <button type="button" aria-pressed={!on} onClick={() => set(false)}>{tr('Desactivada', 'Off')}</button>
      </span>
      <p className="note-line">{tr('Un acorde corto al abrir NATIVE HUB, generado por la propia app.', 'A short chord when NATIVE HUB opens, generated by the app itself.')}</p>
    </>
  )
}

export function InstallRootSetting() {
  const [root, setRoot] = useState<{ path: string; default: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.installRoot().then(setRoot, () => {}) }, [])
  if (!isTauri) return <span className="tbd">{tr('Solo en la app de escritorio', 'Desktop app only')}</span>
  const change = async () => {
    setErr(null)
    const p = await pickPath({ directory: true, title: tr('Carpeta de juegos', 'Games folder'), defaultPath: root?.path })
    if (p) api.setInstallRoot(p).then(setRoot, (e) => setErr(String(e)))
  }
  return (
    <>
      <p><span className="mono">{root?.path}</span>{root?.default && <span className="muted">{tr(' (por defecto)', ' (default)')}</span>}</p>
      <div className="actions">
        <button type="button" className="btn-line" onClick={change}>{tr('Cambiar…', 'Change…')}</button>
        {root && !root.default && <button type="button" className="link" onClick={() => api.setInstallRoot(null).then(setRoot)}>{tr('Volver a la carpeta por defecto', 'Back to the default folder')}</button>}
      </div>
      <p className="note-line">{tr('Cada juego se instala en su propia subcarpeta. Cambiarla no mueve lo que ya está instalado.', 'Each game is installed in its own subfolder. Changing it does not move what is already installed.')}</p>
      {err && <ErrorNote error={err} />}
    </>
  )
}

function TokenSetting() {
  const live = useLive()
  const task = useTask()
  const [value, setValue] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (live.status?.unsupported) return <span className="tbd">{tr('Solo en la app de escritorio', 'Desktop app only')}</span>
  const save = async () => {
    setBusy(true); setMsg(null)
    try { await task({ title: tr('Guardando el token de GitHub', 'Saving the GitHub token'), steps: [tr('Comprobando el token con GitHub', 'Checking the token with GitHub'), tr('Guardándolo en el Administrador de credenciales', 'Saving it to Credential Manager')], minMs: 1800, done: tr('Token guardado', 'Token saved') }, () => api.setGithubToken(value)); setValue(''); setMsg(tr('Token guardado en el Administrador de credenciales de Windows.', 'Token saved to Windows Credential Manager.')); live.reload() }
    catch (e) { setMsg(String(e)) } finally { setBusy(false) }
  }
  const clear = async () => { await api.clearGithubToken(); setMsg(tr('Token eliminado.', 'Token removed.')); live.reload() }
  return (
    <>
      {live.status?.tokenConfigured ? (
        <p><span className="yes">{tr('Configurado', 'Configured')}</span> <button type="button" className="link" onClick={clear}>{tr('Quitar', 'Remove')}</button></p>
      ) : (
        <div className="token">
          <input type="password" autoComplete="off" spellCheck={false} placeholder={tr('ghp_… o github_pat_…', 'ghp_… or github_pat_…')} value={value} onChange={(e) => setValue(e.target.value)} />
          <button type="button" className="btn-line" disabled={busy || !value.trim()} onClick={save}>{busy ? tr('Comprobando…', 'Checking…') : tr('Guardar', 'Save')}</button>
        </div>
      )}
      <p className="note-line">{tr('Opcional. Sin token, GitHub permite 60 consultas por hora; con uno, 5.000. Basta un token sin permisos (solo lectura de repositorios públicos). Se guarda en el Administrador de credenciales de Windows, nunca en archivos.', 'Optional. Without a token GitHub allows 60 requests per hour; with one, 5,000. A token with no scopes is enough (read-only access to public repositories). It is stored in Windows Credential Manager, never in files.')}</p>
      {msg && <p className="note-line">{msg}</p>}
    </>
  )
}

export function Settings({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const { summary } = useCatalog()
  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">{tr('Ajustes', 'Settings')}</div>
        <h1 className="page-title">{tr('Ajustes', 'Settings')}</h1>
      </div>
      <dl className="settings">
        <div>
          <dt>{tr('Tema', 'Theme')}</dt>
          <dd>
            <span className="seg">
              <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{tr('Oscuro', 'Dark')}</button>
              <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{tr('Claro', 'Light')}</button>
            </span>
          </dd>
        </div>
        <div>
          <dt>{tr('Automatización', 'Automation')}</dt>
          <dd><AutomationSetting /></dd>
        </div>
        <div>
          <dt>{tr('Versión de NATIVE HUB', 'NATIVE HUB version')}</dt>
          <dd><AppUpdateSetting /></dd>
        </div>
        <div>
          <dt>{tr('Idioma', 'Language')}</dt>
          <dd>
            <span className="seg">
              <button type="button" aria-pressed={lang === 'en'} onClick={() => lang !== 'en' && setLang('en')}>English</button>
              <button type="button" aria-pressed={lang === 'es'} onClick={() => lang !== 'es' && setLang('es')}>Español</button>
            </span>
            <p className="note-line">{tr('La ventana se recarga al cambiar de idioma.', 'The window reloads when you change the language.')}</p>
          </dd>
        </div>
        <div>
          <dt>{tr('Guía de bienvenida', 'Welcome guide')}</dt>
          <dd>
            <button type="button" className="link" onClick={showWelcome}>{tr('Ver otra vez la guía de bienvenida', 'Show the welcome guide again')}</button>
          </dd>
        </div>
        <div>
          <dt>{tr('Música de inicio', 'Startup music')}</dt>
          <dd><SoundSetting /></dd>
        </div>
        <div>
          <dt>{tr('Carpeta de juegos', 'Games folder')}</dt>
          <dd><InstallRootSetting /></dd>
        </div>
        <div>
          <dt>{tr('Caché de portadas', 'Cover cache')}</dt>
          <dd><CoverCacheSetting /></dd>
        </div>
        <div>
          <dt>{tr('Token de GitHub', 'GitHub token')}</dt>
          <dd><TokenSetting /></dd>
        </div>
        <div>
          <dt>{tr('Catálogo', 'Catalog')}</dt>
          <dd><CatalogSetting /></dd>
        </div>
        <div>
          <dt>{tr('Fuentes', 'Sources')}</dt>
          <dd>
            {(summary.sources ?? []).map((s) => (
              <p key={s.name} className="source">
                {s.url ? <a className="link" onClick={() => openExternal(s.url!)}>{s.name}</a> : s.name}
                {s.license && <span className="muted">{tr(' · datos bajo licencia', ' · data licensed under')} {s.license}</span>}
                {s.commit && <span className="mono muted"> · {s.commit.slice(0, 7)}</span>}
              </p>
            ))}
            <p className="note-line">{tr('Las descripciones y requisitos importados de Recompendium se muestran con su atribución y su licencia (CC BY-SA 4.0).', 'Descriptions and requirements imported from Recompendium are shown with their attribution and license (CC BY-SA 4.0).')}</p>
            <p className="note-line">{tr('Portadas de IGDB.com. Las imágenes pertenecen a sus editores y se descargan de images.igdb.com la primera vez que se muestran; después se guardan en la caché local.', 'Covers from IGDB.com. The images belong to their publishers and are downloaded from images.igdb.com the first time they are shown, then kept in the local cache.')}</p>
          </dd>
        </div>
        <div>
          <dt>{tr('Registro', 'Log')}</dt>
          <dd><LogSetting /></dd>
        </div>
        <div>
          <dt>{tr('Entorno', 'Environment')}</dt>
          <dd className="mono">{isTauri ? tr('Aplicación de escritorio (Tauri + SQLite)', 'Desktop app (Tauri + SQLite)') : tr('Navegador (vista de desarrollo)', 'Browser (development view)')}</dd>
        </div>
      </dl>
    </main>
  )
}
