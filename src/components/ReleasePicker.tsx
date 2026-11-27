// Selector de release y archivo: para cuando el archivo recomendado no es el que quieres
// (otra versión, otra variante, o el recomendado lo bloquea el antivirus).

import { useEffect, useState } from 'react'
import { useDownloads } from '../app/downloads'
import { useNav } from '../app/nav'
import { api, openExternal } from '../lib/api'
import { fmtDate, fmtSize } from '../lib/format'
import type { ProjectReleases, ReleaseAssetChoice } from '../lib/types'
import { tr } from '../lib/i18n'

const OS_LABEL: Record<ReleaseAssetChoice['os'], string> = {
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
  android: 'Android',
  debug: tr('Depuración', 'Debug'),
  metadata: tr('Suma o firma', 'Checksum or signature'),
  unknown: tr('Sin indicar', 'Not stated'),
}

export function ReleasePicker({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [data, setData] = useState<ProjectReleases | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [started, setStarted] = useState<string | null>(null)
  const { startAsset, error } = useDownloads()
  const { go } = useNav()

  useEffect(() => {
    api.projectReleases(slug).then(setData, (e) => setErr(String(e)))
  }, [slug])

  const pick = async (url: string) => {
    await startAsset(slug, url)
    setStarted(url)
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">{tr('Elegir versión y archivo', 'Choose version and file')}</div>
          <p className="panel-title">{tr('Releases publicadas en el repositorio oficial', 'Releases published in the official repository')}</p>
        </div>
        <span className="cand-actions">
          {data && <button type="button" className="link" onClick={() => openExternal(data.repoUrl + '/releases')}>{tr('Ver en GitHub', 'View on GitHub')}</button>}
          <button type="button" className="link" onClick={onClose}>{tr('Cerrar', 'Close')}</button>
        </span>
      </div>
      <p className="note-line">
        {tr('Solo se pueden descargar archivos de estas releases. El recomendado es el que NATIVE HUB identifica como ejecutable para Windows. Elegir otro puede servir si el recomendado da problemas, pero revisa antes qué es.', 'Only files from these releases can be downloaded. The recommended one is the file NATIVE HUB identifies as the Windows executable. Picking another can help if the recommended one causes trouble, but check what it is first.')}
      </p>
      {err && <p className="note-line err">{err}</p>}
      {!data && !err && <p className="note-line">{tr('Consultando releases…', 'Fetching releases…')}</p>}
      {data && data.releases.length === 0 && <p className="empty">{tr('Este proyecto no tiene releases publicadas.', 'This project has no published releases.')}</p>}
      {data?.releases.map((r, i) => {
        const shown = all ? r.assets : r.assets.filter((a) => a.os !== 'metadata' && a.os !== 'debug')
        return (
          <section key={r.tag} className="rel">
            <div className="rel-head">
              <span className="mono">{r.tag}</span>
              {i === 0 && <span className="yes-plain">{tr('más reciente', 'latest')}</span>}
              {r.prerelease && <span className="muted">prerelease</span>}
              <span className="muted num">{fmtDate(r.publishedAt)}</span>
            </div>
            {shown.length === 0 ? (
              <p className="note-line">{tr('Sin archivos descargables.', 'No downloadable files.')}</p>
            ) : (
              <ul className="rel-assets">
                {shown.map((a) => (
                  <li key={a.url}>
                    <span className="mono ellipsis-wide" title={a.name}>{a.name}</span>
                    <span className={a.os === 'windows' ? 'yes-plain' : 'muted'}>{OS_LABEL[a.os]}</span>
                    <span className="muted num">{fmtSize(a.size) ?? '—'}</span>
                    <span className="muted">{a.sha256 ? 'SHA-256' : ''}</span>
                    <span>{a.recommended && <span className="flag">{tr('Recomendado', 'Recommended')}</span>}</span>
                    {started === a.url ? (
                      <button type="button" className="link" onClick={() => go({ name: 'downloads' })}>{tr('En descargas', 'In downloads')}</button>
                    ) : (
                      <button type="button" className={a.recommended ? 'btn-primary' : 'btn-line'} onClick={() => pick(a.url)}>{tr('Descargar', 'Download')}</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
      {data && data.releases.length > 0 && (
        <button type="button" className="link" onClick={() => setAll(!all)}>{all ? tr('Ocultar sumas, firmas y símbolos', 'Hide checksums, signatures and symbols') : tr('Mostrar también sumas, firmas y símbolos', 'Also show checksums, signatures and symbols')}</button>
      )}
      {error && <p className="note-line err">{error}</p>}
    </div>
  )
}
