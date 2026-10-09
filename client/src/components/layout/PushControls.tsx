import { useEffect, useState } from 'react'
import { BellRing, Loader2, Smartphone, X } from 'lucide-react'
import { disablePush, enablePush, pushState, syncPush, testPush, type PushState } from '../../lib/push'
import { errMsg } from '../../lib/projectsApi'
import { useToast } from '../ui/Toast'

/**
 * Notifications that reach you when PulseTrack is closed: calls ring and messages pop up
 * on this computer or phone, like WhatsApp. Turned on per device.
 */

function usePushState(): [PushState | null, (s: PushState) => void] {
  const [st, setSt] = useState<PushState | null>(null)
  useEffect(() => { void pushState().then(setSt).catch(() => setSt('unsupported')) }, [])
  return [st, setSt]
}

const HELP: Record<PushState, string> = {
  on: 'On for this device. Calls and messages pop up even when PulseTrack is closed.',
  off: 'Off for this device.',
  denied: 'Blocked in this browser. Click the lock next to the address, allow Notifications, then reload.',
  unsupported: 'This browser cannot show notifications when PulseTrack is closed. Use Chrome, Edge or Firefox.',
  'ios-install': 'On iPhone: tap Share, then "Add to Home Screen", open PulseTrack from there and turn this on.',
}

/** The switch for the settings window. */
export function PushSetting() {
  const { addToast } = useToast()
  const [st, setSt] = usePushState()
  const [busy, setBusy] = useState(false)

  async function turn(on: boolean) {
    setBusy(true)
    try {
      if (on) {
        const r = await enablePush()
        setSt(r)
        if (r === 'on') addToast({ type: 'success', message: 'Done. Calls and messages will reach you even when PulseTrack is closed.' })
        else if (r === 'denied') addToast({ type: 'error', message: HELP.denied })
      } else {
        await disablePush()
        setSt('off')
      }
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not change notifications') })
    } finally { setBusy(false) }
  }

  async function test() {
    setBusy(true)
    try {
      const r = await testPush()
      addToast({ type: r.sent ? 'success' : 'warning', message: r.sent ? `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}` : 'Could not reach your devices. Turn it off and on again.' })
    } catch (e) { addToast({ type: 'error', message: errMsg(e) }) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-btn border border-line p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Smartphone size={17} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-body-md font-semibold text-ink">When PulseTrack is closed</p>
          <p className="text-body-sm text-ink-muted">{st ? HELP[st] : 'Checking…'}</p>
        </div>
        {busy ? <Loader2 size={18} className="animate-spin text-ink-muted" /> : st === 'on' ? (
          <button type="button" onClick={() => void turn(false)} className="shrink-0 rounded-btn border border-line px-3 py-1.5 text-body-sm font-semibold text-ink hover:bg-slate-50">Turn off</button>
        ) : st === 'off' ? (
          <button type="button" onClick={() => void turn(true)} className="shrink-0 rounded-btn bg-primary px-3 py-1.5 text-body-sm font-semibold text-white hover:bg-primary/90">Turn on</button>
        ) : null}
      </div>
      {st === 'on' && !busy && <button type="button" onClick={() => void test()} className="mt-2 text-body-sm font-semibold text-primary hover:underline">Send me a test notification</button>}
    </div>
  )
}

const DISMISS_KEY = 'pt-push-banner-hidden-until'

/** A one-line nudge at the top of the app until notifications are on for this device. */
export function PushBanner() {
  const { addToast } = useToast()
  const [st, setSt] = usePushState()
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(() => {
    try { return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now() } catch { return false }
  })
  // Already on here: make sure the server still has this device (keys can change).
  useEffect(() => { if (st === 'on') void syncPush() }, [st])

  if (hidden || (st !== 'off' && st !== 'ios-install')) return null
  const later = () => {
    setHidden(true)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 86_400_000)) } catch { /* fine */ }
  }
  return (
    <div className="mb-4 flex animate-fade-in flex-wrap items-center gap-3 rounded-card border border-primary/20 bg-primary/5 px-4 py-2.5">
      <BellRing size={18} className="shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-body-sm text-ink">
        {st === 'ios-install'
          ? <>To get calls and messages on this iPhone like WhatsApp: tap <b>Share</b>, then <b>Add to Home Screen</b>, and open PulseTrack from there.</>
          : <><b>Never miss a call or message.</b> Turn on notifications and they pop up even when PulseTrack is closed.</>}
      </p>
      {st === 'off' && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await enablePush()
              setSt(r)
              if (r === 'on') addToast({ type: 'success', message: 'Notifications are on for this device' })
              else if (r === 'denied') addToast({ type: 'error', message: HELP.denied })
            } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not turn on notifications') }) } finally { setBusy(false) }
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-body-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
        >
          {busy && <Loader2 size={14} className="animate-spin" />} Turn on
        </button>
      )}
      <button type="button" onClick={later} className="shrink-0 rounded p-1 text-ink-muted hover:bg-white hover:text-ink" aria-label="Not now" title="Not now"><X size={16} /></button>
    </div>
  )
}
