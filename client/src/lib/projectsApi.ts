import { api, ApiError } from './api'

// ---------- Types (mirror server/src/controllers/projectsController + pmTasksController) ----------

export type PmRole = 'ADMIN' | 'MEMBER' | 'VIEWER'
export type ColumnCategory = 'TODO' | 'IN_PROGRESS' | 'DONE'
export type PmPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface PersonRef { id: string; name: string }

export interface Project {
  id: string
  name: string
  key: string
  description: string | null
  color: string
  status: 'ACTIVE' | 'ARCHIVED'
  ownerId: string
  taskCounter: number
  overdueNotifyAdmins: boolean
  overdueRepeatHours: number
  reminderOffsetsMinutes: number[]
  createdAt: string
}

export interface ProjectListItem extends Project {
  myRole: PmRole | null
  memberCount: number
  members: PersonRef[]
  openCount: number
  overdueCount: number
  myOpenCount: number
}

export interface ProjectPerms {
  projectRole: PmRole | null
  isSuperAdmin: boolean
  canManage: boolean
  canContribute: boolean
  canArchive: boolean
}

export interface BoardColumn {
  id: string
  name: string
  category: ColumnCategory
  position: number
  color: string | null
  wipLimit: number | null
  isDefault: boolean
}

export interface Label { id: string; name: string; color: string }

export interface TaskCard {
  id: string
  code: string
  title: string
  columnId: string
  status: string
  category: ColumnCategory
  position: number
  priority: PmPriority
  startAt: string | null
  dueAt: string | null
  completedAt: string | null
  isOverdue: boolean
  createdBy: PersonRef
  assignees: PersonRef[]
  labels: Label[]
  counts: { comments: number; attachments: number; checklistDone: number; checklistTotal: number }
  updatedAt: string
  createdAt: string
}

export interface ProjectMember { id: string; name: string; email: string; isActive: boolean; role: PmRole }

export interface BoardData {
  project: Project
  perms: ProjectPerms
  me: { id: string }
  columns: BoardColumn[]
  tasks: TaskCard[]
  members: ProjectMember[]
  labels: Label[]
  hiddenDoneCount: number
  serverTime: string
}

export interface TaskComment { id: string; body: string; mentions: string[]; author: PersonRef; createdAt: string; editedAt: string | null }
export interface TaskAttachment { id: string; originalName: string; mimeType: string; size: number; uploadedBy: PersonRef; createdAt: string; downloadUrl: string }
export interface ChecklistItem { id: string; text: string; isDone: boolean; position: number }
export interface ExtensionRequest {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reason: string
  currentDueAt: string | null
  requestedDueAt: string
  requestedBy: PersonRef
  decidedBy: PersonRef | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
}

export interface TaskDetail extends TaskCard {
  projectKey: string
  projectName: string
  description: string | null
  estimateHours: number | null
  overdueSince: string | null
  watchers: PersonRef[]
  checklist: ChecklistItem[]
  comments: TaskComment[]
  attachments: TaskAttachment[]
  extensionRequests: ExtensionRequest[]
}

export interface TaskPerms {
  canEdit: boolean
  canChangeDue: boolean
  canDelete: boolean
  canMove: boolean
  canComment: boolean
  canDecideExtension: boolean
  canRequestExtension: boolean
  isAssignee: boolean
}

export interface ActivityRow { id: string; action: string; meta: Record<string, unknown> | null; user: PersonRef | null; createdAt: string }

export interface NotifyPrefs { emailAssigned: boolean; emailMention: boolean; emailComment: boolean; emailDueSoon: boolean }

export interface PickUser { id: string; name: string; email: string; role: string; department: string | null }

// ---------- Calls ----------

const k = (key: string) => encodeURIComponent(key)

