import { Check } from 'lucide-react'
import { THEMES, themeById } from '../../theme/themes'
import { cn } from '../../lib/cn'

/**
 * The colour themes as small live previews: each card carries data-theme, so what is inside it is drawn in that
 * theme's own colours (src/theme/theme.css), light or dark as the page is. `value` null is "the company's theme".
 */
export function ThemePicker({ value, companyTheme, onPick, allowCompany = true, busy }: {
  value: string | null
  companyTheme?: string | null
  onPick: (id: string | null) => void
  /** Offer "the company's theme" as a choice (a person's own setting); off for the company's own setting. */
  allowCompany?: boolean
  busy?: boolean
}) {
  const company = themeById(companyTheme)
  return (
    <div className="space-y-3">
      {allowCompany && (
        <button
          type="button"
          onClick={() => onPick(null)}
          disabled={busy}
          aria-pressed={value === null}
          className={cn('flex w-full items-center justify-between gap-3 rounded-card border px-3.5 py-2.5 text-left text-body-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', value === null ? 'border-primary bg-primary-50 text-ink' : 'border-line bg-card text-ink-muted hover:border-line-strong hover:text-ink')}
        >
          <span><span className="font-semibold text-ink">Use the company's theme</span> · {company.label}</span>
          {value === null && <Check size={16} className="shrink-0 text-primary-ink" />}
        </button>
      )}
      <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {THEMES.map((t) => {
          const on = value === t.id || (!allowCompany && value === null && t.id === THEMES[0].id)
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => onPick(t.id)}
              className={cn('group rounded-card border bg-card p-1.5 text-left transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60', on ? 'border-primary ring-2 ring-primary/25' : 'border-line hover:border-line-strong')}
            >
              <ThemePreview id={t.id} />
              <span className="flex items-center justify-between gap-2 px-1.5 pb-1 pt-2">
                <span className="text-body-sm font-semibold text-ink">{t.label}</span>
                {on && <Check size={15} className="shrink-0 text-primary-ink" />}
              </span>
              <span className="block px-1.5 pb-1 text-[11.5px] leading-4 text-ink-muted">{t.description}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A tiny screen in a theme: the sidebar, a card with a title, a line of text, two status chips and a button. */
export function ThemePreview({ id, className }: { id: string; className?: string }) {
  const dark = themeById(id).darkOnly
  return (
    <span data-theme={id} className={cn('flex h-[84px] overflow-hidden rounded-[7px] border border-line bg-bg', dark && 'dark', className)} aria-hidden>
      <span className="flex w-[22%] flex-col gap-1 border-r border-line bg-sidebar p-1.5">
        <span className="h-1.5 w-3/4 rounded-full bg-primary" />
        <span className="h-1.5 w-full rounded-full bg-slate-300" />
        <span className="h-1.5 w-2/3 rounded-full bg-slate-300" />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="flex flex-1 flex-col gap-1 rounded-[5px] border border-line bg-card p-1.5 shadow-xs">
          <span className="h-1.5 w-1/2 rounded-full bg-ink" />
          <span className="h-1 w-5/6 rounded-full bg-ink-muted/60" />
          <span className="mt-auto flex items-center gap-1">
            <span className="h-2 w-5 rounded-full bg-success-muted ring-1 ring-inset ring-success/30" />
            <span className="h-2 w-5 rounded-full bg-warning-muted ring-1 ring-inset ring-warning/30" />
            <span className="ml-auto flex h-3 w-8 items-center justify-center rounded-[3px] bg-primary"><span className="h-0.5 w-4 rounded-full bg-primary-on" /></span>
          </span>
        </span>
      </span>
    </span>
  )
}
