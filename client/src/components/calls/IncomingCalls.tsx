import { useEffect, useState } from 'react'
import { BellRing, Phone, PhoneOff, Users, Video } from 'lucide-react'
import type { ActiveCall } from '../../lib/callsApi'
import * as desktop from '../../lib/desktopAlerts'
import { PersonAvatar } from '../projects/pmUi'

/**
 * Incoming-call cards (top-right) with a soft ring. One-to-one calls ring until
 * answered, declined or 60 s pass; group calls ring for the first 20 s. The tab
 * title flashes so a call is noticed even when PulseTrack is in a background tab.
 */
export function IncomingCalls({ calls, inCall, onJoin, onDecline }: { calls: ActiveCall[]; inCall: boolean; onJoin: (c: ActiveCall, video: boolean) => void; onDecline: (c: ActiveCall) => void }) {
  const ringing = !inCall && calls.length > 0
  const anyDirect = calls.some((c) => c.isDirect)
  const first = calls[0]
  const [alertsAsk, setAlertsAsk] = useState(() => desktop.supported() && desktop.permission() !== 'granted' && desktop.permission() !== 'denied')

  // Ring: one-to-one for as long as the card is up, groups for the first 20 seconds.
  useEffect(() => {
    if (!ringing) return
    const started = Date.now()
    ring()
    const t = window.setInterval(() => {
      if (!anyDirect && Date.now() - started > 20_000) return
      ring()
    }, 3000)
    return () => window.clearInterval(t)
  }, [ringing, anyDirect])

  // Flash the tab title while a call is waiting.
  useEffect(() => {
    if (!ringing || !first) return
    const original = document.title
    const msg = first.isDirect ? `📞 ${first.startedBy.name} is calling…` : `📞 Call in ${first.title}`
    let on = false
    const t = window.setInterval(() => { on = !on; document.title = on ? msg : original }, 1000)
    return () => { window.clearInterval(t); document.title = original }
  }, [ringing, first?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!calls.length) return null
  return (
    <div className="fixed right-4 top-20 z-[70] flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2" aria-live="assertive">
      {calls.slice(0, 3).map((c) => (
        <div key={c.id} role="alertdialog" aria-label={`Incoming call from ${c.startedBy.name}`} className="animate-scale-in rounded-card border border-line bg-card p-3 shadow-overlay">
          <div className="flex items-center gap-3">
            <span className="relative">
              <span className="absolute inset-0 animate-ping rounded-full bg-success/30" />
              {c.isDirect ? <PersonAvatar person={c.startedBy} size={40} /> : (
                <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white"><Users size={18} /></span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-md font-semibold text-ink">{c.isDirect && !c.invitedBy ? c.startedBy.name : c.title}</p>
              <p className="truncate text-body-sm text-ink-muted">
                {c.invitedBy ? `${c.invitedBy} is adding you to the call · ${c.participants.length} in call` : c.isDirect ? `Incoming ${c.video ? 'video' : 'voice'} call` : `${c.startedBy.name} started a ${c.video ? 'video' : 'voice'} call · ${c.participants.length} in call`}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => onDecline(c)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-btn bg-danger px-3 py-2 text-body-sm font-semibold text-white hover:bg-danger/90">
              <PhoneOff size={15} /> {c.isDirect || c.invitedBy ? 'Decline' : 'Dismiss'}
            </button>
            {c.video && (
              <button type="button" onClick={() => onJoin(c, false)} className="inline-flex items-center justify-center gap-1.5 rounded-btn border border-line px-3 py-2 text-body-sm font-semibold text-ink hover:bg-slate-50" title="Join with microphone only">
                <Phone size={15} /> Audio
              </button>
            )}
            <button type="button" onClick={() => onJoin(c, c.video)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-btn bg-success px-3 py-2 text-body-sm font-semibold text-white hover:bg-success/90">
              {c.video ? <Video size={15} /> : <Phone size={15} />} {c.isDirect || c.invitedBy ? 'Answer' : 'Join'}
            </button>
          </div>
          {inCall && <p className="mt-2 text-[11px] text-ink-muted">Joining will leave your current call first.</p>}
          {alertsAsk && (
            <button type="button" onClick={() => { void desktop.enable().then(() => setAlertsAsk(false)) }} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
              <BellRing size={12} /> Turn on desktop alerts so you never miss a call
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ---- soft sounds (sine tones, gentle fade in/out: no clicks or pops) ----
let ctx: AudioContext | null = null
// Browsers only allow sound after the person has clicked or typed on the page once.
// Unlock it on the first click so later rings also play while the tab is in the background.
if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}
function audio(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = ctx ?? new Ctx()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return null }
}
function note(a: AudioContext, freq: number, at: number, len: number, vol: number) {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = 'sine'
  o.frequency.value = freq
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vol, at + 0.05)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(g).connect(a.destination)
  o.start(at)
  o.stop(at + len + 0.05)
}
function ring() {
  const a = audio()
  if (!a) return
  const t = a.currentTime
  note(a, 659.25, t, 0.4, 0.12)
  note(a, 783.99, t + 0.22, 0.45, 0.12)
  note(a, 659.25, t + 0.9, 0.4, 0.11)
  note(a, 783.99, t + 1.12, 0.45, 0.11)
}
