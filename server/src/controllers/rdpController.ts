import type { Response } from 'express'
import { z } from 'zod'
import type { Prisma, RdpTeam } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { AuthedRequest } from '../middleware/auth'

type Me = { id: string; role: string; department: { type: string } | null }

function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, include: { department: true } })
}

/** RDP records are managed by the Ecommerce HOD and Super Admin. */
function canManage(me: Me): boolean {
  return me.role === 'SUPER_ADMIN' || (me.role === 'TEAM_LEAD' && me.department?.type === 'ECOMMERCE')
}

async function guard(req: AuthedRequest, res: Response): Promise<Me | null> {
  const me = await loadUser(req.user!.id)
  if (!canManage(me)) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return me
}

const TEAMS: RdpTeam[] = ['EC', 'CSR', 'SHIPPING']

type RdpWithAssignments = Prisma.RdpGetPayload<{ include: { assignments: true } }>

function serialize(rdp: RdpWithAssignments) {
  const active = rdp.assignments.filter((a) => !a.unassignedAt)
  const everyone = new Set(rdp.assignments.map((a) => a.agentName))
  return {
    id: rdp.id,
    team: rdp.team,
    provider: rdp.provider,
    address: rdp.address,
    label: rdp.label ?? '',
    notes: rdp.notes ?? '',
    active: rdp.active,
    currentAgents: active.map((a) => a.agentName).sort((a, b) => a.localeCompare(b)),
    totalAgents: everyone.size,
    assignmentCount: rdp.assignments.length,
  }
}

/** GET /api/rdp?team=&provider=&search=&status= */
export async function listRdps(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  const team = req.query.team as RdpTeam | undefined
  const provider = req.query.provider as string | undefined
  const status = req.query.status as 'active' | 'retired' | undefined
  const search = (req.query.search as string)?.trim()

  const where: Prisma.RdpWhereInput = {}
  if (team && TEAMS.includes(team)) where.team = team
  if (provider) where.provider = provider
  if (status === 'active') where.active = true
  if (status === 'retired') where.active = false
  if (search) {
    where.OR = [
      { address: { contains: search, mode: 'insensitive' } },
      { provider: { contains: search, mode: 'insensitive' } },
      { label: { contains: search, mode: 'insensitive' } },
      { assignments: { some: { agentName: { contains: search, mode: 'insensitive' } } } },
    ]
  }

  const rdps = await prisma.rdp.findMany({
    where,
    include: { assignments: true },
    orderBy: [{ team: 'asc' }, { provider: 'asc' }, { address: 'asc' }],
  })
  const providers = await prisma.rdp.findMany({ distinct: ['provider'], select: { provider: true }, orderBy: { provider: 'asc' } })

  res.json({
    rdps: rdps.map(serialize),
    providers: providers.map((p) => p.provider),
    teams: TEAMS,
  })
}

/** GET /api/rdp/:id — one RDP with its full assignment history. */
export async function getRdp(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  const rdp = await prisma.rdp.findUnique({
    where: { id: req.params.id },
    include: { assignments: { orderBy: [{ unassignedAt: 'asc' }, { assignedAt: 'desc' }] } },
  })
  if (!rdp) {
    res.status(404).json({ error: 'RDP not found' })
    return
  }
  res.json({
    rdp: serialize(rdp),
    assignments: rdp.assignments.map((a) => ({
      id: a.id,
      agentName: a.agentName,
      assignedAt: a.assignedAt.toISOString(),
      unassignedAt: a.unassignedAt?.toISOString() ?? null,
      note: a.note ?? '',
      active: !a.unassignedAt,
    })),
  })
}

const rdpSchema = z.object({
  team: z.enum(['EC', 'CSR', 'SHIPPING']),
  provider: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(80),
  label: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
})

/** POST /api/rdp — create a new RDP. */
export async function createRdp(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  const parsed = rdpSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const exists = await prisma.rdp.findUnique({ where: { provider_address: { provider: parsed.data.provider, address: parsed.data.address } } })
  if (exists) {
    res.status(409).json({ error: 'An RDP with this provider + address already exists.' })
    return
  }
  const rdp = await prisma.rdp.create({ data: parsed.data, include: { assignments: true } })
  res.status(201).json({ rdp: serialize(rdp) })
}

