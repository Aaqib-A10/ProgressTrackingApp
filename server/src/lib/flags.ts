import { prisma } from './prisma'

/**
 * On/off switches (Phase 1, step 1: safety net). Every new part that could disturb 99
 * Technologies gets a switch here; the owner flips it in the owner console (Switches) and it
 * takes effect within seconds, everywhere, with no deploy. Off = the part behaves as if it
 * did not exist.
 */
export const FLAGS = {
  'silent-updates': {
    label: 'Silent updates',
    description: 'Open tabs pick up a new version by themselves after a deploy. Off: tabs keep the version they opened with until someone reloads.',
    default: true,
    client: true,
  },
  'help-button': {
    label: 'Help button (all companies)',
    description: 'People can send complaints and questions to support. Off: hidden for every company, whatever its own setting.',
    default: true,
    client: true,
  },
  'break-cutoff': {
    label: 'Break cut-off',
    description: 'A break left running past its limit is ended by itself, with an alert. Off: breaks run until someone ends them.',
    default: true,
    client: false,
  },
  'dialer-sync': {
    label: 'Predictive dialer sync',
    description: 'Call results from the predictive dialer update the matching lead. Off: the dialer link refuses messages (the dialer can resend later).',
    default: true,
    client: false,
  },
} as const

export type FlagKey = keyof typeof FLAGS
export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[]

const CACHE_MS = 15_000
let cache: { at: number; values: Map<string, boolean> } | null = null

async function load(): Promise<Map<string, boolean>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values
  const rows = await prisma.featureFlag.findMany({ select: { key: true, enabled: true } })
  cache = { at: Date.now(), values: new Map(rows.map((r) => [r.key, r.enabled])) }
  return cache.values
}

/** Is this part switched on? Fails open to the default if the database cannot be read. */
export async function isOn(key: FlagKey): Promise<boolean> {
  try {
    const v = (await load()).get(key)
    return v ?? FLAGS[key].default
  } catch {
    return FLAGS[key].default
  }
}

export async function allFlags(): Promise<{ key: FlagKey; label: string; description: string; enabled: boolean; isDefault: boolean; updatedAt: string | null; updatedBy: string | null }[]> {
  const rows = new Map((await prisma.featureFlag.findMany()).map((r) => [r.key, r]))
  return FLAG_KEYS.map((key) => {
    const r = rows.get(key)
    return {
      key, label: FLAGS[key].label, description: FLAGS[key].description,
      enabled: r?.enabled ?? FLAGS[key].default, isDefault: !r,
      updatedAt: r?.updatedAt.toISOString() ?? null, updatedBy: r?.updatedBy ?? null,
    }
  })
}

export async function setFlag(key: FlagKey, enabled: boolean, by: string): Promise<void> {
  await prisma.featureFlag.upsert({ where: { key }, update: { enabled, updatedBy: by }, create: { key, enabled, updatedBy: by } })
  cache = null
}

/** The switches the web app reads (GET /api/flags). */
export async function clientFlags(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  for (const key of FLAG_KEYS) if (FLAGS[key].client) out[key] = await isOn(key)
  return out
}

/** Tests only. */
export function resetFlagCache(): void { cache = null }
