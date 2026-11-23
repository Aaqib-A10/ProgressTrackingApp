import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/cn'
import { navGroupKey, navSubKey, type NavGroup, type NavItem } from './navConfig'

/**
 * "My menu": a person picks what shows in their own sidebar. Untick a screen, a sub-section or a whole section to take
 * it off; tick it to bring it back. It only tidies the sidebar: every screen stays reachable through search (Ctrl K)
 * and links, and what a person may open does not change. Saved on the account, so it follows them to other devices.
 */
export function MenuEditor({ groups, hidden, onClose }: { groups: NavGroup[]; hidden: string[]; onClose: () => void }) {
  const { refresh } = useAuth()
  const { addToast } = useToast()
  const [off, setOff] = useState<Set<string>>(() => new Set(hidden))
  const [saving, setSaving] = useState(false)
  const toggle = (key: string) => setOff((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })

  async function save() {
    setSaving(true)
    try {
      await api.put('/auth/me/nav', { hidden: [...off] })
      await refresh()
      addToast({ type: 'success', message: off.size ? 'Your menu is saved.' : 'Your menu shows everything again.' })
      onClose()
    } catch {
      addToast({ type: 'error', message: 'Could not save your menu.' })
    } finally {
      setSaving(false)
    }
  }

  const row = (key: string, label: React.ReactNode, opts: { dim?: boolean; strong?: boolean; indent?: 0 | 1 | 2 } = {}) => (
    <label key={key} className={cn('flex min-h-[34px] cursor-pointer items-center gap-2.5 rounded-md px-2 text-body-sm hover:bg-slate-200/45', opts.indent === 1 && 'ml-5', opts.indent === 2 && 'ml-10', opts.dim && 'opacity-50')}>
      <input type="checkbox" checked={!off.has(key)} onChange={() => toggle(key)} className="h-4 w-4 shrink-0 accent-primary" />
      <span className={cn('flex min-w-0 flex-1 items-center gap-2 truncate', opts.strong ? 'font-semibold text-ink' : 'text-ink')}>{label}</span>
    </label>
  )
  const item = (i: NavItem, indent: 0 | 1 | 2, dim: boolean) => {
    const Icon = i.icon
    return row(i.to, <><Icon size={15} className="shrink-0 text-ink-faint" /><span className="truncate">{i.label}</span></>, { indent, dim })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="My menu"
      size="sm"
      footer={<>
        <Button variant="ghost" onClick={() => setOff(new Set())} disabled={!off.size}>Show everything</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>Save</Button>
      </>}
    >
      <p className="mb-3 text-body-sm text-ink-muted">Untick what you do not want in your sidebar. Nothing is deleted: a hidden screen still opens from search (Ctrl K), and you can tick it back here any time. Only your own menu changes.</p>
      <div className="max-h-[56vh] space-y-2 overflow-y-auto pr-1">
        {groups.map((g, gi) => {
          const gKey = g.title ? navGroupKey(g.title) : null
          const gOff = !!gKey && off.has(gKey)
          const GroupIcon = g.icon
          return (
            <div key={g.title ?? `main-${gi}`} className="rounded-btn border border-line bg-card p-1.5">
              {gKey
                ? row(gKey, <>{GroupIcon && <GroupIcon size={15} className="shrink-0 text-ink-muted" />}<span className="truncate">{g.title}</span><span className="ml-auto text-[11px] font-normal text-ink-faint">whole section</span></>, { strong: true })
                : <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase text-ink-muted">Main</p>}
              {g.items.map((i) => item(i, gKey ? 1 : 0, gOff))}
              {g.subgroups?.map((sg) => {
                const sKey = navSubKey(g.title ?? '', sg.title)
                const sOff = gOff || off.has(sKey)
                return (
                  <div key={sKey}>
                    {row(sKey, <span className="truncate">{sg.title}</span>, { strong: true, indent: 1, dim: gOff })}
                    {sg.items.map((i) => item(i, 2, sOff))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