/** PATCH /api/rdp/:id — edit fields or retire (active:false). */
export async function updateRdp(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  const patch = z
    .object({
      team: z.enum(['EC', 'CSR', 'SHIPPING']).optional(),
      provider: z.string().trim().min(1).max(80).optional(),
      address: z.string().trim().min(1).max(80).optional(),
      label: z.string().trim().max(120).nullable().optional(),
      notes: z.string().trim().max(1000).nullable().optional(),
      active: z.boolean().optional(),
    })
    .safeParse(req.body)
  if (!patch.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }
  const rdp = await prisma.rdp.update({ where: { id: req.params.id }, data: patch.data, include: { assignments: true } })
  res.json({ rdp: serialize(rdp) })
}

/** DELETE /api/rdp/:id — remove an RDP and its history. */
export async function deleteRdp(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  await prisma.rdp.delete({ where: { id: req.params.id } }).catch(() => undefined)
  res.status(204).end()
}

const assignSchema = z.object({ agentName: z.string().trim().min(1).max(120), note: z.string().trim().max(300).optional() })

/** POST /api/rdp/:id/assign — start an assignment (agent begins using this RDP). */
export async function assignAgent(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  const parsed = assignSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Agent name is required.' })
    return
  }
  const rdp = await prisma.rdp.findUnique({ where: { id: req.params.id } })
  if (!rdp) {
    res.status(404).json({ error: 'RDP not found' })
    return
  }
  const dupe = await prisma.rdpAssignment.findFirst({ where: { rdpId: rdp.id, agentName: parsed.data.agentName, unassignedAt: null } })
  if (dupe) {
    res.status(409).json({ error: 'That agent is already assigned to this RDP.' })
    return
  }
  await prisma.rdpAssignment.create({ data: { rdpId: rdp.id, agentName: parsed.data.agentName, note: parsed.data.note ?? null } })
  const full = await prisma.rdp.findUniqueOrThrow({ where: { id: rdp.id }, include: { assignments: true } })
  res.status(201).json({ rdp: serialize(full) })
}

/** POST /api/rdp/assignments/:id/end — end an active assignment (keeps the history row). */
export async function endAssignment(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  const a = await prisma.rdpAssignment.findUnique({ where: { id: req.params.id } })
  if (!a) {
    res.status(404).json({ error: 'Assignment not found' })
    return
  }
  if (!a.unassignedAt) await prisma.rdpAssignment.update({ where: { id: a.id }, data: { unassignedAt: new Date() } })
  res.status(204).end()
}

/** DELETE /api/rdp/assignments/:id — remove an assignment row entirely. */
export async function deleteAssignment(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  await prisma.rdpAssignment.delete({ where: { id: req.params.id } }).catch(() => undefined)
  res.status(204).end()
}

/** GET /api/rdp/agents — distinct agents with active/total RDP counts. */
export async function listAgents(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  const rows = await prisma.rdpAssignment.findMany({ include: { rdp: { select: { team: true } } } })
  const map = new Map<string, { name: string; active: number; total: number; teams: Set<string> }>()
  for (const a of rows) {
    const e = map.get(a.agentName) ?? { name: a.agentName, active: 0, total: 0, teams: new Set<string>() }
    e.total++
    if (!a.unassignedAt) e.active++
    e.teams.add(a.rdp.team)
    map.set(a.agentName, e)
  }
  const agents = [...map.values()]
    .map((e) => ({ name: e.name, active: e.active, total: e.total, teams: [...e.teams] }))
    .sort((a, b) => a.name.localeCompare(b.name))
  res.json({ agents })
}

/** GET /api/rdp/agent-history?name= — every RDP an agent has used (past + present). */
export async function agentHistory(req: AuthedRequest, res: Response): Promise<void> {
  if (!(await guard(req, res))) return
  const name = (req.query.name as string)?.trim()
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const rows = await prisma.rdpAssignment.findMany({
    where: { agentName: name },
    include: { rdp: true },
    orderBy: [{ unassignedAt: 'asc' }, { assignedAt: 'desc' }],
  })
  res.json({
    name,
    history: rows.map((a) => ({
      assignmentId: a.id,
      rdpId: a.rdpId,
      team: a.rdp.team,
      provider: a.rdp.provider,
      address: a.rdp.address,
      assignedAt: a.assignedAt.toISOString(),
      unassignedAt: a.unassignedAt?.toISOString() ?? null,
      active: !a.unassignedAt,
    })),
  })
}
