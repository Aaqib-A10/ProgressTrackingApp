import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { reportError } from '../lib/errorReporter'

/** Shown when a screen crashes. The crash is sent to System Health so it can be fixed. */
export function RouteError() {
  const err = useRouteError()
  const notFound = isRouteErrorResponse(err) && err.status === 404
  useEffect(() => {
    if (notFound) return
    const e = err instanceof Error ? err : new Error(isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : String(err))
    reportError({ message: e.message, stack: e.stack, kind: 'render' })
  }, [err, notFound])
  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-card p-6 text-center shadow-raised">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-slate-50 text-warning"><AlertTriangle size={20} /></span>
        <h1 className="text-[16px] font-semibold text-ink">{notFound ? 'Page not found' : 'This screen hit a problem'}</h1>
        <p className="mt-1 text-body-md text-ink-muted">{notFound ? 'The link may be old.' : 'It has been reported to the developers. Reloading usually fixes it.'}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="inline-flex h-9 items-center gap-1.5 rounded-btn bg-primary px-3 text-body-sm font-medium text-white hover:bg-primary-700"><RotateCw size={14} /> Reload</button>
          <a href="/app/dashboard" className="inline-flex h-9 items-center rounded-btn border border-line bg-card px-3 text-body-sm font-medium text-ink hover:bg-slate-50">Dashboard</a>
        </div>
      </div>
    </div>
  )
}
