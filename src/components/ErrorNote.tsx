import { useState } from 'react'
import { copyReport, isTauri, api } from '../lib/api'
import { explainError } from '../lib/errors'
import { tr } from '../lib/i18n'

/**
 * An error as the user sees it: a plain explanation and what to do, the original message,
 * and links to copy the details (with the end of the log) or open the log folder.
 */
export function ErrorNote({ error, className }: { error: string; className?: string }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const ex = explainError(error)
  const copy = async () => setCopied((await copyReport(error)) ? 'ok' : 'fail')
  return (
    <div className={`error-note${className ? ` ${className}` : ''}`} role="alert">
      <p className="err">{ex ? ex.title : error}</p>
      {ex?.hint && <p className="muted">{ex.hint}</p>}
      {ex && <p className="mono muted error-raw">{error}</p>}
      <p className="error-actions">
        <button type="button" className="link" onClick={copy}>{copied === 'ok' ? tr('Copiado', 'Copied') : tr('Copiar detalles', 'Copy details')}</button>
        {isTauri && <> · <button type="button" className="link" onClick={() => api.openLogFolder().catch(() => {})}>{tr('Abrir el registro', 'Open the log')}</button></>}
        {copied === 'fail' && <span className="muted"> {tr('No se pudo copiar al portapapeles.', 'Could not copy to the clipboard.')}</span>}
      </p>
    </div>
  )
}