export const projectsApi = {
  list: (archived = false) => api.get<{ canCreate: boolean; projects: ProjectListItem[] }>(`/projects${archived ? '?archived=1' : ''}`),
  create: (body: { name: string; key: string; description?: string; color?: string; members?: { userId: string; role: PmRole }[] }) => api.post<{ project: Project }>('/projects', body),
  get: (key: string) => api.get<{ project: Project; perms: ProjectPerms }>(`/projects/${k(key)}`),
  update: (key: string, body: Partial<Pick<Project, 'name' | 'key' | 'description' | 'color' | 'overdueNotifyAdmins' | 'overdueRepeatHours' | 'reminderOffsetsMinutes'>>) => api.patch<{ project: Project }>(`/projects/${k(key)}`, body),
  archive: (key: string, archived: boolean) => api.post<{ project: Project }>(`/projects/${k(key)}/archive`, { archived }),
  board: (key: string, showOldDone = false) => api.get<BoardData>(`/projects/${k(key)}/board${showOldDone ? '?showOldDone=1' : ''}`),

  members: (key: string) => api.get<{ members: { userId: string; name: string; email: string; isActive: boolean; role: PmRole }[] }>(`/projects/${k(key)}/members`),
  addMembers: (key: string, userIds: string[], role: PmRole) => api.post<{ added: number }>(`/projects/${k(key)}/members`, { userIds, role }),
  setMemberRole: (key: string, userId: string, role: PmRole) => api.patch(`/projects/${k(key)}/members/${userId}`, { role }),
  removeMember: (key: string, userId: string) => api.del(`/projects/${k(key)}/members/${userId}`),
  pickableUsers: () => api.get<{ users: PickUser[] }>('/projects/users'),

  createColumn: (key: string, body: { name: string; category: ColumnCategory; color?: string | null; wipLimit?: number | null }) => api.post<{ column: BoardColumn }>(`/projects/${k(key)}/columns`, body),
  updateColumn: (id: string, body: Partial<Pick<BoardColumn, 'name' | 'category' | 'color' | 'wipLimit' | 'isDefault'>>) => api.patch<{ column: BoardColumn }>(`/projects/columns/${id}`, body),
  deleteColumn: (id: string, moveTo?: string) => api.del(`/projects/columns/${id}${moveTo ? `?moveTo=${moveTo}` : ''}`),
  reorderColumns: (key: string, orderedIds: string[]) => api.patch(`/projects/${k(key)}/columns/reorder`, { orderedIds }),

  createLabel: (key: string, body: { name: string; color?: string }) => api.post<{ label: Label }>(`/projects/${k(key)}/labels`, body),
  updateLabel: (id: string, body: Partial<{ name: string; color: string }>) => api.patch<{ label: Label }>(`/projects/labels/${id}`, body),
  deleteLabel: (id: string) => api.del(`/projects/labels/${id}`),

  createTask: (key: string, body: { title: string; description?: string | null; columnId?: string; assigneeIds?: string[]; priority?: PmPriority; dueAt?: string | null; startAt?: string | null; labelIds?: string[]; checklist?: string[]; estimateHours?: number | null }) =>
    api.post<{ task: TaskCard }>(`/projects/${k(key)}/tasks`, body),
  task: (code: string) => api.get<{ task: TaskDetail; perms: TaskPerms }>(`/projects/tasks/${k(code)}`),
  updateTask: (code: string, body: Partial<{ title: string; description: string | null; priority: PmPriority; startAt: string | null; dueAt: string | null; estimateHours: number | null; labelIds: string[]; assigneeIds: string[]; columnId: string }>) =>
    api.patch<{ task: TaskCard }>(`/projects/tasks/${k(code)}`, body),
  moveTask: (code: string, columnId: string, beforeTaskId: string | null, afterTaskId: string | null) => api.patch<{ task: TaskCard }>(`/projects/tasks/${k(code)}/move`, { columnId, beforeTaskId, afterTaskId }),
  deleteTask: (code: string) => api.del(`/projects/tasks/${k(code)}`),
  activity: (code: string) => api.get<{ activity: ActivityRow[] }>(`/projects/tasks/${k(code)}/activity`),
  watch: (code: string, on: boolean) => (on ? api.post(`/projects/tasks/${k(code)}/watch`) : api.del(`/projects/tasks/${k(code)}/watch`)),
  addComment: (code: string, body: string, mentions: string[]) => api.post<{ comment: TaskComment }>(`/projects/tasks/${k(code)}/comments`, { body, mentions }),
  editComment: (id: string, body: string) => api.patch<{ comment: TaskComment }>(`/projects/comments/${id}`, { body }),
  deleteComment: (id: string) => api.del(`/projects/comments/${id}`),
  addChecklist: (code: string, text: string) => api.post<{ item: ChecklistItem }>(`/projects/tasks/${k(code)}/checklist`, { text }),
  updateChecklist: (id: string, body: Partial<{ text: string; isDone: boolean }>) => api.patch<{ item: ChecklistItem }>(`/projects/checklist/${id}`, body),
  deleteChecklist: (id: string) => api.del(`/projects/checklist/${id}`),
  uploadAttachment: (code: string, file: File) => api.postRaw<{ attachment: TaskAttachment }>(`/projects/tasks/${k(code)}/attachments?name=${encodeURIComponent(file.name)}`, file, file.type || 'application/octet-stream'),
  deleteAttachment: (id: string) => api.del(`/projects/attachments/${id}`),
  requestExtension: (code: string, requestedDueAt: string, reason: string) => api.post(`/projects/tasks/${k(code)}/extension-requests`, { requestedDueAt, reason }),
  decideExtension: (id: string, decision: 'approve' | 'reject', note?: string) => api.post(`/projects/extension-requests/${id}/decide`, { decision, note }),
  bulk: (key: string, body: { taskIds: string[]; columnId?: string; priority?: PmPriority; assigneeId?: string | null; delete?: boolean }) => api.post<{ updated: number }>(`/projects/${k(key)}/tasks/bulk`, body),

  myTasks: (scope: 'assigned' | 'created') => api.get<{ scope: string; tasks: (TaskCard & { project: { key: string; name: string; color: string } })[] }>(`/projects/me/tasks?scope=${scope}`),
  prefs: () => api.get<{ prefs: NotifyPrefs }>('/projects/notification-prefs'),
  savePrefs: (p: Partial<NotifyPrefs>) => api.put<{ prefs: NotifyPrefs }>('/projects/notification-prefs', p),

  report: (q: { from?: string; to?: string; project?: string }) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => !!v) as [string, string][])
    return api.get<ReportData>(`/projects/reports/overview?${p}`)
  },
  reportCsvUrl: (type: 'members' | 'overdue' | 'projects', q: { from?: string; to?: string; project?: string }) => {
    const p = new URLSearchParams({ type, ...Object.fromEntries(Object.entries(q).filter(([, v]) => !!v)) })
    return `${import.meta.env.VITE_API_URL ?? '/api'}/projects/reports/export.csv?${p}`
  },
}

export interface MetricsSummary { open: number; overdue: number; completed: number; completedWithDue: number; completedOnTime: number; onTimeRate: number | null; avgDaysLate: number | null }
export interface ReportData {
  from: string
  to: string
  projects: { key: string; name: string }[]
  overall: MetricsSummary
  byProject: { projectId: string; key: string; name: string; color: string; open: number; inProgress: number; overdue: number; done: number }[]
  byMember: (MetricsSummary & { userId: string; name: string })[]
  overdue: { code: string; title: string; project: { key: string; name: string; color: string }; status: string; priority: PmPriority; assignees: PersonRef[]; dueAt: string; daysOverdue: number }[]
}

/** Server error text → a friendly message (server sends { error }). */
export function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) {
    try {
      const j = JSON.parse(e.message) as { error?: string }
      if (j.error) return j.error
    } catch { /* not JSON */ }
    return e.message || fallback
  }
  return fallback
}
