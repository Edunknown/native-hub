import { useCatalog } from '../app/catalog'
import type { Theme } from '../app/theme'
import { isTauri, openExternal } from '../lib/api'
import { fmtDateTime } from '../lib/format'

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
          <dt>Carpeta de instalación</dt>
          <dd><span className="tbd">Se podrá elegir en la fase 5</span></dd>
        </div>
        <div>
          <dt>Token de GitHub</dt>
          <dd><span className="muted">Opcional, para superar el límite de 60 consultas por hora. </span><span className="tbd">No implementado (fase 3)</span></dd>
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
