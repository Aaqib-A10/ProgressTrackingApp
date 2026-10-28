import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Navigate, useLocation, useNavigate, useParams, useRoutes } from 'react-router-dom'
import { Building2, LayoutDashboard, LifeBuoy, ScrollText, LogOut, AlertTriangle, ArrowLeft, Search, ExternalLink, Activity, Menu, ChevronDown, Users, UserCheck, Bug, ToggleRight } from 'lucide-react'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { TextField, PasswordField } from '../../components/ui/Input'
import { Toggle } from '../../components/ui/Toggle'
import { StatCard } from '../../components/StatCard'
import { cn } from '../../lib/cn'
import metriqLogo from '../../assets/metriq-logo.svg'
import metriqLogoDark from '../../assets/metriq-logo-dark.svg'
import {
  ownerApi, ownerErr, OwnerApiError, STATUS_LABEL, PRIORITY_LABEL,
  type OwnerCompany, type OwnerHome, type OwnerFlag, type CompanyFlag, type TicketRow, type TicketDetail, type TicketStatus, type TicketPriority, type ActivityRow,
} from '../../lib/ownerApi'

/**
 * The owner console (erp, step 0): where Metriq is run as a business. Only the owner signs in
 * here (password + authenticator code); company people, Super Admins included, cannot.
 * /owner/login, /owner (home), /owner/companies, /owner/support, /owner/activity.
 */

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const inputCls = 'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'
const STATUS_TONE: Record<TicketStatus, BadgeTone> = { OPEN: 'warning', IN_PROGRESS: 'primary', WAITING_ON_COMPANY: 'neutral', RESOLVED: 'success' }
const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = { LOW: 'neutral', NORMAL: 'neutral', HIGH: 'warning', URGENT: 'danger' }
const COMPANY_TONE: Record<OwnerCompany['status'], BadgeTone> = { TRIAL: 'accent', ACTIVE: 'success', SUSPENDED: 'danger' }

export default function OwnerApp() {
  const { pathname } = useLocation()
  if (pathname === '/owner/login') return <OwnerLogin />
  return <OwnerShell />
}

// ------------------------------------------------------------------ sign in

function OwnerLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      if (!ticket) {
        const r = await ownerApi.login(email, password)
        // Password only, unless the phone code was switched on (then a second step asks for it).
        if (!r.needCode || !r.ticket) { navigate('/owner', { replace: true }); return }
        setTicket(r.ticket); setPassword('')
      } else {
        await ownerApi.code(ticket, code)
        navigate('/owner', { replace: true })
      }
    } catch (err) {
      setError(ownerErr(err))
      if (err instanceof OwnerApiError && ticket && /sign in again|too long/i.test(err.message)) { setTicket(null); setCode('') }
    } finally { setBusy(false) }
  }

  return (
    <div className="grid min-h-screen bg-card lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Left: the owner's side of Metriq. Dark in both themes, quiet moving lines, no fake data. */}
      <aside className="relative hidden overflow-hidden bg-[#0b1020] text-white lg:flex lg:flex-col">
        <OwnerLines />
        <div className="relative flex items-center gap-3 px-12 pt-10">
          <img src={metriqLogoDark} alt="Metriq" className="h-6 w-auto" />
          <span className="h-4 w-px bg-white/20" />
          <span className="text-[13px] font-medium tracking-wide text-white/60">Owner console</span>
        </div>
        <div className="relative mt-auto px-12 pb-12">
          <p className="max-w-md text-[34px] font-semibold leading-[1.15] tracking-[-0.02em]">
            Every company on Metriq, <span className="text-white/45">run from one place.</span>
          </p>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/55">
            {['Companies', 'Support', 'Switches', 'Activity log'].map((x) => (
              <li key={x} className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-[#818cf8]" />{x}</li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Right: the form */}
      <main className="relative flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <img src={metriqLogo} alt="Metriq" className="h-6 w-auto lg:invisible dark:hidden" />
          <Link to="/login" className="inline-flex items-center gap-1.5 text-[14px] text-ink-muted hover:text-ink"><ArrowLeft size={15} />Company sign in</Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[400px]">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-primary">Owner access</p>
            <h1 className="mt-3 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">{ticket ? 'One more step' : 'Sign in to the owner console'}</h1>
            <p className="mt-3 text-[15px] leading-6 text-ink-muted">{ticket ? 'Enter the 6 digit code from your phone app.' : 'Only the Metriq owner signs in here. Company people use the normal sign in.'}</p>
            <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
              {!ticket ? (
                <>
                  <TextField label="Email or username" type="text" placeholder="you@company.com or username" autoComplete="username" autoCapitalize="none" spellCheck={false}
                    className="!h-11 !text-[15px]" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                  <PasswordField label="Password" placeholder="Your password" autoComplete="current-password" className="!h-11 !text-[15px]" value={password} onChange={(e) => setPassword(e.target.value)} />
                </>
              ) : (
                <TextField label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="!h-12 text-center !text-headline-md tracking-[0.4em]"
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
              )}
              {error && <p className="rounded-btn bg-danger/10 px-3 py-2.5 text-body-sm text-danger" role="alert">{error}</p>}
              <Button type="submit" size="lg" className="h-11 w-full text-[15px]" disabled={busy || (!ticket ? !email || !password : code.length !== 6)}>
                {busy ? 'Checking…' : ticket ? 'Verify and sign in' : 'Sign in'}
              </Button>
            </form>
            <p className="mt-8 border-t border-line pt-5 text-[13px] leading-5 text-ink-faint">Every owner sign in is recorded with its time and address. Five wrong tries lock it for 15 minutes.</p>
          </div>
        </div>
      </main>
    </div>
  )
}

/** Slow, quiet flowing lines for the owner sign in panel (decoration only; still for reduced motion). */
function OwnerLines() {
  const lines = Array.from({ length: 28 }, (_, i) => {
    const y = 250 + i * 13
    const bend = 140 + i * 9
    return `M -40 ${y} C 220 ${y - bend * 0.35}, 420 ${y + bend * 0.55}, 760 ${y - 60 + i * 6}`
  })
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 720 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="owner-line" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#818cf8" stopOpacity="0" />
          <stop offset="0.45" stopColor="#818cf8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#2dd4bf" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="owner-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0.12" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.72" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.86" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="owner-mask"><rect width="720" height="900" fill="url(#owner-fade)" /></mask>
        <radialGradient id="owner-glow" cx="0.75" cy="0.3" r="0.6">
          <stop offset="0" stopColor="#4f46e5" stopOpacity="0.35" />
          <stop offset="1" stopColor="#0b1020" stopOpacity="0" />
        </radialGradient>
        <style>{`
          .owner-path { stroke-dasharray: 6 10; animation: owner-flow 14s linear infinite; }
          @keyframes owner-flow { to { stroke-dashoffset: -320; } }
          @media (prefers-reduced-motion: reduce) { .owner-path { animation: none; } }
        `}</style>
      </defs>
      <rect width="720" height="900" fill="url(#owner-glow)" />
      <g mask="url(#owner-mask)">
      {lines.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="url(#owner-line)" strokeWidth={i % 4 === 0 ? 1.2 : 0.7} className={i % 3 === 0 ? 'owner-path' : undefined} style={i % 3 === 0 ? { animationDelay: `${-i * 0.7}s` } : undefined} />
      ))}
      </g>
    </svg>
  )
}

