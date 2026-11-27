import { useCallback, useState } from 'react'
import { CatalogProvider } from './app/catalog'
import { Splash } from './app/Splash'
import { TaskProvider } from './app/task'
import { AppUpdateProvider } from './app/appUpdate'
import { DownloadsProvider } from './app/downloads'
import { LibraryProvider } from './app/library'
import { LiveProvider } from './app/live'
import { NavProvider, useNav } from './app/nav'
import { Shell } from './app/Shell'
import { Welcome } from './app/Welcome'
import { useTheme } from './app/theme'
import { Consoles } from './views/Consoles'
import { Discover } from './views/Discover'
import { GameView } from './views/GameView'
import { Home } from './views/Home'
import { Downloads } from './views/Downloads'
import { Library } from './views/Library'
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
  const [ready, setReady] = useState(false)
  const [splash, setSplash] = useState(true)
  const onReady = useCallback(() => setReady(true), [])
  const onSplashDone = useCallback(() => setSplash(false), [])
  return (
    <>
    {splash && <Splash ready={ready} onDone={onSplashDone} />}
    <TaskProvider>
    <AppUpdateProvider>
    <CatalogProvider onReady={onReady}>
      <LiveProvider>
      <DownloadsProvider>
      <LibraryProvider>
      <NavProvider>
        <Shell theme={t.theme} onToggleTheme={t.toggle}>
          <Router {...t} />
        </Shell>
        <Welcome theme={t.theme} setTheme={t.setTheme} />
      </NavProvider>
      </LibraryProvider>
      </DownloadsProvider>
      </LiveProvider>
    </CatalogProvider>
    </AppUpdateProvider>
    </TaskProvider>
    </>
  )
}
