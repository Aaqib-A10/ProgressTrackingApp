import { useEffect, useState } from 'react'
import { chatApi } from '../../lib/chatApi'

// One shared poller for the chat unread badge (top bar + floating chat), so the
// app makes a single request every 15 seconds no matter how many badges render.

type State = { total: number; conversations: number }
let state: State = { total: 0, conversations: 0 }
const subs = new Set<(s: State) => void>()
let timer: number | undefined

async function refresh(): Promise<void> {
  try {
    state = await chatApi.unread()
    subs.forEach((f) => f(state))
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
      timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 15000)
    }
    return () => {
      subs.delete(setS)
      if (subs.size === 0 && timer) { window.clearInterval(timer); timer = undefined }
    }
  }, [])
  return s
}
