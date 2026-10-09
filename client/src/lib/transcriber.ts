import { callsApi } from './callsApi'

/**
 * Turns MY microphone into text while the AI note taker is on, using the browser's
 * built-in speech recognition (Chrome and Edge). Each person transcribes only their
 * own voice, so every line has the right speaker. Finished sentences are saved for the
 * notes; words still being spoken are sent as live captions.
 */

interface SpeechResultLike { isFinal: boolean; 0: { transcript: string } }
interface SpeechEventLike { resultIndex: number; results: ArrayLike<SpeechResultLike> }
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type Ctor = new () => Recognition

function ctor(): Ctor | null {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && !!ctor()
}

/** What people speak in the call. "mixed" = Urdu, English or both, written in English. */
export const SPEECH_LANGS = [
  { code: 'mixed', label: 'Urdu and English mixed (notes in English)', browser: 'en-IN' },
  { code: 'en', label: 'English only', browser: 'en-US' },
  { code: 'ur', label: 'Urdu (keep Urdu script)', browser: 'ur-PK' },
]

/** Language code for the browser's own speech recognition (live captions). */
export function browserLang(code: string): string {
  return SPEECH_LANGS.find((l) => l.code === code)?.browser ?? 'en-US'
}

const LANG_KEY = 'pt-speech-mode'
export function getSpeechLang(): string {
  try { const v = localStorage.getItem(LANG_KEY); return SPEECH_LANGS.some((l) => l.code === v) ? v! : 'mixed' } catch { return 'mixed' }
}
export function setSpeechLang(code: string): void {
  try { localStorage.setItem(LANG_KEY, code) } catch { /* ignore */ }
}

export type TranscriberState = 'off' | 'listening' | 'unsupported' | 'blocked' | 'error'

export class Transcriber {
  private rec: Recognition | null = null
  private running = false
  private lastInterim = 0
  private restartTimer: number | undefined

  /** captionsOnly: the server writes the notes from audio, so finished sentences here are only live captions. */
  constructor(private callId: string, private lang: string, private onState: (s: TranscriberState) => void, private captionsOnly = false) {}

  start(): void {
    const C = ctor()
    if (!C) { this.onState('unsupported'); return }
    if (this.running) return
    this.running = true
    this.open(C)
  }

  private open(C: Ctor) {
    const r = new C()
    r.lang = browserLang(this.lang)
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const text = res[0].transcript.trim()
        if (!text) continue
        if (res.isFinal) void callsApi.transcript(this.callId, text, !this.captionsOnly).catch(() => undefined)
        else interim += (interim ? ' ' : '') + text
      }
      // Live captions: at most about once a second.
      const now = Date.now()
      if (interim && now - this.lastInterim > 900) {
        this.lastInterim = now
        void callsApi.transcript(this.callId, interim.slice(-400), false).catch(() => undefined)
      }
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.running = false
        this.onState('blocked')
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.onState('error')
      }
    }
    // The browser ends a session every minute or so, or after silence: keep going.
    r.onend = () => {
      if (!this.running) return
      window.clearTimeout(this.restartTimer)
      this.restartTimer = window.setTimeout(() => { if (this.running) this.open(C) }, 250)
    }
    this.rec = r
    try {
      r.start()
      this.onState('listening')
    } catch {
      this.onState('error')
    }
  }

  stop(): void {
    this.running = false
    window.clearTimeout(this.restartTimer)
    try { this.rec?.stop() } catch { /* already stopped */ }
    this.rec = null
    this.onState('off')
  }
}
