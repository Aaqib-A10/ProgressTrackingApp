import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'
import { useToast } from '../ui/Toast'
import { errMsg, inputCls, labelCls } from '../../lib/biz'

/**
 * Settings, "WhatsApp": a person gives their number and chooses to get their notifications there too (the ones they
 * have not muted). The card is not shown at all until the server has a WhatsApp account to send from.
 */
export function WhatsappCard() {
  const { user, refresh } = useAuth()
  const { addToast } = useToast()
  const w = user?.whatsapp
  const [number, setNumber] = useState(w?.number ? `+${w.number}` : '')
  const [on, setOn] = useState(!!w?.on)
  const [busy, setBusy] = useState(false)
  // Shown only once this Metriq has a WhatsApp account to send from: before that there is nothing to turn on.
  if (!user || !w?.ready) return null
  async function save() {
    setBusy(true)
    try {
      await api.put('/auth/me/whatsapp', { number: number.trim(), on })
      await refresh()
      addToast({ type: 'success', message: on ? 'Saved. Your notifications will also come on WhatsApp.' : 'Saved.' })
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not save.') }) } finally { setBusy(false) }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><MessageCircle size={16} className="text-success" />WhatsApp</span>} subtitle="Get your Metriq notifications on WhatsApp too. Muted kinds are not sent.">
      <div className="space-y-3">
        <div className="max-w-sm">
          <label className={labelCls} htmlFor="wa-number">Your WhatsApp number, with the country code</label>
          <input id="wa-number" inputMode="tel" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+92 300 1234567" className={inputCls} />
        </div>
        <div className="flex items-center gap-3">
          <Toggle checked={on} onChange={setOn} label="Send my notifications to WhatsApp" />
          <span className="text-body-md text-ink">Send my notifications to WhatsApp</span>
        </div>
        <Button disabled={busy} onClick={() => void save()}>Save</Button>
      </div>
    </Card>
  )
}
