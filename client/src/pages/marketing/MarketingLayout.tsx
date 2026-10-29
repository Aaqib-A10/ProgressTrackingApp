import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, Moon, Sun, X, ArrowRight } from 'lucide-react'
import { useTheme } from '../../lib/theme'
import { cn } from '../../lib/cn'
import metriqLogo from '../../assets/metriq-logo.svg'
import metriqLogoDark from '../../assets/metriq-logo-dark.svg'

/** The public website's frame (Phase 2): top bar, footer and the shared building blocks. */

const LINKS = [
  { to: '/#tour', label: 'Product' },
  { to: '/#teams', label: 'Solutions' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/security', label: 'Security' },
]

export function usePageTitle(title: string, description?: string) {
  useEffect(() => {
    document.title = title
    if (description) {
      let m = document.querySelector('meta[name="description"]')
      if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'description'); document.head.appendChild(m) }
      m.setAttribute('content', description)
    }
  }, [title, description])
}

function Logo() {
  return (
    <Link to="/" className="flex items-center" aria-label="Metriq home">
      <img src={metriqLogo} alt="Metriq" className="h-[22px] w-auto dark:hidden" />
      <img src={metriqLogoDark} alt="Metriq" className="hidden h-[22px] w-auto dark:block" />
    </Link>
  )
}

function ThemeButton() {
  const { theme, setChoice } = useTheme()
  return (
    <button type="button" onClick={() => setChoice(theme === 'dark' ? 'light' : 'dark')} className="rounded-btn p-2 text-ink-muted hover:bg-slate-100 hover:text-ink" aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  )
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { pathname, hash } = useLocation()
  useEffect(() => { setOpen(false) }, [pathname, hash])
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on(); window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  // Anchor links (/#tour) scroll to their section, also when coming from another page.
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return }
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    return () => clearTimeout(t)
  }, [pathname, hash])

  return (
    <div className="min-h-screen bg-bg text-ink antialiased">
      <header className={cn('sticky top-0 z-40 border-b transition-colors', scrolled ? 'border-line bg-bg/85 backdrop-blur-md' : 'border-transparent bg-bg')}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => cn('rounded-btn px-3 py-2 text-[14px] font-medium transition-colors', isActive && !l.to.includes('#') ? 'text-ink' : 'text-ink-muted hover:text-ink')}>{l.label}</NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <ThemeButton />
            <Link to="/login" className="rounded-btn px-3 py-2 text-[14px] font-medium text-ink-muted hover:text-ink">Sign in</Link>
            <Link to="/start" className="inline-flex h-9 items-center gap-1.5 rounded-btn bg-primary px-4 text-[14px] font-semibold text-white shadow-raised transition-colors hover:bg-primary-700">Start free trial</Link>
          </div>
          <div className="ml-auto flex items-center gap-1 md:hidden">
            <ThemeButton />
            <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-btn p-2 text-ink" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>{open ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </div>
        {open && (
          <div className="border-t border-line bg-bg px-4 pb-5 pt-2 md:hidden">
            {LINKS.map((l) => <Link key={l.to} to={l.to} className="block rounded-btn px-2 py-2.5 text-[15px] font-medium text-ink">{l.label}</Link>)}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link to="/login" className="inline-flex h-10 items-center justify-center rounded-btn border border-line text-[14px] font-semibold text-ink">Sign in</Link>
              <Link to="/start" className="inline-flex h-10 items-center justify-center rounded-btn bg-primary text-[14px] font-semibold text-white">Start free trial</Link>
            </div>
          </div>
        )}
      </header>
      <main>{children}</main>
      <SiteFooter />
    </div>
  )
}

function SiteFooter() {
  const col = (title: string, links: { to: string; label: string }[]) => (
    <div>
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <ul className="mt-3 space-y-2">{links.map((l) => <li key={l.label}><Link to={l.to} className="text-[13.5px] text-ink-muted hover:text-ink">{l.label}</Link></li>)}</ul>
    </div>
  )
  return (
    <footer className="border-t border-line bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-ink-muted">Attendance, projects, chat and daily reports for your whole team, in one app.</p>
        </div>
        {col('Product', [{ to: '/#tour', label: 'Attendance' }, { to: '/#tour', label: 'Projects and chat' }, { to: '/#tour', label: 'Daily reports' }, { to: '/#teams', label: 'For sales teams' }])}
        {col('Company', [{ to: '/pricing', label: 'Pricing' }, { to: '/security', label: 'Security' }, { to: '/#faq', label: 'Questions' }])}
        {col('Get started', [{ to: '/start', label: 'Start free trial' }, { to: '/login', label: 'Sign in' }])}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-5 text-[12.5px] text-ink-faint sm:px-6">© {new Date().getFullYear()} Metriq. All rights reserved.</p>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ building blocks */

export const Container = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('mx-auto max-w-6xl px-4 sm:px-6', className)}>{children}</div>

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{children}</p>
}

export function SectionHead({ eyebrow, title, text, center }: { eyebrow?: string; title: ReactNode; text?: ReactNode; center?: boolean }) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-4 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[38px]">{title}</h2>
      {text && <p className="mt-4 text-[16px] leading-relaxed text-ink-muted sm:text-[17px]">{text}</p>}
    </div>
  )
}

export function PrimaryCta({ to = '/start', children = 'Start free trial' }: { to?: string; children?: ReactNode }) {
  return <Link to={to} className="inline-flex h-11 items-center gap-2 rounded-btn bg-primary px-5 text-[15px] font-semibold text-white shadow-raised transition-colors hover:bg-primary-700">{children}<ArrowRight size={16} /></Link>
}
export function SecondaryCta({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex h-11 items-center gap-2 rounded-btn border border-line bg-card px-5 text-[15px] font-semibold text-ink transition-colors hover:bg-slate-50">{children}</Link>
}

/** A screenshot of the app in a quiet window frame. */
export function AppFrame({ src, darkSrc, alt, className, eager }: { src: string; darkSrc?: string; alt: string; className?: string; eager?: boolean }) {
  return (
    <div className={cn('overflow-hidden rounded-[14px] border border-line bg-card shadow-overlay', className)}>
      <div className="flex h-8 items-center gap-1.5 border-b border-line bg-slate-50 px-3" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" /><span className="h-2.5 w-2.5 rounded-full bg-slate-300" /><span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
      </div>
      <img src={src} alt={alt} className={cn('block w-full', darkSrc && 'dark:hidden')} loading={eager ? 'eager' : 'lazy'} decoding="async" width={1680} height={1050} />
      {darkSrc && <img src={darkSrc} alt={alt} className="hidden w-full dark:block" loading="lazy" decoding="async" width={1680} height={1050} />}
    </div>
  )
}
