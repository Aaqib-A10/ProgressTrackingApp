import { callsApi } from './callsApi'

/**
 * Records the call: the picture is this browser tab (the meeting view, including
 * screen shares), the sound is everyone's voice mixed together. The video is uploaded
 * in pieces while recording, so a long meeting never has to fit in memory, and when
 * it stops it appears in the chat for everyone in it.
 */

export type RecorderState = 'idle' | 'starting' | 'recording' | 'saving' | 'error'

const PIECE_BYTES = 4 * 1024 * 1024

function pickMime(): string {
  const options = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
}

export function recordingSupported(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices
}

export class CallRecorder {
  private display: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private ctx: AudioContext | null = null
  private dest: MediaStreamAudioDestinationNode | null = null
  private connected = new Set<string>()
  private mixTimer: number | undefined
  private buffer: Blob[] = []
  private bufferBytes = 0
  private index = 0
  private queue: Promise<void> = Promise.resolve()
  private recId = ''
  private startedAt = 0
  private failed = false

  constructor(
    private callId: string,
    private sources: () => { mic: MediaStreamTrack | null; remotes: MediaStreamTrack[] },
    private onState: (s: RecorderState, info?: string) => void,
  ) {}

  async start(): Promise<void> {
    this.onState('starting')
    try {
      // Ask for this tab (Chrome offers it first). People can also pick a window or screen.
      this.display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions)
    } catch {
      this.onState('idle')
      return
    }
    const video = this.display.getVideoTracks()[0]
    if (!video) { this.cleanup(); this.onState('idle'); return }
    video.onended = () => { void this.stop() }

    // Mix the sound: tab audio already contains everyone else; add my microphone.
    this.ctx = new AudioContext()
    this.dest = this.ctx.createMediaStreamDestination()
    const tabAudio = this.display.getAudioTracks()[0]
    if (tabAudio) this.connect(tabAudio)
    this.mixIn(!tabAudio)
    // People who join later are added to the mix (when the tab sound was not shared).
    this.mixTimer = window.setInterval(() => this.mixIn(!tabAudio), 2000)

    const mime = pickMime()
    try {
      const r = await callsApi.startRecording(this.callId, mime)
      this.recId = r.recording.id
    } catch (e) {
      this.cleanup()
      this.onState('error', (e as Error).message || 'Could not start the recording')
      return
    }
    const stream = new MediaStream([video, ...this.dest.stream.getAudioTracks()])
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 })
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      this.buffer.push(e.data)
      this.bufferBytes += e.data.size
      if (this.bufferBytes >= PIECE_BYTES) this.flush()
    }
    this.recorder = rec
    this.startedAt = Date.now()
    rec.start(3000)
    this.onState('recording')
  }

  private connect(track: MediaStreamTrack) {
    if (!this.ctx || !this.dest || this.connected.has(track.id) || track.readyState !== 'live') return
    this.connected.add(track.id)
    this.ctx.createMediaStreamSource(new MediaStream([track])).connect(this.dest)
  }

  private mixIn(withRemotes: boolean) {
    const { mic, remotes } = this.sources()
    if (mic) this.connect(mic)
    if (withRemotes) remotes.forEach((t) => this.connect(t))
  }

  private flush() {
    if (!this.buffer.length) return
    const blob = new Blob(this.buffer, { type: 'application/octet-stream' })
    this.buffer = []
    this.bufferBytes = 0
    const i = this.index++
    this.queue = this.queue.then(() => this.upload(i, blob))
  }

  private async upload(i: number, blob: Blob) {
    if (this.failed) return
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await callsApi.recordingChunk(this.recId, i, blob)
        return
      } catch {
        await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)))
      }
    }
    this.failed = true
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording'
  }

  /** Stop and save. Resolves when the video is in the chat. */
  async stop(): Promise<void> {
    const rec = this.recorder
    if (!rec || rec.state === 'inactive') return
    this.onState('saving')
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
      try { rec.stop() } catch { resolve() }
    })
    this.flush()
    await this.queue
    const durationSec = Math.round((Date.now() - this.startedAt) / 1000)
    this.cleanup()
    if (this.failed) { this.onState('error', 'Part of the recording could not be uploaded'); return }
    try {
      await callsApi.finishRecording(this.recId, durationSec)
      this.onState('idle', 'saved')
    } catch (e) {
      this.onState('error', (e as Error).message || 'Could not save the recording')
    }
  }

  private cleanup() {
    window.clearInterval(this.mixTimer)
    this.display?.getTracks().forEach((t) => t.stop())
    this.display = null
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.dest = null
    this.recorder = null
  }
}