// ------------------------------------------------------------------ shell (same look as the app)

const NAV = [
  { to: '/owner', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/owner/companies', label: 'Companies', icon: Building2 },
  { to: '/owner/support', label: 'Support', icon: LifeBuoy },
  { to: '/owner/switches', label: 'Switches', icon: ToggleRight },
  { to: '/owner/activity', label: 'Activity log', icon: ScrollText },
]

function OwnerShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [owner, setOwner] = useState<{ name: string; email: string } | null>(null)
  const [checked, setChecked] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    ownerApi.me().then((r) => setOwner(r.owner)).catch(() => setOwner(null)).finally(() => setChecked(true))
  }, [])
  useEffect(() => { setNavOpen(false); setMenuOpen(false) }, [pathname])
  const routes = useRoutes([
    // Relative to /owner (this screen is mounted at /owner/*).
    { index: true, element: <OwnerHomePage /> },
    { path: 'companies', element: <CompaniesPage /> },
    { path: 'companies/:id', element: <CompanyPage /> },
    { path: 'support', element: <SupportPage /> },
    { path: 'support/:id', element: <TicketPage /> },
    { path: 'switches', element: <SwitchesPage /> },
    { path: 'activity', element: <ActivityPage /> },
    { path: '*', element: <Navigate to="/owner" replace /> },
  ])
  if (!checked) return <div className="flex h-screen items-center justify-center bg-bg"><Activity size={26} className="animate-pulse text-primary" /></div>
  if (!owner) return <Navigate to="/owner/login" replace />

  const signOut = async () => { await ownerApi.logout().catch(() => undefined); navigate('/owner/login', { replace: true }) }
  const initials = owner.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const here = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)))

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <div className={cn('fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden', navOpen ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={() => setNavOpen(false)} aria-hidden={!navOpen} />
      <div className={cn('fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')}>
        <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-sidebar">
          <div className="flex h-[52px] items-center gap-2 px-4">
            <img src={metriqLogo} alt="Metriq" className="h-[22px] w-auto dark:hidden" />
            <img src={metriqLogoDark} alt="Metriq" className="hidden h-[22px] w-auto dark:block" />
            <Badge tone="primary" className="ml-auto">Owner</Badge>
          </div>
          <nav className="flex-1 overflow-y-auto px-2.5 pb-3 pt-2">
            <p className="flex h-6 items-center px-2 text-[11.5px] font-medium text-ink-faint">Owner console</p>
            <ul className="space-y-px">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink to={n.to} end={n.end} className={({ isActive }) => cn('flex h-[34px] items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors', isActive ? 'bg-slate-200/70 font-medium text-ink' : 'text-ink-muted hover:bg-slate-200/45 hover:text-ink')}>
                    <n.icon size={16} className="shrink-0" />{n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="border-t border-line p-3">
            <div className="flex items-center gap-2.5 px-1">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary">{initials}</span>
              <div className="min-w-0"><p className="truncate text-[13px] font-medium text-ink">{owner.name}</p><p className="truncate text-[12px] text-ink-muted">Metriq owner</p></div>
            </div>
          </div>
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-bg/85 px-2.5 backdrop-blur-md sm:px-4">
          <button onClick={() => setNavOpen((o) => !o)} className="rounded-btn p-1.5 text-ink-muted hover:bg-slate-100 hover:text-ink lg:hidden" aria-label="Open menu"><Menu size={18} /></button>
          <span className="text-[13.5px] font-medium text-ink">{here?.label ?? 'Owner console'}</span>
          <div className="relative ml-auto">
            <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-2 rounded-btn p-1 pr-1.5 hover:bg-slate-100" aria-label="Owner menu">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11.5px] font-semibold text-primary">{initials}</span>
              <span className="hidden text-left sm:block"><span className="block text-[13px] font-medium leading-4 text-ink">{owner.name}</span><span className="block text-[11.5px] leading-4 text-ink-muted">Owner</span></span>
              <ChevronDown size={14} className="text-ink-muted" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 overflow-hidden rounded-card border border-line bg-card shadow-overlay">
                <div className="border-b border-line px-4 py-3"><p className="text-body-sm font-semibold text-ink">{owner.name}</p><p className="truncate text-body-sm text-ink-muted">{owner.email}</p></div>
                <button onClick={signOut} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-body-sm text-ink hover:bg-slate-50"><LogOut size={15} className="text-ink-muted" />Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto overscroll-contain p-4 sm:px-8 sm:py-7">{routes}</main>
      </div>
    </div>
  )
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const reload = useCallback(() => load().then((d) => { setData(d); setError('') }).catch((e) => {
    if (e instanceof OwnerApiError && e.status === 401) navigate('/owner/login', { replace: true })
    else setError(ownerErr(e, 'Could not load.'))
  }), deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reload() }, [reload])
  return { data, error, reload, setData }
}

