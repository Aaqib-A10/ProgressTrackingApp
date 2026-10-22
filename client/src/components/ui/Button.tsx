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

// Linear-style buttons: compact, medium weight, quiet borders. Primary is the one solid
// colour on a screen; secondary is a white surface with a hairline border and a tiny shadow.
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-white shadow-xs hover:bg-primary-700 active:bg-primary-700 focus-visible:ring-primary/40 [box-shadow:inset_0_1px_0_rgb(255_255_255/0.12),0_1px_1px_rgb(var(--shadow)/0.12)]',
  secondary:
    'bg-card text-ink border border-line shadow-xs hover:border-line-strong hover:bg-slate-50 active:bg-slate-100 focus-visible:ring-primary/30',
  ghost: 'text-ink-muted hover:bg-slate-100 hover:text-ink active:bg-slate-200 focus-visible:ring-primary/30',
  danger: 'bg-danger text-white shadow-xs hover:bg-danger/90 focus-visible:ring-danger/40',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5',
  md: 'h-9 px-3.5 text-body-md gap-2',
  lg: 'h-10 px-4 text-body-md gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', leadingIcon, trailingIcon, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-btn font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98]',
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
