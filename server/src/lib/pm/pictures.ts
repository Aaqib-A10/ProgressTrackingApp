import { prisma } from '../prisma'

/**
 * Who may change a project channel's or group chat's picture, and the line that tells
 * everyone in the chat it changed ("Aqib changed this channel's picture").
 */

/** Leads can change the pictures of channels and groups they are in. */
const LEAD_ROLES = new Set(['TEAM_LEAD', 'SUB_DEPT_LEAD', 'QA_LEAD', 'SUPER_ADMIN'])

export async function canChangeProjectPicture(projectId: string, me: { id: string; role: string }): Promise<boolean> {
  if (me.role === 'SUPER_ADMIN') return true
  const pm = await prisma.pmProjectMember.findFirst({ where: { projectId, userId: me.id }, select: { role: true } })
  if (pm?.role === 'ADMIN') return true
  if (!LEAD_ROLES.has(me.role)) return false
  if (pm) return true
  // A lead who is in the project's chat (but not on the board) can change it too.
  return !!(await prisma.chatMember.findFirst({ where: { userId: me.id, conversation: { projectId } }, select: { id: true } }))
}

export function canChangeGroupPicture(conv: { type: string; createdById: string | null }, member: { isAdmin: boolean } | null, me: { id: string; role: string }): boolean {
  if (conv.type !== 'GROUP' || !member) return false
  return member.isAdmin || conv.createdById === me.id || LEAD_ROLES.has(me.role)
}

/** Post "X changed / removed this channel's picture" in the chat it belongs to. */
export async function announcePicture(conversationId: string | null | undefined, userId: string, kind: 'project' | 'chat', removed: boolean): Promise<void> {
  if (!conversationId) return
  const what = kind === 'project' ? "this channel's picture" : "this group's picture"
  await prisma.chatMessage.create({ data: { conversationId, userId, body: `${removed ? 'removed' : 'changed'} ${what}`, system: removed ? 'picture-removed' : 'picture' } })
  await prisma.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } })
}
