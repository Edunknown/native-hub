import { CatalogProvider } from './app/catalog'
import { LiveProvider } from './app/live'
import { NavProvider, useNav } from './app/nav'
import { Shell } from './app/Shell'
import { useTheme } from './app/theme'
import { Consoles } from './views/Consoles'
import { Discover } from './views/Discover'
import { GameView } from './views/GameView'
import { Home } from './views/Home'
import { Downloads, Library } from './views/Placeholders'
import { Updates } from './views/Updates'
import { Search } from './views/Search'
import { Settings } from './views/Settings'

function Router({ theme, setTheme }: ReturnType<typeof useTheme>) {
  const { view } = useNav()
  switch (view.name) {
    case 'home': return <Home />
    case 'library': return <Library />
    case 'discover': return <Discover />
    case 'consoles': return <Consoles platform={view.platform} />
    case 'updates': return <Updates />
    case 'downloads': return <Downloads />
    case 'settings': return <Settings theme={theme} setTheme={setTheme} />
    case 'game': return <GameView slug={view.slug} project={view.project} />
    case 'search': return <Search query={view.query} />
  }
}

export default function App() {
  const t = useTheme()
  return (
    <CatalogProvider>
      <LiveProvider>
      <NavProvider>
        <Shell theme={t.theme} onToggleTheme={t.toggle}>
          <Router {...t} />
        </Shell>
      </NavProvider>
      </LiveProvider>
    </CatalogProvider>
  )
}
