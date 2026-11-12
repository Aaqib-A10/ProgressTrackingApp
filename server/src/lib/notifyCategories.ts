/**
 * Notification categories: the bell's and the Notifications page's tabs, and what a person can mute
 * (muted: no pop-up or phone push and not counted in the badge; still listed). ITAD update 12 Nov, §6.
 *
 * ONE map, kept identical in server/src/lib/notifyCategories.ts and client/src/lib/notifyCategories.ts
 * (src/test/notifyCategories.test.ts checks they match and that every NotificationType is mapped).
 * Pure TypeScript, no imports.
 */

export type NotifyCategory = 'tasks' | 'imports' | 'ai' | 'system'

/** In tab order. System starts collapsed. */
export const NOTIFY_CATEGORIES: { key: NotifyCategory; label: string; collapsed: boolean }[] = [
  { key: 'tasks', label: 'Follow ups and tasks', collapsed: false },
  { key: 'imports', label: 'Imports', collapsed: false },
  { key: 'ai', label: 'AI insights', collapsed: false },
  { key: 'system', label: 'System', collapsed: true },
]

export const NOTIFY_CATEGORY_KEYS: NotifyCategory[] = NOTIFY_CATEGORIES.map((c) => c.key)

/** Every stored notification type (enum NotificationType) and its category. */
export const NOTIFY_TYPE_CATEGORY: Record<string, NotifyCategory> = {
  // Follow ups and tasks
  TASK_ASSIGNED: 'tasks',
  TASK_DUE_SOON: 'tasks',
  TASK_UNASSIGNED: 'tasks',
  TASK_STATUS_CHANGED: 'tasks',
  TASK_COMPLETED: 'tasks',
  TASK_COMMENT: 'tasks',
  TASK_DUE_CHANGED: 'tasks',
  TASK_OVERDUE: 'tasks',
  TASK_REVIEW: 'tasks',
  EXTENSION_REQUESTED: 'tasks',
  EXTENSION_DECIDED: 'tasks',
  PROJECT_MEMBER_ADDED: 'tasks',
  MEETING: 'tasks',
  MENTION: 'tasks',
  CHAT_MESSAGE: 'tasks',
  WORKLOG_REVIEW: 'tasks',
  LEAD_TASK: 'tasks',
  LEAD_SLA: 'tasks',
  LEAD_COMMENT: 'tasks',
  LEAD_REVIEW: 'tasks',
  LEAD_DECISION: 'tasks',
  // Imports (new leads arriving)
  LEAD_NEW: 'imports',
  LEAD_ASSIGNED: 'imports',
  // AI insights
  AI_INSIGHT: 'ai',
  // System: attendance, health, network, WFH, support
  GRACE_EXCEEDED: 'system',
  GRACE_LIMIT: 'system',
  BREAK_OVERRUN: 'system',
  BREAK_CUTOFF: 'system',
  BRB_OVERRUN: 'system',
  AUTO_CHECKOUT: 'system',
  WFH_REQUESTED: 'system',
  WFH_DECIDED: 'system',
  NETWORK_BLOCKED: 'system',
  SYSTEM_HEALTH: 'system',
  ATTENDANCE_EDITED: 'system',
  SUPPORT_REPLY: 'system',
}

/** The bell's derived items (not stored rows), by id. */
export const NOTIFY_DERIVED_CATEGORY: Record<string, NotifyCategory> = {
  'reminder-today': 'tasks',
  'team-missing': 'tasks',
  'stock-requests': 'tasks',
  'stock-assigned': 'tasks',
  'feedback-unread': 'system',
  'qa-unread': 'system',
  'qa-coaching': 'system',
  welcome: 'system',
}

export function isNotifyCategory(v: unknown): v is NotifyCategory {
  return typeof v === 'string' && (NOTIFY_CATEGORY_KEYS as string[]).includes(v)
}

/** The category of a stored notification type. Unknown types are System. */
export function categoryOf(type: string): NotifyCategory {
  return NOTIFY_TYPE_CATEGORY[type] ?? 'system'
}

/** The category of a derived bell item (by its id). Unknown ids are System. */
export function categoryOfDerived(id: string): NotifyCategory {
  return NOTIFY_DERIVED_CATEGORY[id] ?? 'system'
}

/** Every stored notification type in this category. */
export function typesOf(category: NotifyCategory): string[] {
  return Object.keys(NOTIFY_TYPE_CATEGORY).filter((t) => NOTIFY_TYPE_CATEGORY[t] === category)
}

/** Is this notification type in a muted category? */
export function isMuted(type: string, muted: readonly string[] | null | undefined): boolean {
  return !!muted && muted.includes(categoryOf(type))
}

/** Follow-ups by lead value: most valuable first. */
export const FOLLOW_UP_VALUE_ORDER = ['Pipeline', 'Interested', 'Connected'] as const

/** Lower = more valuable. Any other (or no) status goes last. */
export function leadStatusRank(status: string | null | undefined): number {
  if (!status) return FOLLOW_UP_VALUE_ORDER.length
  const s = status.trim().toLowerCase()
  const i = FOLLOW_UP_VALUE_ORDER.findIndex((v) => v.toLowerCase() === s)
  return i < 0 ? FOLLOW_UP_VALUE_ORDER.length : i
}
