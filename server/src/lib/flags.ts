import { prisma } from './prisma'
import { refreshWalls } from './tenancy'

/**
 * On/off switches (Phase 1, step 1: safety net). Every new part that could disturb 99
 * Technologies gets a switch here; the owner flips it in the owner console (Switches) and it
 * takes effect within seconds, everywhere, with no deploy. Off = the part behaves as if it
 * did not exist.
 *
 * Company-wise: each switch has a setting for all companies, and the owner can set it
 * differently for one company (on for some, off for others). A company with no setting of
 * its own follows the all-companies one. `scope: 'platform'` switches are one setting for the
 * whole of Metriq and cannot be set per company.
 */
export const FLAGS = {
  'silent-updates': {
    label: 'Silent updates',
    description: 'Open tabs pick up a new version by themselves after a deploy. Off: tabs keep the version they opened with until someone reloads.',
    default: true,
    client: true,
    scope: 'company',
  },
  'help-button': {
    label: 'Help button',
    description: 'People can send complaints and questions to support. Off: hidden for every company, whatever its own setting.',
    default: true,
    client: true,
    scope: 'company',
  },
  'break-cutoff': {
    label: 'Break cut-off',
    description: 'A break left running past its limit is ended by itself, with an alert. Off: breaks run until someone ends them.',
    default: true,
    client: false,
    scope: 'company',
  },
  'dialer-sync': {
    label: 'Predictive dialer sync',
    description: 'Call results from the predictive dialer update the matching lead. Off: the dialer link refuses messages (the dialer can resend later).',
    default: true,
    client: false,
    scope: 'company',
  },
  'company-settings': {
    label: 'Company settings page',
    description: "The Super Admin's own page for the company name, time zone, departments and roles (Admin, Company Settings). Off for 99 Technologies until you want them to have it.",
    default: true,
    client: true,
    scope: 'company',
  },
  'daily-report': {
    label: 'Daily Report builder',
    description: "Build your own daily form (numbers, text, choices, ratings…) with targets, a team view, charts and a monthly report. Off for 99 Technologies until it has run a week next to their six daily logs.",
    default: true,
    client: true,
    scope: 'company',
  },
  'social-sign-in': {
    label: 'Sign in with Google and Microsoft',
    description: 'The Google and Microsoft buttons on the sign-in and sign-up pages work (when their keys are on the server). Off: the buttons show "coming soon" and nobody can sign in or sign up with them.',
    default: false,
    client: false,
    scope: 'platform',
  },
  'new-companies': {
    label: 'New companies can sign up',
    description: 'Anyone can start a free trial for a company or for themselves (the Start a free trial page, and Google or Microsoft sign up). Off: the page says Metriq is not open yet, and the sign-in page shows the old Sign up link as before.',
    default: false,
    client: false,
    scope: 'platform',
  },
  'company-walls': {
    label: 'Company walls',
    description: 'Each company sees only its own records. Off is an emergency brake for while 99 Technologies is the only company: every company would then see every other company\'s records. Never turn it off once other companies use Metriq.',
    default: true,
    client: false,
    scope: 'platform',
  },
} as const

export type FlagKey = keyof typeof FLAGS
export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[]
type FlagDef = { label: string; description: string; default: boolean; client: boolean; scope: 'company' | 'platform' }
const def = (key: FlagKey): FlagDef => FLAGS[key] as FlagDef

const CACHE_MS = 15_000
type Values = { all: Map<string, boolean>; byCompany: Map<string, boolean> }
let cache: { at: number; values: Values } | null = null
const ck = (key: string, companyId: string) => `${key}\u0000${companyId}`

async function load(): Promise<Values> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values
  const [rows, overrides] = await Promise.all([
    prisma.featureFlag.findMany({ select: { key: true, enabled: true } }),
    prisma.featureFlagCompany.findMany({ select: { key: true, companyId: true, enabled: true } }),
  ])
  const values = { all: new Map(rows.map((r) => [r.key, r.enabled])), byCompany: new Map(overrides.map((o) => [ck(o.key, o.companyId), o.enabled])) }
  cache = { at: Date.now(), values }
  return values
}

/**
 * Is this part switched on (for this company, when given)? The company's own setting wins;
 * otherwise the all-companies setting; otherwise the default. Fails open to the default if
 * the database cannot be read.
 */
