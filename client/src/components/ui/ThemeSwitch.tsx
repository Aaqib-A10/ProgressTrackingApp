import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeChoice } from '../../lib/theme'
import { cn } from '../../lib/cn'

const OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={14} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
  { value: 'system', label: 'System', icon: <Monitor size={14} /> },
]

/** Light / Dark / System. Small icons in menus, icon and word in Settings. */
export function ThemeSwitch({ withLabels, className }: { withLabels?: boolean; className?: string }) {
  const { choice, setChoice } = useTheme()
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-line/60', className)}>
      {OPTIONS.map((o) => {
        const on = choice === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.label}
            aria-label={o.label}
            onClick={() => setChoice(o.value)}
            className={cn(
              'inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-body-sm font-medium transition-colors',
              withLabels ? 'px-3' : 'w-8',
              on ? 'bg-card text-ink shadow-[0_1px_2px_rgb(var(--shadow)/0.08),0_0_0_1px_rgb(var(--line-strong)/0.5)]' : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.icon}
            {withLabels && o.label}
          </button>
        )
      })}
    </div>
  )
}
