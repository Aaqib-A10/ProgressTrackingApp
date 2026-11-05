import { prisma } from '../prisma'

/**
 * How the Call buttons dial. Metriq cannot place a call itself (TalkLoop has no originate endpoint
 * yet), so a Call button is a link the SDR's phone app on the PC opens: `tel:` for most softphones,
 * `sip:` for ones registered straight to the PBX, or a custom URL for an app with its own scheme.
 * One setting per company, kept by the Super Admin in Lead Settings → TalkLoop.
 */
export type DialScheme = 'tel' | 'sip' | 'callto' | 'custom'
export interface DialSetting { scheme: DialScheme; domain: string | null; template: string | null }
const DEFAULT: DialSetting = { scheme: 'tel', domain: null, template: null }
const key = (companyId: string) => `dial:${companyId}`

export async function dialSetting(companyId: string): Promise<DialSetting> {
  const row = await prisma.platformSetting.findUnique({ where: { key: key(companyId) } }).catch(() => null)
  return { ...DEFAULT, ...((row?.value as Partial<DialSetting> | null) ?? {}) }
}
export async function saveDialSetting(companyId: string, s: DialSetting): Promise<void> {
  await prisma.platformSetting.upsert({ where: { key: key(companyId) }, update: { value: s as object }, create: { key: key(companyId), value: s as object } })
}
