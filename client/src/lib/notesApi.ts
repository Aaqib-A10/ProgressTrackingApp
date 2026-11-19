import { api } from './api'

/** Notes (server controllers/notesController.ts): sticky notes, shared to read or to edit, @mentions, reminders. */

export type NoteColor = 'plain' | 'yellow' | 'orange' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'red'
export const NOTE_COLORS: NoteColor[] = ['yellow', 'orange', 'green', 'teal', 'blue', 'purple', 'pink', 'red', 'plain']
export type NoteAccess = 'owner' | 'edit' | 'view'
export interface NoteItem { id: string; text: string; done: boolean }
export interface NoteShareRow { userId: string; name: string; canEdit: boolean }
export interface Note {
  id: string
  title: string
  body: string
  items: NoteItem[] | null
  color: NoteColor
  tags: string[]
  mentions: string[]
  pinned: boolean
  archived: boolean
  remindAt: string | null
  reminded: boolean
  owner: { id: string; name: string }
  editedBy: { id: string; name: string } | null
  access: NoteAccess
  shares: NoteShareRow[]
  createdAt: string
  updatedAt: string
}
export interface NotePerson { id: string; name: string; department: string | null }

export interface NoteInput {
  title?: string
  body?: string
  items?: NoteItem[] | null
  color?: NoteColor
  tags?: string[]
  mentions?: string[]
  pinned?: boolean
  archived?: boolean
  remindAt?: string | null
}

export const notesApi = {
  list: () => api.get<{ notes: Note[] }>('/notes'),
  get: (id: string) => api.get<{ note: Note }>(`/notes/${id}`),
  create: (input: NoteInput & { shares?: { userId: string; canEdit: boolean }[] }) => api.post<{ note: Note }>('/notes', input),
  update: (id: string, input: NoteInput) => api.patch<{ note: Note }>(`/notes/${id}`, input),
  share: (id: string, shares: { userId: string; canEdit: boolean }[]) => api.put<{ note: Note }>(`/notes/${id}/shares`, { shares }),
  remove: (id: string) => api.del<void>(`/notes/${id}`),
  people: () => api.get<{ people: NotePerson[] }>('/notes/people'),
}
