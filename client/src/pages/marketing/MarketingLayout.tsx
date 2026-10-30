import { useEffect, useRef, useState, type CSSProperties, type ElementType, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, Menu, Moon, Sun, X, ArrowRight } from 'lucide-react'
import { useTheme } from '../../lib/theme'
import { cn } from '../../lib/cn'
import { api } from '../../lib/api'
import './marketing.css'
import { EXTRAS, FEATURES, SOLUTIONS } from './pages'
import { site } from './content'
import { IconAttendance, IconBoard, IconChat, IconDialer, IconReport } from './icons'
import metriqLogo from '../../assets/metriq-logo.svg'
import metriqLogoDark from '../../assets/metriq-logo-dark.svg'

/** The public website's frame (Phase 2): top bar, footer and the shared building blocks. */

const LINKS: { to: string; label: string; menu?: 'product' | 'solutions' }[] = [
  { to: '/product', label: 'Product', menu: 'product' },
  { to: '/solutions', label: 'Solutions', menu: 'solutions' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/security', label: 'Security' },
]
const TEAM_KINDS = ['General', 'Sales calling', 'Lead Generation', 'Marketing', 'E-commerce', 'Inventory', 'Customer service']
const FEATURE_ICON = { attendance: IconAttendance, projects: IconBoard, chat: IconChat, reports: IconReport, sales: IconDialer } as const

function Tile({ hue, children, size = 34 }: { hue: { a: string; b: string }; children: ReactNode; size?: number }) {
  return <span className="flex shrink-0 items-center justify-center rounded-[30%] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]" style={{ width: size, height: size, backgroundImage: `linear-gradient(to bottom, rgb(${hue.a}), rgb(${hue.b}))` }}>{children}</span>
}

/** The Product and Solutions panels that open under the top bar: the same size, side by side in feel. */
function MegaPanel({ which, onClose }: { which: 'product' | 'solutions'; onClose: () => void }) {
  const item = 'group flex items-start gap-3.5 rounded-[14px] p-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04]'
  const head = 'px-3 pb-1 pt-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint'
  return (
    <div className="mk-mega mx-auto grid w-full max-w-[1040px] gap-3 rounded-[22px] border border-line bg-card p-3.5 shadow-[0_30px_80px_-30px_rgb(var(--shadow)/0.45)] md:h-[392px] md:grid-cols-[1.45fr_1fr]">
      {which === 'product' ? (
        <>
          <div className="flex flex-col">
            <p className={head}>The parts of Metriq</p>
            <div className="grid flex-1 content-start gap-1 sm:grid-cols-2">
              {FEATURES.map((f) => {
                const Icon = FEATURE_ICON[f.key]
                return (
                  <Link key={f.key} to={`/product/${f.slug}`} onClick={onClose} className={item}>
                    <Tile hue={f.hue} size={40}><Icon size={19} /></Tile>
                    <span className="min-w-0"><span className="flex items-center gap-1 text-[14.5px] font-semibold text-ink">{f.name}<ArrowRight size={13} className="-translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" /></span><span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{f.menu}</span></span>
                  </Link>
                )
              })}
            </div>
            <div className="mx-3 mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
              <span className="mr-1 text-[12px] font-medium text-ink-faint">Also in every plan</span>
              {EXTRAS.map((x) => <Link key={x.key} to="/product" onClick={onClose} className="rounded-full border border-line px-2.5 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:border-primary/40 hover:text-ink">{x.title}</Link>)}
            </div>
          </div>
          <Link to="/product" onClick={onClose} className="group relative flex flex-col overflow-hidden rounded-[16px] border border-line bg-bg p-5">
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(80%_70%_at_100%_0%,rgb(var(--primary)/0.2),transparent)]" />
            <span className="relative"><span className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">All of Metriq<ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span><span className="mt-1 block text-[13px] leading-snug text-ink-muted">How the five parts fit together, and Department Studio.</span></span>
            <span className="relative mt-auto block pt-4">
              <img src={site('app-board.webp')} alt="" className="block w-full rounded-[10px] border border-line shadow-overlay transition-transform duration-500 group-hover:-translate-y-1 dark:hidden" />
              <img src={site('app-board-dark.webp')} alt="" className="hidden w-full rounded-[10px] border border-line shadow-overlay transition-transform duration-500 group-hover:-translate-y-1 dark:block" />
            </span>
          </Link>
        </>
      ) : (
        <>
          <div className="flex flex-col">
            <p className={head}>By kind of team</p>
            <div className="grid flex-1 grid-cols-2 content-start gap-2 px-1">
              {SOLUTIONS.map((t) => (
                <Link key={t.key} to={`/solutions/${t.slug}`} onClick={onClose} className="group rounded-[14px] p-2 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04]">
                  <span className="block overflow-hidden rounded-[10px]"><img src={site(t.image)} alt="" className="block h-[88px] w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" /></span>
                  <span className="mt-2 flex items-center gap-1 text-[14px] font-semibold text-ink">{t.name}<ArrowRight size={13} className="-translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" /></span>
                  <span className="block text-[12.5px] leading-snug text-ink-muted">{t.menu}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Link to="/solutions" onClick={onClose} className="group relative flex flex-1 flex-col overflow-hidden rounded-[16px] border border-line bg-bg p-5">
              <div aria-hidden className="absolute inset-0 bg-[radial-gradient(80%_70%_at_100%_0%,rgb(16_185_129/0.18),transparent),radial-gradient(70%_60%_at_0%_100%,rgb(var(--primary)/0.16),transparent)]" />
              <span className="relative flex items-center gap-1.5 text-[15px] font-semibold text-ink">Every kind of team<ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
              <span className="relative mt-1 block text-[13px] leading-snug text-ink-muted">Pick the kind of work each department does; it comes with the right screens.</span>
              <span className="relative mt-auto flex flex-wrap gap-1.5 pt-4">
                {TEAM_KINDS.map((k, i) => <span key={k} className="mk-chip-in rounded-full border border-line bg-card px-2.5 py-1 text-[12px] font-medium text-ink shadow-[0_6px_14px_-10px_rgb(var(--shadow)/0.5)]" style={{ animationDelay: `${i * 45}ms` }}>{k}</span>)}
              </span>
            </Link>
            <Link to="/start" onClick={onClose} className="flex items-center justify-between gap-3 rounded-[16px] border border-dashed border-line-strong px-5 py-3.5 transition-colors hover:border-primary/40">
              <span><span className="block text-[14px] font-semibold text-ink">Just you?</span><span className="block text-[12.5px] text-ink-muted">Your own tasks, to-dos and hours.</span></span>
              <ArrowRight size={15} className="shrink-0 text-ink-muted" />
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Is Metriq free while it launches? Yes until online payment opens on the server (the payment
 * code is in place and switches this off by itself). Asked once per visit.
 */
let launchCache: Promise<{ newCompanies: boolean; paymentsOpen: boolean }> | null = null
export function useLaunch(): { free: boolean } {
  const [paymentsOpen, setPaymentsOpen] = useState(false)
  useEffect(() => {
    launchCache ??= api.get<{ newCompanies: boolean; paymentsOpen?: boolean }>('/auth/open').then((r) => ({ newCompanies: !!r.newCompanies, paymentsOpen: !!r.paymentsOpen })).catch(() => ({ newCompanies: false, paymentsOpen: false }))
    let live = true
    launchCache.then((r) => { if (live) setPaymentsOpen(r.paymentsOpen) })
    return () => { live = false }
  }, [])
  return { free: !paymentsOpen }
}

/** True once the element has come into view (then stays true). */
export function useInView<T extends Element>(margin = '0px 0px -12% 0px') {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [seen, margin])
  return [ref, seen] as const
}

/** Fades and lifts its content in when it scrolls into view. */
export function Reveal({ children, className, delay = 0, as: Tag = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: ElementType }) {
  const [ref, seen] = useInView<HTMLElement>()
  return <Tag ref={ref} className={cn('mk-reveal', seen && 'mk-in', className)} style={{ '--mk-delay': `${delay}ms` } as CSSProperties}>{children}</Tag>
}

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
  const [mega, setMega] = useState<'product' | 'solutions' | null>(null)
  const closeT = useRef(0)
  const [scrolled, setScrolled] = useState(false)
  const { pathname, hash } = useLocation()
  useEffect(() => { setOpen(false); setMega(null) }, [pathname, hash])
  useEffect(() => {
    if (!mega) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMega(null) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [mega])
  const hoverOpen = (m: 'product' | 'solutions' | null) => { window.clearTimeout(closeT.current); setMega(m) }
  const hoverClose = () => { window.clearTimeout(closeT.current); closeT.current = window.setTimeout(() => setMega(null), 140) }
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
      <header className={cn('sticky top-0 z-40 border-b transition-colors', scrolled || mega ? 'border-line bg-bg/90 backdrop-blur-md' : 'border-transparent bg-bg')} onMouseLeave={hoverClose}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {LINKS.map((l) => l.menu ? (
              <span key={l.to} className="inline-flex items-center" onMouseEnter={() => hoverOpen(l.menu!)}>
                {/* The name opens its page; hovering (or the arrow) opens the menu. */}
                <Link to={l.to} onClick={() => setMega(null)} onFocus={() => hoverOpen(l.menu!)}
                  className={cn('rounded-btn py-2 pl-3 pr-0.5 text-[14px] font-medium transition-colors', mega === l.menu || pathname.startsWith(l.to) ? 'text-ink' : 'text-ink-muted hover:text-ink')}>{l.label}</Link>
                <button type="button" aria-label={`${l.label} menu`} aria-expanded={mega === l.menu} onClick={() => setMega(mega === l.menu ? null : l.menu!)}
                  className={cn('rounded-btn py-2 pl-0.5 pr-2 transition-colors', mega === l.menu || pathname.startsWith(l.to) ? 'text-ink' : 'text-ink-muted hover:text-ink')}>
                  <ChevronDown size={14} className={cn('transition-transform duration-200', mega === l.menu && 'rotate-180')} />
                </button>
              </span>
            ) : (
              <NavLink key={l.to} to={l.to} onMouseEnter={() => hoverOpen(null)} className={({ isActive }) => cn('rounded-btn px-3 py-2 text-[14px] font-medium transition-colors', isActive ? 'text-ink' : 'text-ink-muted hover:text-ink')}>{l.label}</NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <ThemeButton />
            <Link to="/login" className="rounded-btn px-3 py-2 text-[14px] font-medium text-ink-muted hover:text-ink">Sign in</Link>
            <Link to="/start" className="inline-flex h-9 items-center gap-1.5 rounded-btn bg-primary px-4 text-[14px] font-semibold text-white shadow-raised transition-colors hover:bg-primary-700">Start free</Link>
          </div>
          <div className="ml-auto flex items-center gap-1 md:hidden">
            <ThemeButton />
            <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-btn p-2 text-ink" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>{open ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </div>
        {mega && (
          <div className="absolute inset-x-0 top-full hidden px-4 pt-2 md:block" onMouseEnter={() => hoverOpen(mega)}>
            <MegaPanel which={mega} onClose={() => setMega(null)} />
          </div>
        )}
        {open && (
          <div className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-line bg-bg px-4 pb-5 pt-2 md:hidden">
            <Link to="/product" className="flex items-center justify-between px-2 pt-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Product<span className="normal-case tracking-normal text-primary">See all</span></Link>
            {FEATURES.map((f) => { const Icon = FEATURE_ICON[f.key]; return <Link key={f.key} to={`/product/${f.slug}`} className="flex items-center gap-3 rounded-btn px-2 py-2 text-[15px] font-medium text-ink"><Tile hue={f.hue} size={28}><Icon size={15} /></Tile>{f.name}</Link> })}
            <Link to="/solutions" className="flex items-center justify-between px-2 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Solutions<span className="normal-case tracking-normal text-primary">See all</span></Link>
            {SOLUTIONS.map((t) => <Link key={t.key} to={`/solutions/${t.slug}`} className="flex items-center gap-3 rounded-btn px-2 py-2 text-[15px] font-medium text-ink"><img src={site(t.image)} alt="" className="h-7 w-7 rounded-[8px] object-cover" />{t.name}</Link>)}
            <div className="mt-2 border-t border-line pt-2">
              {LINKS.filter((l) => !l.menu).map((l) => <Link key={l.to} to={l.to} className="block rounded-btn px-2 py-2.5 text-[15px] font-medium text-ink">{l.label}</Link>)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link to="/login" className="inline-flex h-10 items-center justify-center rounded-btn border border-line text-[14px] font-semibold text-ink">Sign in</Link>
              <Link to="/start" className="inline-flex h-10 items-center justify-center rounded-btn bg-primary text-[14px] font-semibold text-white">Start free</Link>
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
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{title}</p>
      <ul className="mt-4 space-y-2.5">{links.map((l) => <li key={l.label}><Link to={l.to} className="text-[14px] text-ink-muted transition-colors hover:text-ink">{l.label}</Link></li>)}</ul>
    </div>
  )
  return (
    <footer className="relative overflow-hidden border-t border-line bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-10 pt-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-ink-muted">Attendance, projects, chat and daily reports for your whole team, in one app.</p>
        </div>
        {col('Product', FEATURES.map((f) => ({ to: `/product/${f.slug}`, label: f.name })))}
        {col('Company', [{ to: '/solutions', label: 'Solutions' }, { to: '/pricing', label: 'Pricing' }, { to: '/security', label: 'Security' }, { to: '/#faq', label: 'Questions' }])}
        {col('Legal', [{ to: '/terms', label: 'Terms of Service' }, { to: '/privacy', label: 'Privacy Policy' }, { to: '/cookies', label: 'Cookie Policy' }, { to: '/dpa', label: 'Data Processing' }])}
        {col('Get started', [{ to: '/start', label: 'Start free' }, { to: '/login', label: 'Sign in' }])}
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-5 text-[12.5px] text-ink-faint sm:px-6">
        <p>© {new Date().getFullYear()} Metriq. All rights reserved.</p>
        <p className="flex gap-4"><Link to="/terms" className="hover:text-ink">Terms</Link><Link to="/privacy" className="hover:text-ink">Privacy</Link><Link to="/cookies" className="hover:text-ink">Cookies</Link></p>
      </div>
      {/* The name, large and quiet, under everything. */}
      <FooterWord />
    </footer>
  )
}

/**
 * The name, large, under everything. The letters come together when the footer scrolls in, a slow
 * light passes across them, and a soft glow follows the pointer. Still with reduced motion.
 */
function FooterWord() {
  const [ref, seen] = useInView<HTMLDivElement>('0px 0px -5% 0px')
  const word = useRef<HTMLParagraphElement>(null)
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = word.current
    if (!el || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
    el.style.setProperty('--mo', '1')
  }
  const leave = () => word.current?.style.setProperty('--mo', '0')
  return (
    <div ref={ref} aria-hidden onPointerMove={move} onPointerLeave={leave} className="relative select-none overflow-hidden">
      {/* The letters (they rise into place) and, on top, the same word lit by a passing light and the pointer. */}
      <p className={cn('mk-word-base -mb-[0.2em] text-center text-[22vw] font-bold leading-none tracking-[-0.06em] lg:text-[260px]', seen && 'mk-word-foot-in')}>
        {'Metriq'.split('').map((ch, i) => <span key={i} className="mk-word-ch inline-block" style={{ '--i': i } as CSSProperties}>{ch}</span>)}
      </p>
      <p ref={word} className={cn('mk-word-foot pointer-events-none absolute inset-x-0 top-0 text-center text-[22vw] font-bold leading-none tracking-[-0.06em] lg:text-[260px]', seen && 'mk-word-foot-in')}>
        {'Metriq'.split('').map((ch, i) => <span key={i} className="inline-block">{ch}</span>)}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ building blocks */

export const Container = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('mx-auto max-w-6xl px-4 sm:px-6', className)}>{children}</div>

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="inline-flex items-center gap-2.5 text-[13.5px] font-semibold text-primary"><span aria-hidden className="h-px w-6 bg-gradient-to-r from-transparent to-primary" />{children}</p>
}

export function SectionHead({ eyebrow, title, text, center }: { eyebrow?: string; title: ReactNode; text?: ReactNode; center?: boolean }) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto flex flex-col items-center text-center')}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-4 text-balance text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[44px]">{title}</h2>
      {text && <p className="mt-5 text-pretty text-[16px] leading-relaxed text-ink-muted sm:text-[18px]">{text}</p>}
    </div>
  )
}

export function PrimaryCta({ to = '/start', children = 'Start free' }: { to?: string; children?: ReactNode }) {
  return <Link to={to} className="group inline-flex h-11 items-center gap-2 rounded-btn bg-primary px-5 text-[15px] font-semibold text-white shadow-[0_8px_24px_-8px_rgb(var(--primary)/0.7)] transition-all hover:bg-primary-700 hover:shadow-[0_10px_30px_-8px_rgb(var(--primary)/0.85)]">{children}<ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /></Link>
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
