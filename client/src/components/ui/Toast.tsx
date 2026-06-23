import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  type: ToastType
  message: ReactNode
}

interface ToastContextValue {
  addToast: (toast: { type?: ToastType; message: ReactNode; duration?: number }) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

const ICONS: Record<ToastType, ReactNode> = {
  success: <CheckCircle2 size={18} className="text-success" />,
  error: <XCircle size={18} className="text-danger" />,
  warning: <AlertTriangle size={18} className="text-warning" />,
  info: <Info size={18} className="text-primary" />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback<ToastContextValue['addToast']>(
    ({ type = 'info', message, duration = 4000 }) => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { id, type, message }])
      if (duration > 0) window.setTimeout(() => remove(id), duration)
    },
    [remove],
  )

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {createPortal(
        <div className="fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex animate-slide-in-right items-start gap-3 rounded-card border border-line bg-card p-3.5 shadow-overlay"
            >
              <span className="mt-0.5 shrink-0">{ICONS[t.type]}</span>
              <div className="flex-1 text-body-md text-ink">{t.message}</div>
              <button
                onClick={() => remove(t.id)}
                className="shrink-0 rounded p-0.5 text-ink-muted hover:bg-slate-100 hover:text-ink"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
