import { useEffect, useState } from 'react'
import { chatApi } from '../../lib/chatApi'
import { active as alertsActive, popup } from '../../lib/desktopAlerts'

// One shared poller for the chat unread badge (top bar + floating chat), so the
// app makes a single request every 15 seconds no matter how many badges render.

type State = { total: number; conversations: number }
let state: State = { total: 0, conversations: 0 }
const subs = new Set<(s: State) => void>()
let timer: number | undefined
let lastAlerted: string | null | undefined // undefined until the first load (never pop up for old messages)

async function refresh(): Promise<void> {
  try {
    const r = await chatApi.unread()
    state = { total: r.total, conversations: r.conversations }
    subs.forEach((f) => f(state))
    const latest = r.latest ?? null
    if (lastAlerted === undefined) {
      lastAlerted = latest?.id ?? null
    } else if (latest && latest.id !== lastAlerted) {
      lastAlerted = latest.id
      const onChatPage = window.location.pathname.startsWith('/app/chat') && document.visibilityState === 'visible' && document.hasFocus()
      // Calls have their own ringing banner and pop-up.
      if (!onChatPage && !latest.isCall) {
        popup({
          kind: 'chat',
          title: latest.isDirect ? `${latest.from}` : `${latest.from} in ${latest.where ?? 'a group'}`,
          body: latest.text,
          link: `/app/chat?c=${encodeURIComponent(latest.conversationId)}`,
          tag: `chat-${latest.conversationId}`,
        })
      }
    }
  } catch { /* offline or logged out: keep last value */ }
}

/** Ask every badge to refresh now (e.g. after reading a conversation). */
export function refreshChatUnread(): void {
  void refresh()
}

export function useChatUnread(): State {
  const [s, setS] = useState(state)
  useEffect(() => {
    subs.add(setS)
    if (subs.size === 1) {
      void refresh()
      // Keep checking in the background only when chat pop-ups are on, so people hear about new messages.
      timer = window.setInterval(() => { if (document.visibilityState === 'visible' || alertsActive('chat')) void refresh() }, 15000)
    }
    return () => {
      subs.delete(setS)
      if (subs.size === 0 && timer) { window.clearInterval(timer); timer = undefined }
    }
  }, [])
  return s
}
