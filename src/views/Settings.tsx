import type { Theme } from '../app/theme'
import { isTauri } from '../lib/api'

export function Settings({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
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
          <dt>Entorno</dt>
          <dd className="mono">{isTauri ? 'Aplicación de escritorio (Tauri)' : 'Navegador (vista de desarrollo)'}</dd>
        </div>
      </dl>
    </main>
  )
}
