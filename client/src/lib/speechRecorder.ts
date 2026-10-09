import { callsApi } from './callsApi'

/**
 * For the AI note taker (server transcription): records ONE person's sound (my microphone,
 * or another person's sound as it arrives in the call) and sends it in short pieces,
 * labelled with that person. A piece is cut at a natural pause once it is 15 seconds long
 * (or at 30 seconds whatever happens), and pieces where I did not speak are not sent.
 * The server turns each piece into text with Groq Whisper and labels it with my name.
 *
 * "Speech" means clearly louder than the room: the recorder keeps track of the
 * background level and only counts sound well above it, so far-away voices, fans
 * and traffic do not make a piece count as speech. A piece needs at least 1.5
 * seconds of real speech to be sent at all.
 */

export type SpeechMode = 'mixed' | 'en' | 'ur'

const MIN_PIECE_MS = 15_000
const MAX_PIECE_MS = 30_000
const PAUSE_MS = 600
const MIN_SPEECH_MS = 1500
const LEVEL = 0.012 // RMS above this (and well above the room) counts as speech
const ABOVE_ROOM = 3 // speech must be this many times louder than the background

function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''
}

export function serverSpeechSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!pickMime()
}

interface Piece { rec: MediaRecorder; chunks: Blob[]; started: number; speechMs: number; firstVoice: number | null }

export class SpeechRecorder {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private timer: number | undefined
  private piece: Piece | null = null
  private lastVoice = 0
  private room = 0.01 // running estimate of the background level
  private running = false
  private uploads: Promise<void> = Promise.resolve()
  private mime = pickMime()

  constructor(private callId: string, private track: MediaStreamTrack, private mode: SpeechMode, private speakerId: string, private onError?: (msg: string) => void) {}

  start(): void {
    if (this.running || !this.mime) return
    this.running = true
    this.ctx = new AudioContext()
    const src = this.ctx.createMediaStreamSource(new MediaStream([this.track]))
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    src.connect(this.analyser)
    this.piece = this.newPiece()
    const buf = new Float32Array(this.analyser.fftSize)
    this.timer = window.setInterval(() => {
      const p = this.piece
      if (!this.analyser || !p) return
      this.analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const now = Date.now()
      const rms = Math.sqrt(sum / buf.length)
      // Background follows quiet moments quickly and loud moments only slowly.
      this.room = rms < this.room ? this.room * 0.8 + rms * 0.2 : this.room * 0.995 + rms * 0.005
      if (rms > Math.max(LEVEL, this.room * ABOVE_ROOM) && this.track.enabled) { p.speechMs += 100; this.lastVoice = now; p.firstVoice ??= now }
      const age = now - p.started
      if ((age > MIN_PIECE_MS && now - this.lastVoice > PAUSE_MS) || age > MAX_PIECE_MS) this.cut()
    }, 100)
  }

  private newPiece(): Piece {
    const rec = new MediaRecorder(new MediaStream([this.track]), { mimeType: this.mime, audioBitsPerSecond: 32_000 })
    const piece: Piece = { rec, chunks: [], started: Date.now(), speechMs: 0, firstVoice: null }
    rec.ondataavailable = (e) => { if (e.data.size) piece.chunks.push(e.data) }
    rec.onstop = () => {
      // Nobody spoke in this piece: nothing to send.
      if (piece.speechMs < MIN_SPEECH_MS || !piece.chunks.length) return
      const blob = new Blob(piece.chunks, { type: this.mime.split(';')[0] })
      const durationMs = Date.now() - piece.started
      const spokeAt = piece.firstVoice ?? piece.started
      this.uploads = this.uploads.then(() => this.upload(blob, durationMs, spokeAt))
    }
    rec.start()
    return piece
  }

  /** Close the current piece and (while running) start the next one straight away. */
  private cut() {
    const old = this.piece
    this.piece = this.running ? this.newPiece() : null
    try { old?.rec.stop() } catch { /* already stopped */ }
  }

  private async upload(blob: Blob, durationMs: number, spokeAt: number) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await callsApi.audio(this.callId, blob, this.mode, durationMs, this.speakerId, spokeAt)
        return
      } catch (e) {
        const msg = (e as Error).message || ''
        const status = (e as { status?: number }).status
        if (status === 409 || status === 410 || /ended|off/i.test(msg)) return // notes off, call over, or another browser records
        if (attempt === 2) this.onError?.('Some speech could not be sent for the notes')
        await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)))
      }
    }
  }

  /** Stop and send the last piece. Resolves when everything has been sent. */
  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    window.clearInterval(this.timer)
    this.cut()
    await new Promise((ok) => setTimeout(ok, 300)) // let the recorder hand over its data
    await this.uploads
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.analyser = null
  }
}
