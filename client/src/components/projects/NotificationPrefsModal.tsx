import { useEffect, useState } from 'react'
import { BellRing, MonitorSmartphone } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'
import { useToast } from '../ui/Toast'
import { errMsg, projectsApi, type NotifyPrefs } from '../../lib/projectsApi'
import * as desktop from '../../lib/desktopAlerts'

/** Notification settings for everyone: pop-ups on this computer + which alerts also come by email. */
export function NotificationPrefsModal({ onClose }: { onClose: () => void }) {
  const { addToast } = useToast()
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null)
  const [dp, setDp] = useState(desktop.getPrefs())
  const [perm, setPerm] = useState(desktop.permission())
  useEffect(() => { projectsApi.prefs().then((r) => setPrefs(r.prefs)).catch(() => undefined) }, [])

  const set = (k: keyof NotifyPrefs, v: boolean) => {
    setPrefs((p) => (p ? { ...p, [k]: v } : p))
    projectsApi.savePrefs({ [k]: v }).catch((e) => addToast({ type: 'error', message: errMsg(e, 'Could not save') }))
  }
  const setDesktop = (patch: Partial<desktop.DesktopPrefs>) => setDp(desktop.savePrefs(patch))

  async function toggleMaster(on: boolean) {
    if (!on) { setDesktop({ enabled: false }); return }
    const p = await desktop.enable()
    setPerm(p)
    setDp(desktop.getPrefs())
    if (p === 'granted') {
      addToast({ type: 'success', message: 'Pop-up alerts are on for this computer' })
      desktop.popup({ kind: 'tasks', title: 'PulseTrack alerts are on', body: 'You will see task and chat alerts here while PulseTrack is open.', force: true })
    } else if (p === 'denied') {
      addToast({ type: 'error', message: 'Your browser blocked notifications. See the steps below to allow them.' })
    }
  }

  const emailRows: { k: keyof NotifyPrefs; label: string; hint: string }[] = [
    { k: 'emailAssigned', label: 'A task is assigned to me', hint: 'Email when someone gives you a task' },
    { k: 'emailMention', label: 'Someone mentions me', hint: 'In task comments and chat' },
    { k: 'emailDueSoon', label: 'My task is due soon', hint: '24 hours and 1 hour before (per project settings)' },
    { k: 'emailComment', label: 'New comments and reviews on tasks I follow', hint: 'Can get busy on active tasks' },
  ]

  return (
    <Modal open onClose={onClose} title="Notification settings" footer={<Button onClick={onClose}>Done</Button>}>
      {/* Desktop pop-ups */}
      <section>
        <h3 className="flex items-center gap-2 text-body-md font-semibold text-ink"><MonitorSmartphone size={16} /> Pop-up alerts on this computer</h3>
        <p className="mt-0.5 text-body-sm text-ink-muted">Shows a Windows or Mac notification when something happens, even if PulseTrack is in a background tab. Keep one PulseTrack tab open.</p>
        {perm === 'unsupported' ? (
          <p className="mt-3 rounded-btn bg-slate-50 p-3 text-body-sm text-ink-muted">This browser does not support pop-up alerts. Use Chrome or Edge on a computer.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            <li className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-body-md font-medium text-ink">Turn on pop-up alerts</p>
                <p className="text-body-sm text-ink-muted">{perm === 'granted' ? 'Allowed by your browser' : perm === 'denied' ? 'Blocked by your browser' : 'Your browser will ask you to allow it'}</p>
              </div>
              <Toggle checked={dp.enabled && perm === 'granted'} onChange={toggleMaster} label="Pop-up alerts" />
            </li>
            {perm === 'denied' && (
              <li className="py-3 text-body-sm text-ink">
                <p className="font-medium text-danger">Notifications are blocked for this site.</p>
                <p className="mt-1 text-ink-muted">Click the icon to the left of the address bar, set <b>Notifications</b> to <b>Allow</b>, reload the page, then turn this on again. On Windows also check Settings, System, Notifications, and make sure Chrome or Edge is allowed.</p>
              </li>
            )}
            {dp.enabled && perm === 'granted' && (
              <>
                <li className="flex items-center justify-between gap-4 py-3 pl-4">
                  <div>
                    <p className="text-body-md text-ink">Task alerts</p>
                    <p className="text-body-sm text-ink-muted">Assigned to me, due soon, overdue, mentions, comments, reviews</p>
                  </div>
                  <Toggle checked={dp.tasks} onChange={(v) => setDesktop({ tasks: v })} label="Task pop-ups" />
                </li>
                <li className="flex items-center justify-between gap-4 py-3 pl-4">
                  <div>
                    <p className="text-body-md text-ink">New chat messages</p>
                    <p className="text-body-sm text-ink-muted">Direct messages, groups and project channels you have not muted</p>
                  </div>
                  <Toggle checked={dp.chat} onChange={(v) => setDesktop({ chat: v })} label="Chat pop-ups" />
                </li>
                <li className="flex items-center justify-between gap-4 py-3 pl-4">
                  <div>
                    <p className="text-body-md text-ink">Play a soft sound</p>
                    <p className="text-body-sm text-ink-muted">A short chime with each pop-up</p>
                  </div>
                  <Toggle checked={dp.sound} onChange={(v) => setDesktop({ sound: v })} label="Sound" />
                </li>
                <li className="py-3 pl-4">
                  <Button size="sm" variant="secondary" leadingIcon={<BellRing size={14} />} onClick={() => {
                    const ok = desktop.popup({ kind: 'tasks', title: 'Test alert from PulseTrack', body: 'If you can see this, pop-up alerts are working.', force: true })
                    if (!ok) addToast({ type: 'error', message: 'Could not show a pop-up. Check that Task alerts is on and your system allows notifications.' })
                  }}>Send a test alert</Button>
                </li>
              </>
            )}
          </ul>
        )}
      </section>

      {/* Email */}
      <section className="mt-5 border-t border-line pt-4">
        <h3 className="text-body-md font-semibold text-ink">Email</h3>
        <p className="mt-0.5 text-body-sm text-ink-muted">Alerts always appear in the bell. Choose which ones also come by email.</p>
        {!prefs ? <p className="mt-4 text-body-sm text-ink-muted">Loading…</p> : (
          <ul className="mt-2 divide-y divide-line">
            {emailRows.map((r) => (
              <li key={r.k} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-body-md text-ink">{r.label}</p>
                  <p className="text-body-sm text-ink-muted">{r.hint}</p>
                </div>
                <Toggle checked={prefs[r.k]} onChange={(v) => set(r.k, v)} label={r.label} />
              </li>
            ))}
            <li className="flex items-center justify-between gap-4 py-3 opacity-70">
              <div>
                <p className="text-body-md text-ink">My task is overdue</p>
                <p className="text-body-sm text-ink-muted">Always sent, can't be turned off</p>
              </div>
              <Toggle checked onChange={() => undefined} disabled label="Overdue alerts" />
            </li>
          </ul>
        )}
      </section>
    </Modal>
  )
}
