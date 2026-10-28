import type { CompanyKind } from '@prisma/client'
import { prisma } from './prisma'

/**
 * A new company (or a personal workspace for one person) signs up on its own (Phase 1,
 * step 7): the company, its own address (a short name: /c/<slug>), a 14-day free trial, and the
 * person who signed up as its Super Admin.
 */

export const TRIAL_DAYS = 14

export function slugify(name: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return s || 'company'
}

/** Words that cannot be a company's address (they are pages of Metriq). */
const RESERVED = new Set(['app', 'api', 'owner', 'login', 'start', 'signup', 'admin', 'help', 'support', 'billing', 'www', 'metriq', 'pulsetrack', 'c', 'guest', 'join'])

export async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name)
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 && !RESERVED.has(base) ? base : `${base}-${i + 1}`
    if (!(await prisma.company.findUnique({ where: { slug }, select: { id: true } }))) return slug
  }
  return `${base}-${Date.now().toString(36)}`
}

export async function createCompanyWithOwner(input: {
  mode: 'team' | 'solo'
  companyName?: string | null
  name: string
  email: string
  passwordHash: string | null
  googleId?: string | null
  verified: boolean
  timeZone?: string | null
}) {
  const kind: CompanyKind = input.mode === 'solo' ? 'PERSONAL' : 'TEAM'
  const companyName = input.mode === 'solo' ? `${input.name.split(' ')[0]}'s workspace` : (input.companyName ?? '').trim() || `${input.name.split(' ')[0]}'s company`
  const slug = await uniqueSlug(input.mode === 'solo' ? input.name : companyName)
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: companyName, slug, kind, status: 'TRIAL',
        plan: kind === 'PERSONAL' ? 'personal' : 'business',
        trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86400_000),
        timeZone: input.timeZone || 'Asia/Karachi',
        helpEnabled: true,
      },
    })
    const user = await tx.user.create({
      data: {
        companyId: company.id, name: input.name.trim(), email: input.email, passwordHash: input.passwordHash, googleId: input.googleId ?? null,
        role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true,
        emailVerifiedAt: input.verified ? now : null, emailCheckPending: !input.verified,
      },
    })
    return { company, user }
  })
}