function Title({ children, sub, back }: { children: ReactNode; sub?: ReactNode; back?: string }) {
  return (
    <div className="mb-6">
      {back && <Link to={back} className="mb-2 inline-flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink"><ArrowLeft size={14} />Back</Link>}
      <h1 className="text-headline-lg text-ink">{children}</h1>
      {sub && <p className="mt-0.5 text-body-md text-ink-muted">{sub}</p>}
    </div>
  )
}
const Panel = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={'rounded-card border border-line bg-card shadow-card ' + className}>{children}</div>
const PanelHead = ({ title, action }: { title: ReactNode; action?: ReactNode }) => (
  <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5"><h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>{action}</div>
)
const Empty = ({ children }: { children: ReactNode }) => <p className="px-5 py-12 text-center text-body-md text-ink-muted">{children}</p>
const Loading = ({ error }: { error?: string }) => (error ? <p className="text-body-md text-ink-muted">{error}</p> : <div className="flex h-64 items-center justify-center"><Activity size={26} className="animate-pulse text-primary" /></div>)

// ------------------------------------------------------------------ home

function OwnerHomePage() {
  const { data, error } = useLoad<OwnerHome>(() => ownerApi.home())
  const companies = useLoad(() => ownerApi.companies())
  if (!data) return <Loading error={error} />
  const c = data.counts
  return (
    <>
      <Title sub="Every company on Metriq, their complaints and their health.">Home</Title>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard to="/owner/companies" label="Companies" value={c.companies} caption={c.trials ? `${c.trials} on trial` : 'Using Metriq'} icon={<Building2 size={16} />} />
        <StatCard to="/owner/companies" label="People" value={c.people} caption="Active accounts" icon={<Users size={16} />} />
        <StatCard to="/owner/companies" label="Checked in today" value={c.inToday} caption="Across all companies" icon={<UserCheck size={16} />} />
        <StatCard to="/owner/support" label="Open complaints" value={c.openTickets} caption={c.urgentTickets ? `${c.urgentTickets} high or urgent` : 'Nothing urgent'}
          icon={<LifeBuoy size={16} />} valueClassName={cn('text-metric-lg', c.urgentTickets > 0 && 'text-warning')} />
        <StatCard label="Errors in 24 hours" value={c.errors24h} caption={c.errors24h ? 'See System Health' : 'All clear'} icon={<Bug size={16} />}
          valueClassName={cn('text-metric-lg', c.errors24h > 0 && 'text-danger')} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHead title="Complaints waiting" action={<Link to="/owner/support" className="text-body-sm font-semibold text-primary hover:underline">See all</Link>} />
          {data.tickets.length === 0 ? <Empty>No open complaints. When a company sends one from its Help button, it shows here.</Empty> : (
            <ul className="divide-y divide-line">
              {data.tickets.map((t) => (
                <li key={t.id}><Link to={`/owner/support/${t.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50">
                  <span className="w-9 shrink-0 text-body-sm tabular-nums text-ink-muted">#{t.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-md font-medium text-ink">{t.subject}</span>
                    <span className="block truncate text-body-sm text-ink-muted">{t.company} · {fmt(t.updatedAt)}</span>
                  </span>
                  <Badge tone={PRIORITY_TONE[t.priority]} className="hidden sm:inline-flex">{PRIORITY_LABEL[t.priority]}</Badge>
                  <Badge tone={STATUS_TONE[t.status]} className="shrink-0">{STATUS_LABEL[t.status]}</Badge>
                </Link></li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHead title="Companies" action={<Link to="/owner/companies" className="text-body-sm font-semibold text-primary hover:underline">Open</Link>} />
            {!companies.data ? <Empty>Loading…</Empty> : (
              <ul className="divide-y divide-line">
                {companies.data.companies.map((co) => (
                  <li key={co.id}><Link to={`/owner/companies/${co.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-primary/10 text-body-sm font-semibold text-primary">{co.name.slice(0, 2).toUpperCase()}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-body-md font-medium text-ink">{co.name}</span><span className="block text-body-sm text-ink-muted">{co.kind === 'PERSONAL' ? 'Individual' : `${co.people} people`}{co.openTickets ? ` · ${co.openTickets} open` : ''}</span></span>
                    <Badge tone={COMPANY_TONE[co.status]}>{co.status === 'TRIAL' ? 'Trial' : co.status === 'ACTIVE' ? 'Active' : 'Suspended'}</Badge>
                  </Link></li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel>
            <PanelHead title="Owner sign in alerts" action={<span className="text-body-sm text-ink-muted">Last 7 days</span>} />
            {data.signInAlerts.length === 0 ? <Empty>No wrong tries.</Empty> : (
              <ul className="divide-y divide-line">
                {data.signInAlerts.map((a, i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3 text-body-sm">
                    <AlertTriangle size={16} className={a.action === 'LOCKED' ? 'text-danger' : 'text-warning'} />
                    <span className="min-w-0 flex-1 text-ink">{a.action === 'LOCKED' ? 'Locked after 5 wrong tries' : 'Wrong password or code'}{a.ip ? <span className="text-ink-muted"> · {a.ip}</span> : null}</span>
                    <span className="shrink-0 text-ink-muted">{fmt(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}

// ------------------------------------------------------------------ companies

function CompaniesPage() {
  const { data, error } = useLoad(() => ownerApi.companies())
  if (!data) return <Loading error={error} />
  return (
    <>
      <Title sub="Every company and every individual using Metriq. New ones appear here once sign up is switched on.">Companies</Title>
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-body-md">
          <thead><tr className="border-b border-line text-left text-label-md uppercase text-ink-muted">
            <th className="px-5 py-3">Company</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Plan</th>
            <th className="px-3 py-2.5 text-right">People</th><th className="px-3 py-2.5 text-right">In today</th><th className="px-3 py-2.5">Last active</th><th className="px-5 py-3 text-right">Open complaints</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {data.companies.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-5 py-4"><Link to={`/owner/companies/${c.id}`} className="font-medium text-ink hover:text-primary">{c.name}</Link>{c.home && <span className="ml-2 text-[12px] text-ink-muted">company 1</span>}</td>
                <td className="px-3 py-4 text-ink-muted">{c.kind === 'PERSONAL' ? 'Individual' : 'Team'}</td>
                <td className="px-3 py-4"><Badge tone={COMPANY_TONE[c.status]}>{c.status === 'TRIAL' ? 'Trial' : c.status === 'ACTIVE' ? 'Active' : 'Suspended'}</Badge></td>
                <td className="px-3 py-4 capitalize text-ink-muted">{c.plan}</td>
                <td className="px-3 py-4 text-right tabular-nums">{c.people}</td>
                <td className="px-3 py-4 text-right tabular-nums">{c.inToday}</td>
                <td className="px-3 py-4 text-ink-muted">{fmt(c.lastActiveAt)}</td>
                <td className="px-5 py-4 text-right tabular-nums">{c.openTickets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  )
}

function CompanyPage() {
  const { id = '' } = useParams()
  const { addToast } = useToast()
  const { data, error, setData } = useLoad(() => ownerApi.company(id), [id])
  const [busy, setBusy] = useState(false)
  if (!data) return <Loading error={error} />
  const c = data.company
  async function patch(input: Parameters<typeof ownerApi.updateCompany>[1], ok: string) {
    setBusy(true)
    try { await ownerApi.updateCompany(c.id, input); setData(await ownerApi.company(c.id)); addToast({ type: 'success', message: ok }) }
    catch (e) { addToast({ type: 'error', message: ownerErr(e) }) } finally { setBusy(false) }
  }
  const u = data.usage
  return (
    <>
      <Title back="/owner/companies" sub={c.home ? 'Company 1: the team Metriq was built with. It always stays active and is never billed.' : `Joined ${fmt(c.createdAt)}`}>{c.name}</Title>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[['People', c.people], ['Checked in today', c.inToday], ['Open complaints', c.openTickets], ['Plan', c.plan]].map(([l, v]) => (
          <Panel key={String(l)} className="p-5"><p className="text-[13px] font-medium text-ink-muted">{l}</p><p className="mt-2.5 text-metric-lg capitalize tabular-nums text-ink">{v}</p></Panel>
        ))}
      </div>
      <Panel className="mt-6 divide-y divide-line">
        <div className="flex flex-wrap items-center gap-4 px-5 py-5">
          <div className="min-w-0 flex-1">
            <p className="text-body-md font-semibold text-ink">Help button</p>
            <p className="text-body-sm text-ink-muted">{c.helpEnabled ? 'On: their people can send complaints and questions to you from inside Metriq.' : 'Off: their people do not see a Help button.'}</p>
          </div>
          <Button size="sm" variant={c.helpEnabled ? 'secondary' : 'primary'} disabled={busy} onClick={() => patch({ helpEnabled: !c.helpEnabled }, c.helpEnabled ? 'Help button switched off.' : 'Help button switched on.')}>
            {c.helpEnabled ? 'Switch off' : 'Switch on'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-4 px-5 py-5">
          <div className="min-w-0 flex-1">
            <p className="text-body-md font-semibold text-ink">Status</p>
            <p className="text-body-sm text-ink-muted">{c.home ? '99 Technologies cannot be suspended.' : c.status === 'SUSPENDED' ? 'Suspended: nobody in this company can sign in.' : 'Active.'}</p>
          </div>
          {!c.home && (
            <Button size="sm" variant={c.status === 'SUSPENDED' ? 'primary' : 'danger'} disabled={busy}
              onClick={() => patch({ status: c.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' }, c.status === 'SUSPENDED' ? 'Reactivated.' : 'Suspended.')}>
              {c.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
            </Button>
          )}
        </div>
      </Panel>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHead title="Plan and what they use" />
          <div className="space-y-4 px-5 pb-5">
            <div className="flex flex-wrap items-center gap-3">
              <select className={inputCls + ' !w-auto'} value={c.plan} disabled={busy || c.home} onChange={(e) => patch({ plan: e.target.value }, 'Plan changed.')} aria-label="Plan">
                {data.plans.filter((p) => p.sellable || p.key === c.plan).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <span className="text-body-sm text-ink-muted">{c.home ? 'No limits, never billed.' : 'Billing changes this when they pay; you can set it by hand too.'}</span>
            </div>
            <Meter label="People" used={u.people.used} limit={u.people.limit} show={(n) => String(n)} />
            <Meter label="Files" used={u.storage.usedBytes} limit={u.storage.limitBytes} show={bytes} />
            <Meter label="AI meeting notes this month" used={u.aiHours.used} limit={u.aiHours.limit} show={(n) => `${n} h`} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Parts of Metriq" />
          <p className="-mt-1 px-5 pb-3 text-body-sm text-ink-muted">What comes with their plan, and parts you switched on or off for them.</p>
          <ul className="divide-y divide-line border-t border-line">
            {data.modules.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 text-body-md text-ink">{m.label}{m.byPlan && <span className="ml-2 text-[12px] text-ink-faint">not in plan</span>}</span>
                <Segmented disabled={busy} label={m.label}
                  value={m.set === null ? 'plan' : m.set}
                  options={[['plan', c.home ? 'On' : `Plan (${m.byPlan ? 'off' : 'on'})`], ['on', 'On'], ['off', 'Off']].filter(([v]) => !(c.home && v === 'on')) as [string, string][]}
                  onChange={(v) => patch({ module: { key: m.key, on: v === 'plan' ? null : v === 'on' } }, `${m.label} ${v === 'plan' ? 'follows the plan' : v === 'on' ? 'switched on' : 'switched off'}.`)} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <HelpSignIn company={c} people={data.people} />
      <CompanySwitches companyId={c.id} />
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHead title="Their complaints" />
          {data.tickets.length === 0 ? <Empty>None yet.</Empty> : (
            <ul className="divide-y divide-line">{data.tickets.map((t) => (
              <li key={t.id}><Link to={`/owner/support/${t.id}`} className="flex items-center gap-3 px-5 py-3.5 text-body-md hover:bg-slate-50">
                <span className="tabular-nums text-ink-muted">#{t.number}</span><span className="min-w-0 flex-1 truncate text-ink">{t.subject}</span><Badge tone={STATUS_TONE[t.status]} className="shrink-0">{STATUS_LABEL[t.status]}</Badge>
              </Link></li>
            ))}</ul>
          )}
        </Panel>
        <Panel>
          <PanelHead title="Changes made by you" />
          {data.activity.length === 0 ? <Empty>No changes yet.</Empty> : (
            <ul className="divide-y divide-line">{data.activity.map((a, i) => (
              <li key={i} className="flex gap-3 px-5 py-3 text-body-sm"><span className="w-28 shrink-0 text-ink-muted">{fmt(a.at)}</span><span className="text-ink">{describe(a.action, a.detail)}</span></li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </>
  )
}

const bytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

function Meter({ label, used, limit, show }: { label: string; used: number; limit: number | null; show: (n: number) => string }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-body-sm"><span className="text-ink">{label}</span><span className="tabular-nums text-ink-muted">{show(used)}{limit === null ? ' · no limit' : ` of ${show(limit)}`}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-primary')} style={{ width: `${limit === null ? 0 : Math.max(pct, used > 0 ? 2 : 0)}%` }} /></div>
    </div>
  )
}

/** Help sign-in: open their Metriq as one of their people, only while their Super Admin allows it. */
function HelpSignIn({ company, people }: { company: OwnerCompany; people: { id: string; name: string; email: string; role: string }[] }) {
  const { addToast } = useToast()
  const [userId, setUserId] = useState(people[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState('')
  async function go() {
    setBusy(true)
    try { const r = await ownerApi.helpSignIn(company.id, userId); window.location.assign(r.go) }
    catch (e) { addToast({ type: 'error', message: ownerErr(e) }); setBusy(false) }
  }
  async function remove() {
    setBusy(true)
    try { await ownerApi.removeCompany(company.id, confirm); addToast({ type: 'success', message: `${company.name} removed.` }); window.location.assign('/owner/companies') }
    catch (e) { addToast({ type: 'error', message: ownerErr(e) }); setBusy(false) }
  }
  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <Panel>
        <PanelHead title="Help sign-in" />
        <div className="space-y-3 px-5 pb-5">
          {company.supportAccessUntil ? (
            <>
              <p className="text-body-sm text-ink-muted">Allowed by their Super Admin until {fmt(company.supportAccessUntil)}. You see Metriq as that person, for at most an hour; they see a banner, and it is in their activity log. Finance stays closed.</p>
              <div className="flex flex-wrap gap-2">
                <select className={inputCls + ' !w-auto min-w-[220px]'} value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Person">
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role.replace('_', ' ').toLowerCase()})</option>)}
                </select>
                <Button size="sm" disabled={busy || !userId} onClick={go}>Open their Metriq</Button>
              </div>
            </>
          ) : <p className="text-body-sm text-ink-muted">Not allowed now. Their Super Admin can allow it for a day, three days or a week in Company settings, when they ask for help.</p>}
        </div>
      </Panel>
      <Panel>
        <PanelHead title="Their data" />
        <div className="space-y-4 px-5 pb-5">
          <div className="flex flex-wrap items-center gap-3">
            <a href={ownerApi.exportUrl(company.id)} download><Button size="sm" variant="secondary">Download all their data</Button></a>
            <span className="text-body-sm text-ink-muted">One file with every record (no passwords). Logged.</span>
          </div>
          {!company.home && (
            <div className="rounded-btn border border-danger/30 bg-danger/5 p-3">
              <p className="text-body-sm font-semibold text-danger">Remove {company.name}</p>
              <p className="mt-0.5 text-body-sm text-ink-muted">Everything they have in Metriq, files too, is gone for good. Download it first. Type the company name to remove it.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input className={inputCls + ' !h-9 max-w-[240px]'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={company.name} aria-label="Company name to confirm" />
                <Button size="sm" variant="danger" disabled={busy || confirm.trim() !== company.name} onClick={remove}>Remove for good</Button>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}

/** Switches for one company: follow the all-companies setting, or on / off just for them. */
function CompanySwitches({ companyId }: { companyId: string }) {
  const { addToast } = useToast()
  const { data, error, setData } = useLoad(() => ownerApi.companyFlags(companyId), [companyId])
  const [busy, setBusy] = useState<string | null>(null)
  async function set(f: CompanyFlag, enabled: boolean | null) {
    setBusy(f.key)
    try {
      const r = await ownerApi.setCompanyFlag(companyId, f.key, enabled)
      setData({ flags: r.flags })
      addToast({ type: 'success', message: enabled === null ? `${f.label} now follows the setting for all companies.` : `${f.label} ${enabled ? 'on' : 'off'} for this company. It takes effect within a minute.` })
    } catch (e) { addToast({ type: 'error', message: ownerErr(e) }) } finally { setBusy(null) }
  }
  return (
    <Panel className="mt-6">
      <PanelHead title="Switches for this company" />
      <p className="-mt-1 px-5 pb-3 text-body-sm text-ink-muted">Show a part of Metriq to this company and not to others. "All companies" follows the setting on the Switches page.</p>
      {!data ? <Loading error={error} /> : (
        <ul className="divide-y divide-line border-t border-line">
          {data.flags.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body-md font-semibold text-ink">{f.label}</p>
                  <Badge tone={f.enabled ? 'success' : 'danger'}>{f.enabled ? 'On' : 'Off'}</Badge>
                  {f.own !== null && <Badge tone="accent">Set for this company</Badge>}
                </div>
                <p className="mt-1 text-body-sm text-ink-muted">{f.description}</p>
              </div>
              <Segmented
                disabled={busy === f.key}
                value={f.own === null ? 'all' : f.own ? 'on' : 'off'}
                options={[['all', `All companies (${f.allCompanies ? 'on' : 'off'})`], ['on', 'On'], ['off', 'Off']]}
                onChange={(v) => set(f, v === 'all' ? null : v === 'on')}
                label={f.label}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-btn border border-line bg-slate-50 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled || value === v} onClick={() => onChange(v)}
          className={cn('rounded-[6px] px-3 py-1.5 text-body-sm font-medium transition-colors disabled:cursor-default', value === v ? 'bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}>
          {l}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ support

function SupportPage() {
  const [filter, setFilter] = useState('open')
  const { data, error } = useLoad(() => ownerApi.tickets(filter), [filter])
  return (
    <>
      <Title sub="Complaints and questions sent from the Help button inside each company's Metriq.">Support</Title>
      <div className="mb-3 flex flex-wrap gap-1">
        {([['open', 'Open'], ['OPEN', 'New'], ['IN_PROGRESS', 'Working on it'], ['WAITING_ON_COMPANY', 'Waiting for them'], ['RESOLVED', 'Solved'], ['all', 'All']] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFilter(v)} className={'rounded-full px-3 py-1.5 text-body-sm font-medium ' + (filter === v ? 'bg-ink text-card' : 'bg-slate-100 text-ink-muted hover:bg-slate-200')}>{l}</button>
        ))}
      </div>
      {!data ? <Loading error={error} /> : (
        <Panel>
          {data.tickets.length === 0 ? <Empty>Nothing here.</Empty> : (
            <ul className="divide-y divide-line">
              {data.tickets.map((t: TicketRow) => (
                <li key={t.id}><Link to={`/owner/support/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-slate-50">
                  <span className="text-body-sm tabular-nums text-ink-muted">#{t.number}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-body-md font-medium text-ink">{t.subject}</span>
                    <span className="text-body-sm text-ink-muted">{t.company.name} · {t.userName} · {fmt(t.updatedAt)}{t.replies ? ` · ${t.replies} ${t.replies === 1 ? 'message' : 'messages'}` : ''}</span></span>
                  <Badge tone={PRIORITY_TONE[t.priority]} className="hidden sm:inline-flex">{PRIORITY_LABEL[t.priority]}</Badge>
                  <Badge tone={STATUS_TONE[t.status]} className="shrink-0">{STATUS_LABEL[t.status]}</Badge>
                </Link></li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  )
}

function TicketPage() {
  const { id = '' } = useParams()
  const { addToast } = useToast()
  const { data, error, setData } = useLoad(() => ownerApi.ticket(id), [id])
  const [reply, setReply] = useState('')
  const [solve, setSolve] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!data) return <Loading error={error} />
  const t: TicketDetail = data.ticket
  async function send() {
    if (!reply.trim()) return
    setBusy(true)
    try { const r = await ownerApi.reply(t.id, reply.trim(), solve ? 'RESOLVED' : undefined); setData(r); setReply(''); setSolve(false); addToast({ type: 'success', message: 'Reply sent. They see it in their bell.' }) }
    catch (e) { addToast({ type: 'error', message: ownerErr(e) }) } finally { setBusy(false) }
  }
  async function change(input: { status?: TicketStatus; priority?: TicketPriority }) {
    try { setData(await ownerApi.updateTicket(t.id, input)) } catch (e) { addToast({ type: 'error', message: ownerErr(e) }) }
  }
  return (
    <>
      <Title back="/owner/support" sub={<>#{t.number} · {t.company.name} · {t.userName} ({t.userEmail}) · {fmt(t.createdAt)}</>}>{t.subject}</Title>
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <Panel className="p-4"><p className="whitespace-pre-wrap text-body-md text-ink">{t.body}</p></Panel>
          {t.messages.map((m) => (
            <div key={m.id} className={'rounded-card border p-4 ' + (m.fromOwner ? 'ml-8 border-primary/20 bg-primary/5' : 'mr-8 border-line bg-card')}>
              <p className="mb-1 text-body-sm text-ink-muted"><span className="font-semibold text-ink">{m.authorName}</span> · {fmt(m.createdAt)}</p>
              <p className="whitespace-pre-wrap text-body-md text-ink">{m.body}</p>
            </div>
          ))}
          <Panel className="p-4">
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} placeholder="Write your reply…" className={inputCls + ' h-auto py-2'} aria-label="Reply" />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-body-sm text-ink"><input type="checkbox" checked={solve} onChange={(e) => setSolve(e.target.checked)} />Mark as solved</label>
              <Button className="ml-auto" size="sm" onClick={send} disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send reply'}</Button>
            </div>
          </Panel>
        </div>
        <div className="space-y-3">
          <Panel className="space-y-3 p-4">
            <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Status</span>
              <select aria-label="Status" className={inputCls} value={t.status} onChange={(e) => change({ status: e.target.value as TicketStatus })}>
                {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select></label>
            <label className="block"><span className="mb-1 block text-body-sm font-semibold text-ink">Priority</span>
              <select aria-label="Priority" className={inputCls} value={t.priority} onChange={(e) => change({ priority: e.target.value as TicketPriority })}>
                {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((s) => <option key={s} value={s}>{PRIORITY_LABEL[s]}</option>)}
              </select></label>
          </Panel>
          <Panel className="space-y-1 p-4 text-body-sm">
            <p className="font-semibold text-ink">Where they were</p>
            <p className="break-all text-ink-muted">{t.pageUrl ?? '—'}</p>
            <p className="pt-2 font-semibold text-ink">Browser</p>
            <p className="break-all text-ink-muted">{t.userAgent ?? '—'}</p>
          </Panel>
          <Panel className="p-4 text-body-sm">
            <p className="mb-2 font-semibold text-ink">Errors they hit (24 hours before)</p>
            {t.errors.length === 0 ? <p className="text-ink-muted">None recorded.</p> : (
              <ul className="space-y-2">{t.errors.map((e) => (
                <li key={e.id}><p className="text-ink">{e.message}</p><p className="text-ink-muted">{e.route ?? e.source} · {e.count}× · {e.state === 'RESOLVED' ? 'fixed' : 'open'}</p></li>
              ))}</ul>
            )}
            <a href="/app/admin/health" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-primary">System Health <ExternalLink size={12} /></a>
          </Panel>
        </div>
      </div>
    </>
  )
}

// ------------------------------------------------------------------ activity

const ACTIONS: Record<string, string> = {
  LOGIN: 'Signed in', LOGOUT: 'Signed out', LOGIN_FAILED: 'Wrong password or code', LOCKED: 'Sign in locked (5 wrong tries)',
  OWNER_CREATED: 'Owner account created', PASSWORD_CHANGED: 'Password changed', CODE_RESET: 'Authenticator key changed', UNLOCKED: 'Sign in unlocked',
  COMPANY_UPDATE: 'Company changed', TICKET_REPLY: 'Replied to a complaint', TICKET_UPDATE: 'Complaint updated',
  SWITCH: 'Switch changed', CODE_OFF: 'Phone code switched off',
}
function describe(action: string, detail: unknown): string {
  const base = ACTIONS[action] ?? action
  const d = detail as { after?: Record<string, unknown> } | null
  const sw = detail as { key?: string; after?: unknown } | null
  if (action === 'SWITCH' && sw && typeof sw.after === 'boolean') return `${base}: ${sw.after ? 'on' : 'off'}`
  if (action === 'COMPANY_UPDATE' && d?.after) {
    return `${base}: ${Object.entries(d.after).map(([k, v]) => (k === 'helpEnabled' ? `Help button ${v ? 'on' : 'off'}` : `${k} ${String(v)}`)).join(', ')}`
  }
  return base
}

function ActivityPage() {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => { const t = window.setTimeout(() => setTerm(q), 300); return () => window.clearTimeout(t) }, [q])
  const { data, error } = useLoad(() => ownerApi.activity(term), [term])
  const rows = useMemo(() => data?.activity ?? [], [data])
  return (
    <>
      <Title sub="Every owner sign in and every change made from this console, kept for good.">Activity log</Title>
      <div className="relative mb-3 max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action, company or address…" className={inputCls + ' pl-9'} />
      </div>
      {!data ? <Loading error={error} /> : (
        <Panel className="overflow-x-auto">
          {rows.length === 0 ? <Empty>Nothing yet.</Empty> : (
            <table className="w-full min-w-[640px] text-body-md">
              <thead><tr className="border-b border-line text-left text-label-md uppercase text-ink-muted"><th className="px-5 py-3">When</th><th className="px-3 py-2.5">What</th><th className="px-3 py-2.5">Company</th><th className="px-3 py-2.5">On</th><th className="px-5 py-3">Address</th></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((a: ActivityRow) => (
                  <tr key={a.id}><td className="whitespace-nowrap px-5 py-3.5 text-ink-muted">{fmt(a.at)}</td><td className="px-3 py-3.5 text-ink">{describe(a.action, a.detail)}</td>
                    <td className="px-3 py-3.5 text-ink-muted">{a.company ?? '—'}</td><td className="px-3 py-3.5 text-ink-muted">{a.target ?? '—'}</td><td className="px-5 py-3.5 tabular-nums text-ink-muted">{a.ip ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </>
  )
}

// ------------------------------------------------------------------ switches

function SwitchesPage() {
  const { addToast } = useToast()
  const { data, error, setData } = useLoad(() => ownerApi.flags())
  const [busy, setBusy] = useState<string | null>(null)
  async function flip(f: OwnerFlag, enabled: boolean) {
    if (f.key === 'company-walls' && !enabled && !window.confirm('Turn the company walls off? Every company would see every other company\'s records. Only do this in an emergency while 99 Technologies is the only company.')) return
    setBusy(f.key)
    try { setData(await ownerApi.setFlag(f.key, enabled)); addToast({ type: 'success', message: `${f.label} ${enabled ? 'switched on' : 'switched off'}. It takes effect within a minute.` }) }
    catch (e) { addToast({ type: 'error', message: ownerErr(e) }) } finally { setBusy(null) }
  }
  return (
    <>
      <Title sub="Turn a part of Metriq on or off in seconds, with no deploy. The switch here is for all companies; to show a part to some companies and not others, set it on the company's page.">Switches</Title>
      {!data ? <Loading error={error} /> : (
        <Panel className="divide-y divide-line">
          {data.flags.map((f) => (
            <div key={f.key} className="flex items-start gap-4 px-5 py-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body-md font-semibold text-ink">{f.label}</p>
                  <Badge tone={f.enabled ? 'success' : 'danger'}>{f.enabled ? 'On' : 'Off'}</Badge>
                  {f.scope === 'platform' && <Badge tone="neutral">Whole of Metriq</Badge>}
                </div>
                <p className="mt-1 text-body-sm text-ink-muted">{f.description}</p>
                <p className="mt-1.5 text-[12px] text-ink-faint">{f.isDefault ? `Never changed (${f.defaultValue ? 'on' : 'off'} by default)` : `Last changed ${fmt(f.updatedAt)}${f.updatedBy ? ` by ${f.updatedBy}` : ''}`}</p>
                {f.overrides.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-body-sm">
                    <span className="text-ink-muted">Set differently for</span>
                    {f.overrides.map((o) => (
                      <Link key={o.companyId} to={`/owner/companies/${o.companyId}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-slate-50 px-2.5 py-0.5 text-ink hover:border-primary/40">
                        {o.companyName}<span className={o.enabled ? 'text-success' : 'text-danger'}>{o.enabled ? 'on' : 'off'}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 pt-1">
                <Toggle checked={f.enabled} disabled={busy === f.key} onChange={(v) => flip(f, v)} label={`${f.label} for all companies`} />
                <span className="text-[12px] text-ink-faint">{f.scope === 'platform' ? 'Everywhere' : 'All companies'}</span>
              </div>
            </div>
          ))}
        </Panel>
      )}
    </>
  )
}
