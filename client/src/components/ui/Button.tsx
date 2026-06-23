import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Icon element rendered before the label. */
  leadingIcon?: ReactNode
  /** Icon element rendered after the label. */
  trailingIcon?: ReactNode
}

// Variants follow DESIGN.md: primary solid indigo, secondary white+border,
// ghost transparent → slate-100 hover. 8px (rounded-btn) radius.
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-700 focus-visible:ring-primary/40',
  secondary:
    'bg-card text-ink border border-line hover:bg-slate-50 focus-visible:ring-primary/30',
  ghost: 'text-ink-muted hover:bg-slate-100 hover:text-ink focus-visible:ring-primary/30',
  danger: 'bg-danger text-white hover:bg-red-600 focus-visible:ring-danger/40',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-body-sm gap-1.5',
  md: 'h-10 px-4 text-body-md gap-2',
  lg: 'h-11 px-5 text-body-md gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', leadingIcon, trailingIcon, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-btn font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  )
})
