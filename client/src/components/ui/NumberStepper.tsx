import { useEffect, useState, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface NumberStepperProps {
  label: string
  value: number
  onChange: (value: number) => void
  icon?: ReactNode
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}

/** −/+ numeric stepper used across the daily entry forms. */
export function NumberStepper({
  label,
  value,
  onChange,
  icon,
  min = 0,
  max = 100000,
  step = 1,
  disabled,
}: NumberStepperProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n))
  // Local text state so the field can be momentarily empty while the user types
  // (otherwise the leading "0" sticks and they have to delete it by hand).
  const [text, setText] = useState(() => String(value))
  const [focused, setFocused] = useState(false)

  // Mirror external value changes (+/− buttons, form load) while not mid-edit.
  useEffect(() => {
    if (!focused) setText(String(value))
  }, [value, focused])

  const set = (n: number) => onChange(clamp(Number.isNaN(n) ? min : n))

  return (
    <div className={cn(disabled && 'opacity-50')}>
      <label className="mb-1 flex items-center gap-1.5 text-body-sm font-medium text-ink-muted">
        {icon}
        {label}
      </label>
      <div className="flex items-center rounded-btn border border-line bg-bg">
        <button
          type="button"
          onClick={() => set(value - step)}
          disabled={disabled || value <= min}
          className="flex h-10 w-10 items-center justify-center rounded-l-btn text-ink-muted hover:bg-slate-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Decrease ${label}`}
        >
          <Minus size={16} />
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={text}
          placeholder={String(min)}
          disabled={disabled}
          onFocus={(e) => {
            setFocused(true)
            // Clear the placeholder "0" so the user types straight away; for any
            // other value, select it so the first keystroke replaces it.
            if (value === min) setText('')
            else e.currentTarget.select()
          }}
          onChange={(e) => {
            const raw = e.target.value
            setText(raw)
            const n = parseInt(raw, 10)
            if (!Number.isNaN(n)) onChange(clamp(n))
          }}
          onBlur={() => {
            setFocused(false)
            const n = parseInt(text, 10)
            const c = Number.isNaN(n) ? min : clamp(n)
            onChange(c)
            setText(String(c))
          }}
          className="h-10 w-full min-w-0 border-x border-line bg-card text-center text-body-lg font-semibold tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/30 disabled:bg-bg [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => set(value + step)}
          disabled={disabled || value >= max}
          className="flex h-10 w-10 items-center justify-center rounded-r-btn text-ink-muted hover:bg-slate-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Increase ${label}`}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}
