// First-run guide: language and theme, what NATIVE HUB does and does not do, where games
// go, and how it stays up to date. Shown once per install (stored in SQLite); it can be
// skipped at any step and shown again from Settings.

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fmtNum } from '../lib/format'
import { lang, setLang, tr } from '../lib/i18n'
import { AutomationSetting, InstallRootSetting } from '../views/Settings'
import { useCatalog } from './catalog'
import { Mark } from './icons'
import { useNav } from './nav'
import type { Theme } from './theme'

const PRINCIPLES = [
  {
    title: tr('Proyectos de la comunidad, desde su fuente oficial', 'Community projects, from their official source'),
    text: tr('Cada recompilación o port es de sus autores. NATIVE HUB solo descarga la release oficial de su repositorio, por HTTPS y comprobando el SHA-256 cuando se publica.', 'Each recompilation or port belongs to its authors. NATIVE HUB only downloads the official release from its repository, over HTTPS, checking the SHA-256 when it is published.'),
  },
  {
    title: tr('Tus juegos los pones tú', 'You bring your own game files'),
    text: tr('NATIVE HUB no incluye ni descarga ROMs, ISOs, BIOS, firmware ni claves. Si un proyecto necesita archivos del juego original, se los das tú, a partir de tu propia copia.', 'NATIVE HUB does not include or download ROMs, ISOs, BIOS, firmware or keys. If a project needs files from the original game, you provide them from your own copy.'),
  },
  {
    title: tr('Nada se instala sin que lo veas', 'Nothing is installed without you seeing it'),
    text: tr('Antes de instalar o actualizar te enseña el plan. Los instaladores externos solo se abren cuando lo confirmas, y las actualizaciones guardan una copia para deshacerlas.', 'Before installing or updating it shows you the plan. External installers only open when you confirm, and updates keep a backup so they can be undone.'),
  },
  {
    title: tr('Solo es instalable lo que tiene ejecutable para Windows', 'Only projects with a Windows executable can be installed'),
    text: tr('El resto del catálogo está en «En desarrollo»: puedes consultarlo, pero no se instala hasta que su release publica un ejecutable.', 'The rest of the catalog is "In development": you can look at it, but it is not installable until its release publishes an executable.'),
  },
]

export function Welcome({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const { summary } = useCatalog()
  const { go } = useNav()

  useEffect(() => {
    api.onboardingDone().then((done) => setOpen(!done), () => {})
    const again = () => { setStep(0); setOpen(true) }
    window.addEventListener('nh-show-welcome', again)
    return () => window.removeEventListener('nh-show-welcome', again)
  }, [])

  if (!open) return null
  const finish = (to?: 'discover' | 'home') => {
    api.setOnboarding(true).catch(() => {})
    setOpen(false)
    if (to) go({ name: to })
  }
  const steps = [
    {
      eyebrow: tr('Bienvenida', 'Welcome'),
      title: tr('Te damos la bienvenida a NATIVE HUB', 'Welcome to NATIVE HUB'),
      lede: tr('Un lanzador para descubrir, instalar, actualizar y abrir recompilaciones y ports nativos de juegos para PC. No es un emulador ni una tienda.', 'A launcher to discover, install, update and open native PC recompilations and ports of games. It is not an emulator or a store.'),
      body: (
        <dl className="welcome-prefs">
          <dt>{tr('Idioma', 'Language')}</dt>
          <dd>
            <span className="seg">
              <button type="button" aria-pressed={lang === 'en'} onClick={() => lang !== 'en' && setLang('en')}>English</button>
              <button type="button" aria-pressed={lang === 'es'} onClick={() => lang !== 'es' && setLang('es')}>Español</button>
            </span>
          </dd>
          <dt>{tr('Tema', 'Theme')}</dt>
          <dd>
            <span className="seg">
              <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{tr('Oscuro', 'Dark')}</button>
              <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{tr('Claro', 'Light')}</button>
            </span>
          </dd>
        </dl>
      ),
    },
    {
      eyebrow: tr('Cómo funciona', 'How it works'),
      title: tr('Cuatro cosas antes de empezar', 'Four things before you start'),
      body: (
        <ol className="welcome-list">
          {PRINCIPLES.map((p) => <li key={p.title}><strong>{p.title}</strong><p className="muted">{p.text}</p></li>)}
        </ol>
      ),
    },
    {
      eyebrow: tr('Carpeta de juegos', 'Games folder'),
      title: tr('¿Dónde se instalan los juegos?', 'Where should games be installed?'),
      lede: tr('Cada juego va en su propia subcarpeta. Puedes cambiarla ahora o más tarde en Ajustes.', 'Each game goes in its own subfolder. You can change it now or later in Settings.'),
      body: <div className="welcome-setting"><InstallRootSetting /></div>,
    },
    {
      eyebrow: tr('Al día', 'Up to date'),
      title: tr('Comprobaciones automáticas', 'Automatic checks'),
      lede: tr('Mientras NATIVE HUB está abierto puede buscar versiones nuevas de tus juegos, catálogos nuevos y proyectos nuevos. Lo que encuentra se te enseña; nada se descarga ni se instala solo. Un token de GitHub (opcional, en Ajustes) permite muchas más consultas por hora.', 'While NATIVE HUB is open it can look for new versions of your games, new catalogs and new projects. What it finds is shown to you; nothing is downloaded or installed on its own. A GitHub token (optional, in Settings) allows many more requests per hour.'),
      body: <div className="welcome-setting"><AutomationSetting /></div>,
    },
    {
      eyebrow: tr('Listo', 'Ready'),
      title: tr('Todo preparado', 'All set'),
      lede: `${fmtNum(summary.installableCount)} ${tr('proyectos se pueden instalar ahora mismo, de', 'projects can be installed right now, out of')} ${fmtNum(summary.projectCount)} ${tr('en el catálogo. Busca un juego arriba o empieza por los instalables.', 'in the catalog. Search for a game at the top or start with the installable ones.')}`,
      body: null,
    },
  ]
  const s = steps[step]
  const last = step === steps.length - 1

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <header className="welcome-top">
        <span className="welcome-brand"><Mark className="welcome-mark" /> NATIVE <span>HUB</span></span>
        {!last && <button type="button" className="link" onClick={() => finish()}>{tr('Saltar', 'Skip')}</button>}
      </header>
      <main className="welcome-main">
        <div className="eyebrow"><span className="mono">{step + 1} / {steps.length}</span> · {s.eyebrow}</div>
        <h1 id="welcome-title" className="page-title">{s.title}</h1>
        {s.lede && <p className="page-lede">{s.lede}</p>}
        {s.body}
        <div className="actions welcome-actions">
          {last ? (
            <>
              <button type="button" className="btn-primary" onClick={() => finish('discover')}>{tr('Ver los instalables', 'Browse installable games')}</button>
              <button type="button" className="link" onClick={() => finish('home')}>{tr('Ir al inicio', 'Go to Home')}</button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={() => setStep(step + 1)}>{tr('Continuar', 'Continue')}</button>
          )}
          {step > 0 && <button type="button" className="link" onClick={() => setStep(step - 1)}>{tr('Atrás', 'Back')}</button>}
        </div>
      </main>
    </div>
  )
}

/** Opens the welcome guide again (Settings). */
export function showWelcome() {
  window.dispatchEvent(new Event('nh-show-welcome'))
}
