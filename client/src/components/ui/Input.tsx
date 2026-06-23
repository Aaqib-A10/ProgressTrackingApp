import { forwardRef, useId, useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  /** Element rendered inside the field on the right (e.g. a toggle). */
  rightSlot?: ReactNode
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, rightSlot, className, id, ...props },
  ref,
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className="mb-1 block text-body-sm font-semibold text-ink">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          className={cn(
            'h-10 w-full rounded-btn border bg-card px-3 text-body-md text-ink placeholder:text-ink-muted',
            'focus:outline-none focus:ring-4',
            error
              ? 'border-danger focus:border-danger focus:ring-danger/10'
              : 'border-line focus:border-primary focus:ring-primary/10',
            rightSlot && 'pr-10',
            className,
          )}
          aria-invalid={!!error}
          {...props}
        />
        {rightSlot && <div className="absolute right-2 top-1/2 -translate-y-1/2">{rightSlot}</div>}
      </div>
      {error && <p className="mt-1 text-body-sm text-danger">{error}</p>}
    </div>
  )
})

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

/** Multiline counterpart to TextField — same border/focus styling. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, error, className, id, rows = 4, ...props },
  ref,
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className="mb-1 block text-body-sm font-semibold text-ink">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        className={cn(
          'w-full rounded-btn border bg-card px-3 py-2 text-body-md text-ink placeholder:text-ink-muted',
          'focus:outline-none focus:ring-4',
          error
            ? 'border-danger focus:border-danger focus:ring-danger/10'
            : 'border-line focus:border-primary focus:ring-primary/10',
          className,
        )}
        aria-invalid={!!error}
        {...props}
      />
      {error && <p className="mt-1 text-body-sm text-danger">{error}</p>}
    </div>
  )
})

export const PasswordField = forwardRef<HTMLInputElement, TextFieldProps>(function PasswordField(
  props,
  ref,
) {
  const [show, setShow] = useState(false)
  return (
    <TextField
      ref={ref}
      type={show ? 'text' : 'password'}
      rightSlot={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded p-1 text-ink-muted hover:text-ink"
          aria-label={show ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      }
      {...props}
    />
  )
})

/** 0–4 password strength from length + character variety. */
export function passwordStrength(pw: string): number {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

export function PasswordStrength({ value }: { value: string }) {
  const score = passwordStrength(value)
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong']
  const colors = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-accent', 'bg-success']
  if (!value) return null
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn('h-1 flex-1 rounded-full', i < score ? colors[score] : 'bg-line')} />
        ))}
      </div>
      <p className="mt-1 text-body-sm text-ink-muted">Strength: {labels[score]}</p>
    </div>
  )
}
