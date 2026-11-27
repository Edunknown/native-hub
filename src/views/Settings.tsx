import { useEffect, useState } from 'react'
import { useCatalog } from '../app/catalog'
import { useLive } from '../app/live'
import { useTask } from '../app/task'
import { playStartupChime, setStartupSound, startupSoundEnabled } from '../app/sound'

import type { Theme } from '../app/theme'
import { api, isTauri, openExternal, pickPath } from '../lib/api'
import { fmtDateTime } from '../lib/format'

const AUTO: { id: string; label: string }[] = [{ id: 'off', label: 'Nunca' }, { id: '6h', label: 'Cada 6 h' }, { id: '24h', label: 'Cada día' }]

function AutomationSetting() {
  const [a, setA] = useState<{ releases: string; discover: string; lastScan: string | null; lastAutoRefresh: string | null } | null>(null)
  useEffect(() => { if (isTauri) api.automation().then(setA, () => {}) }, [])
  if (!isTauri) return <span className="tbd">Solo en la app de escritorio</span>
  if (!a) return null
  const set = (releases: string, discover: string) => api.setAutomation(releases, discover).then(setA)
  return (
    <>
      <p className="muted">Comprobar versiones nuevas</p>
      <span className="seg">{AUTO.map((o) => <button key={o.id} type="button" aria-pressed={a.releases === o.id} onClick={() => set(o.id, a.discover)}>{o.label}</button>)}</span>
      <p className="muted" style={{ marginTop: 12 }}>Buscar proyectos nuevos (GitHub, GitLab y Recompendium)</p>
      <span className="seg">{AUTO.map((o) => <button key={o.id} type="button" aria-pressed={a.discover === o.id} onClick={() => set(a.releases, o.id)}>{o.label}</button>)}</span>
      <p className="note-line">Funciona mientras NATIVE HUB está abierto. Lo encontrado va a la cola de revisión; nada se descarga ni se instala solo.
        {a.lastAutoRefresh && <> Última comprobación automática: {fmtDateTime(a.lastAutoRefresh)}.</>}
        {a.lastScan && <> Última búsqueda: {fmtDateTime(a.lastScan)}.</>}</p>
    </>
  )
}

function SoundSetting() {
  const [on, setOn] = useState(startupSoundEnabled())
  const set = (v: boolean) => { setStartupSound(v); setOn(v); if (v) playStartupChime() }
  return (
    <>
      <span className="seg">
        <button type="button" aria-pressed={on} onClick={() => set(true)}>Activada</button>
        <button type="button" aria-pressed={!on} onClick={() => set(false)}>Desactivada</button>
      </span>
      <p className="note-line">Un acorde corto al abrir NATIVE HUB, generado por la propia app.</p>
    </>
  )
}

function InstallRootSetting() {
  const [root, setRoot] = useState<{ path: string; default: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.installRoot().then(setRoot, () => {}) }, [])
  if (!isTauri) return <span className="tbd">Solo en la app de escritorio</span>
  const change = async () => {
    setErr(null)
    const p = await pickPath({ directory: true, title: 'Carpeta de juegos', defaultPath: root?.path })
    if (p) api.setInstallRoot(p).then(setRoot, (e) => setErr(String(e)))
  }
  return (
    <>
      <p><span className="mono">{root?.path}</span>{root?.default && <span className="muted"> (por defecto)</span>}</p>
      <div className="actions">
        <button type="button" className="btn-line" onClick={change}>Cambiar…</button>
        {root && !root.default && <button type="button" className="link" onClick={() => api.setInstallRoot(null).then(setRoot)}>Volver a la carpeta por defecto</button>}
      </div>
      <p className="note-line">Cada juego se instala en su propia subcarpeta. Cambiarla no mueve lo que ya está instalado.</p>
      {err && <p className="note-line err">{err}</p>}
    </>
  )
}

function TokenSetting() {
  const live = useLive()
  const task = useTask()
  const [value, setValue] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (live.status?.unsupported) return <span className="tbd">Solo en la app de escritorio</span>
  const save = async () => {
    setBusy(true); setMsg(null)
    try { await task({ title: 'Guardando el token de GitHub', steps: ['Comprobando el token con GitHub', 'Guardándolo en el Administrador de credenciales'], minMs: 1800, done: 'Token guardado' }, () => api.setGithubToken(value)); setValue(''); setMsg('Token guardado en el Administrador de credenciales de Windows.'); live.reload() }
    catch (e) { setMsg(String(e)) } finally { setBusy(false) }
  }
  const clear = async () => { await api.clearGithubToken(); setMsg('Token eliminado.'); live.reload() }
  return (
    <>
      {live.status?.tokenConfigured ? (
        <p><span className="yes">Configurado</span> <button type="button" className="link" onClick={clear}>Quitar</button></p>
      ) : (
        <div className="token">
          <input type="password" autoComplete="off" spellCheck={false} placeholder="ghp_… o github_pat_…" value={value} onChange={(e) => setValue(e.target.value)} />
          <button type="button" className="btn-line" disabled={busy || !value.trim()} onClick={save}>{busy ? 'Comprobando…' : 'Guardar'}</button>
        </div>
      )}
      <p className="note-line">Opcional. Sin token, GitHub permite 60 consultas por hora; con uno, 5.000. Basta un token sin permisos (solo lectura de repositorios públicos). Se guarda en el Administrador de credenciales de Windows, nunca en archivos.</p>
      {msg && <p className="note-line">{msg}</p>}
    </>
  )
}

export function Settings({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const { summary } = useCatalog()
  return (
    <main className="content tight">
      <div>
        <div className="eyebrow">Ajustes</div>
        <h1 className="page-title">Ajustes</h1>
      </div>
      <dl className="settings">
        <div>
          <dt>Tema</dt>
          <dd>
            <span className="seg">
              <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Oscuro</button>
              <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Claro</button>
            </span>
          </dd>
        </div>
        <div>
          <dt>Automatización</dt>
          <dd><AutomationSetting /></dd>
        </div>
        <div>
          <dt>Música de inicio</dt>
          <dd><SoundSetting /></dd>
        </div>
        <div>
          <dt>Carpeta de juegos</dt>
          <dd><InstallRootSetting /></dd>
        </div>
        <div>
          <dt>Token de GitHub</dt>
          <dd><TokenSetting /></dd>
        </div>
        <div>
          <dt>Catálogo</dt>
          <dd className="num">Versión del {fmtDateTime(summary.generatedAt) ?? '—'}{summary.schemaVersion != null && <span className="muted"> · base de datos v{summary.schemaVersion}</span>}</dd>
        </div>
        <div>
          <dt>Fuentes</dt>
          <dd>
            {(summary.sources ?? []).map((s) => (
              <p key={s.name} className="source">
                {s.url ? <a className="link" onClick={() => openExternal(s.url!)}>{s.name}</a> : s.name}
                {s.license && <span className="muted"> · datos bajo licencia {s.license}</span>}
                {s.commit && <span className="mono muted"> · {s.commit.slice(0, 7)}</span>}
              </p>
            ))}
            <p className="note-line">Las descripciones y requisitos importados de Recompendium se muestran con su atribución y su licencia (CC BY-SA 4.0).</p>
          </dd>
        </div>
        <div>
          <dt>Entorno</dt>
          <dd className="mono">{isTauri ? 'Aplicación de escritorio (Tauri + SQLite)' : 'Navegador (vista de desarrollo)'}</dd>
        </div>
      </dl>
    </main>
  )
}