export async function isOn(key: FlagKey, companyId?: string | null): Promise<boolean> {
  try {
    const v = await load()
    if (companyId && def(key).scope === 'company') {
      const own = v.byCompany.get(ck(key, companyId))
      if (own !== undefined) return own
    }
    return v.all.get(key) ?? def(key).default
  } catch {
    return def(key).default
  }
}

export type FlagOverride = { companyId: string; companyName: string; enabled: boolean; updatedAt: string; updatedBy: string | null }
export type FlagView = {
  key: FlagKey; label: string; description: string; scope: 'company' | 'platform'
  enabled: boolean; isDefault: boolean; defaultValue: boolean; updatedAt: string | null; updatedBy: string | null
  overrides: FlagOverride[]
}

export async function allFlags(): Promise<FlagView[]> {
  const [rows, overrides] = await Promise.all([
    prisma.featureFlag.findMany(),
    prisma.featureFlagCompany.findMany({ include: { company: { select: { name: true } } }, orderBy: { updatedAt: 'desc' } }),
  ])
  const byKey = new Map(rows.map((r) => [r.key, r]))
  return FLAG_KEYS.map((key) => {
    const r = byKey.get(key)
    return {
      key, label: def(key).label, description: def(key).description, scope: def(key).scope,
      enabled: r?.enabled ?? def(key).default, isDefault: !r, defaultValue: def(key).default,
      updatedAt: r?.updatedAt.toISOString() ?? null, updatedBy: r?.updatedBy ?? null,
      overrides: overrides.filter((o) => o.key === key).map((o) => ({ companyId: o.companyId, companyName: o.company.name, enabled: o.enabled, updatedAt: o.updatedAt.toISOString(), updatedBy: o.updatedBy })),
    }
  })
}

/** The all-companies setting. */
export async function setFlag(key: FlagKey, enabled: boolean, by: string): Promise<void> {
  await prisma.featureFlag.upsert({ where: { key }, update: { enabled, updatedBy: by }, create: { key, enabled, updatedBy: by } })
  cache = null
  if (key === 'company-walls') await refreshWalls(prisma)
}

export type CompanyFlagView = { key: FlagKey; label: string; description: string; enabled: boolean; own: boolean | null; allCompanies: boolean; updatedAt: string | null; updatedBy: string | null }

/** Every company-wise switch as this company sees it: its own setting (if any) and the result. */
export async function companyFlags(companyId: string): Promise<CompanyFlagView[]> {
  const [rows, own] = await Promise.all([
    prisma.featureFlag.findMany({ select: { key: true, enabled: true } }),
    prisma.featureFlagCompany.findMany({ where: { companyId } }),
  ])
  const all = new Map(rows.map((r) => [r.key, r.enabled]))
  const mine = new Map(own.map((o) => [o.key, o]))
  return FLAG_KEYS.filter((k) => def(k).scope === 'company').map((key) => {
    const allCompanies = all.get(key) ?? def(key).default
    const o = mine.get(key)
    return { key, label: def(key).label, description: def(key).description, enabled: o ? o.enabled : allCompanies, own: o ? o.enabled : null, allCompanies, updatedAt: o?.updatedAt.toISOString() ?? null, updatedBy: o?.updatedBy ?? null }
  })
}

/** One company's own setting. null = take it away (the company follows the all-companies setting again). */
export async function setCompanyFlag(key: FlagKey, companyId: string, enabled: boolean | null, by: string): Promise<void> {
  if (def(key).scope !== 'company') throw new Error('This switch is for the whole of Metriq and cannot be set per company')
  if (enabled === null) await prisma.featureFlagCompany.deleteMany({ where: { key, companyId } })
  else await prisma.featureFlagCompany.upsert({ where: { key_companyId: { key, companyId } }, update: { enabled, updatedBy: by }, create: { key, companyId, enabled, updatedBy: by } })
  cache = null
}

/** The switches the web app reads (GET /api/flags), as the signed-in person's company has them. */
export async function clientFlags(companyId?: string | null): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  for (const key of FLAG_KEYS) if (def(key).client) out[key] = await isOn(key, companyId)
  return out
}

/** Tests only. */
export function resetFlagCache(): void { cache = null }
