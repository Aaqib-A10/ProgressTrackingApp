import { api } from './api'

export type DocCategory = 'CONTRACT' | 'PRICE_LIST' | 'CERTIFICATE' | 'PROPOSAL' | 'PORTAL' | 'SOP' | 'OTHER'

export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  CONTRACT: 'Contract / agreement',
  PRICE_LIST: 'Price list / quote',
  CERTIFICATE: 'Certificate / compliance',
  PROPOSAL: 'Proposal / bid document',
  PORTAL: 'Portal / website',
  SOP: 'Guide / SOP',
  OTHER: 'Other',
}

export interface SavedDoc {
  id: string
  title: string
  url: string | null
  file: { name: string; mime: string | null; size: number | null; downloadUrl: string } | null
  brand: string
  category: DocCategory
  notes: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface SavedDocInput {
  title: string
  url?: string | null
  brand?: string | null
  category?: DocCategory
  notes?: string | null
  pinned?: boolean
}

export const docsApi = {
  list: () => api.get<{ docs: SavedDoc[] }>('/docs'),
  create: (input: SavedDocInput) => api.post<{ doc: SavedDoc }>('/docs', input),
  update: (id: string, input: Partial<SavedDocInput>) => api.patch<{ doc: SavedDoc }>(`/docs/${id}`, input),
  remove: (id: string) => api.del(`/docs/${id}`),
  // Sent as plain bytes; the real type travels in the address (a .json file must not be read as data).
  upload: (id: string, file: File) =>
    api.postRaw<{ doc: SavedDoc }>(`/docs/${id}/file?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}`, file, 'application/octet-stream'),
}

export const MAX_DOC_BYTES = 25 * 1024 * 1024
