import type { ImageSegmenter } from '@mediapipe/tasks-vision'

/**
 * Camera effects for video calls: blur the room, put a picture behind you, or a colour
 * filter. The person is cut out of each frame with MediaPipe's selfie model (it runs in
 * the browser, nothing leaves the computer), then drawn over the new background. The
 * result is a normal video track, so everyone in the call (and the recording) sees it.
 */

export type BgSetting = { kind: 'none' } | { kind: 'blur'; strength: 'light' | 'strong' } | { kind: 'image'; id: string }
export type FilterId = 'none' | 'touchup' | 'bright' | 'warm' | 'cool' | 'vivid' | 'bw' | 'vintage'
export interface EffectsSettings { bg: BgSetting; filter: FilterId }

export const NO_EFFECTS: EffectsSettings = { bg: { kind: 'none' }, filter: 'none' }

export const BACKGROUNDS: { id: string; name: string }[] = [
  { id: 'office', name: 'Office' },
  { id: 'meeting-room', name: 'Meeting room' },
  { id: 'living-room', name: 'Living room' },
  { id: 'cozy-corner', name: 'Cozy corner' },
  { id: 'lounge', name: 'Lounge' },
  { id: 'mountains', name: 'Mountains' },
  { id: 'lake', name: 'Lake' },
  { id: 'beach', name: 'Beach' },
  { id: 'forest', name: 'Forest' },
  { id: 'night-sky', name: 'Night sky' },
]
export const bgUrl = (id: string) => `/call-backgrounds/${id}.jpg`
export const bgThumb = (id: string) => `/call-backgrounds/${id}-thumb.jpg`

/** Colour filters (CSS filter strings, applied to the whole picture). */
export const FILTERS: { id: FilterId; name: string; css: string }[] = [
  { id: 'none', name: 'Natural', css: '' },
  { id: 'touchup', name: 'Touch up', css: 'brightness(1.06) contrast(0.95) saturate(1.06)' },
  { id: 'bright', name: 'Bright', css: 'brightness(1.18) contrast(1.03)' },
  { id: 'warm', name: 'Warm', css: 'sepia(0.22) saturate(1.2) brightness(1.03)' },
  { id: 'cool', name: 'Cool', css: 'saturate(0.92) hue-rotate(10deg) brightness(1.03) contrast(1.02)' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.45) contrast(1.08)' },
  { id: 'bw', name: 'Black & white', css: 'grayscale(1) contrast(1.12)' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(0.55) contrast(1.04) brightness(0.98) saturate(0.85)' },
]

const KEY = 'pt-call-effects'

export function loadEffects(): EffectsSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as EffectsSettings | null
    if (v && v.bg && v.filter && FILTERS.some((f) => f.id === v.filter)) {
      if (v.bg.kind === 'image' && !BACKGROUNDS.some((b) => b.id === (v.bg as { id: string }).id)) return { ...v, bg: { kind: 'none' } }
      return v
    }
  } catch { /* fresh */ }
  return NO_EFFECTS
}
export function saveEffects(s: EffectsSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}
export function effectsOn(s: EffectsSettings): boolean {
  return s.bg.kind !== 'none' || s.filter !== 'none'
}

/** Can this browser do it? (canvas filters + capturing a canvas as video) */
export function effectsSupported(): boolean {
  if (typeof document === 'undefined') return false
  const c = document.createElement('canvas')
  if (typeof c.captureStream !== 'function') return false
  const ctx = c.getContext('2d')
  return !!ctx && 'filter' in ctx
}

// ---- the selfie model (loaded once, the first time a background is picked) ----

let segmenter: Promise<ImageSegmenter> | null = null

function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenter) {
    segmenter = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
      const files = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
      const make = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/mediapipe/selfie_segmenter_landscape.tflite', delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      })
      // The graphics chip is much faster; plain CPU is the fallback (or forced for testing).
      let forceCpu = false
      try { forceCpu = localStorage.getItem('pt-fx-cpu') === '1' } catch { /* fine */ }
      if (forceCpu) return make('CPU')
      try { return await make('GPU') } catch { return await make('CPU') }
    })()
    segmenter.catch(() => { segmenter = null })
  }
  return segmenter
}

/** Start loading the model early (e.g. when the effects panel opens). */
export function preloadEffects(): void {
  void loadSegmenter().catch(() => undefined)
}

// A steady clock that keeps going in a background tab (timers in the page itself slow
// down to once a second there, which would freeze the picture others see).
function makeTicker(fps: number, onTick: () => void): () => void {
  try {
    const src = `let t=setInterval(()=>postMessage(0),${Math.round(1000 / fps)});onmessage=()=>{clearInterval(t);close()}`
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    const w = new Worker(url)
    URL.revokeObjectURL(url)
    w.onmessage = onTick
    return () => { w.postMessage('stop'); w.terminate() }
  } catch {
    const t = window.setInterval(onTick, Math.round(1000 / fps))
    return () => window.clearInterval(t)
  }
}

const MASK_W = 256
const MASK_H = 144
const FPS = 24

export class VideoEffects {
  readonly track: MediaStreamTrack
  private video = document.createElement('video')
  private out = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private person = document.createElement('canvas')
  private pctx: CanvasRenderingContext2D
  private small = document.createElement('canvas')
  private sctx: CanvasRenderingContext2D
  private maskCanvas = document.createElement('canvas')
  private mctx: CanvasRenderingContext2D
  private maskData = new ImageData(MASK_W, MASK_H)
  private seg: ImageSegmenter | null = null
  private bgImg: HTMLImageElement | null = null
  private bgId: string | null = null
  private s: EffectsSettings
  private stopTicker: () => void
  private lastTs = 0
  private closed = false
  private busy = false
  /** Slow computer: find the person every 2nd or 3rd frame (the picture still moves at full speed). */
  private segEvery = 1
  private segAvg = 0
  private frameNo = 0

  private constructor(input: MediaStreamTrack, s: EffectsSettings) {
    this.s = s
    this.ctx = this.out.getContext('2d')!
    this.pctx = this.person.getContext('2d')!
    this.small.width = MASK_W
    this.small.height = MASK_H
    this.sctx = this.small.getContext('2d', { willReadFrequently: false })!
    this.maskCanvas.width = MASK_W
    this.maskCanvas.height = MASK_H
    this.mctx = this.maskCanvas.getContext('2d')!
    const st = input.getSettings()
    this.out.width = this.person.width = st.width ?? 640
    this.out.height = this.person.height = st.height ?? 360
    this.video.muted = true
    this.video.playsInline = true
    this.video.srcObject = new MediaStream([input])
    this.track = this.out.captureStream(FPS).getVideoTracks()[0]
    try { (this.track as MediaStreamTrack & { contentHint: string }).contentHint = 'motion' } catch { /* old browser */ }
    this.stopTicker = makeTicker(FPS, () => this.frame())
  }

  /** Ready to use: the camera is playing and (if a background is on) the model has loaded. */
  static async create(input: MediaStreamTrack, s: EffectsSettings): Promise<VideoEffects> {
    const fx = new VideoEffects(input, s)
    try {
      await fx.video.play()
      await fx.apply(s)
      return fx
    } catch (e) {
      fx.destroy()
      throw e
    }
  }

  get settings(): EffectsSettings { return this.s }

  /** Change the effect (loads the model or picture first, so the switch is seamless). */
  async apply(s: EffectsSettings): Promise<void> {
    if (s.bg.kind !== 'none' && !this.seg) this.seg = await loadSegmenter()
    if (s.bg.kind === 'image' && s.bg.id !== this.bgId) {
      const id = s.bg.id
      const img = new Image()
      img.decoding = 'async'
      img.src = bgUrl(id)
      await img.decode()
      this.bgImg = img
      this.bgId = id
    }
    this.s = s
  }

  private frame() {
    if (this.closed || this.busy) return
    const v = this.video
    if (v.readyState < 2 || !v.videoWidth) return
    this.busy = true
    try {
      const w = v.videoWidth
      const h = v.videoHeight
      if (this.out.width !== w || this.out.height !== h) {
        this.out.width = this.person.width = w
        this.out.height = this.person.height = h
      }
      const css = FILTERS.find((f) => f.id === this.s.filter)?.css || 'none'
      const ctx = this.ctx
      if (this.s.bg.kind === 'none' || !this.seg) {
        ctx.globalCompositeOperation = 'copy'
        ctx.filter = css
        ctx.drawImage(v, 0, 0, w, h)
      } else {
        // 1) where is the person? (on a small copy: fast)
        if (this.frameNo++ % this.segEvery === 0) {
          const t0 = performance.now()
          this.sctx.drawImage(v, 0, 0, MASK_W, MASK_H)
          const ts = t0 > this.lastTs ? t0 : this.lastTs + 1
          this.lastTs = ts
          const res = this.seg.segmentForVideo(this.small, ts)
          const mask = res.confidenceMasks?.[0]
          if (mask) {
            const conf = mask.getAsFloat32Array()
            const d = this.maskData.data
            for (let i = 0; i < conf.length; i++) {
              // a soft edge: below 0.25 is background, above 0.75 is you
              const x = Math.min(1, Math.max(0, (conf[i] - 0.25) / 0.5))
              d[i * 4 + 3] = (x * x * (3 - 2 * x) * 255) | 0
            }
            this.mctx.putImageData(this.maskData, 0, 0)
          }
          res.close()
          const took = performance.now() - t0
          this.segAvg = this.segAvg ? this.segAvg * 0.9 + took * 0.1 : took
          this.segEvery = this.segAvg > 70 ? 4 : this.segAvg > 40 ? 3 : this.segAvg > 22 ? 2 : 1
        }
        // 2) you, cut out
        const p = this.pctx
        p.globalCompositeOperation = 'copy'
        p.filter = css
        p.drawImage(v, 0, 0, w, h)
        p.globalCompositeOperation = 'destination-in'
        p.filter = 'blur(2px)'
        p.drawImage(this.maskCanvas, 0, 0, w, h)
        p.filter = 'none'
        p.globalCompositeOperation = 'source-over'
        // 3) the new background, then you on top
        ctx.globalCompositeOperation = 'copy'
        if (this.s.bg.kind === 'blur') {
          const r = this.s.bg.strength === 'strong' ? 16 : 7
          ctx.filter = `blur(${r}px) ${css === 'none' ? '' : css}`.trim()
          // drawn a little bigger, so the blur does not fade at the edges
          ctx.drawImage(v, -r * 2, -r * 2, w + r * 4, h + r * 4)
        } else if (this.bgImg) {
          ctx.filter = css
          const iw = this.bgImg.naturalWidth
          const ih = this.bgImg.naturalHeight
          const k = Math.max(w / iw, h / ih)
          ctx.drawImage(this.bgImg, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k)
        }
        ctx.filter = 'none'
        ctx.globalCompositeOperation = 'source-over'
        ctx.drawImage(this.person, 0, 0)
      }
      // Touch up: a soft glow over the picture smooths skin a little.
      if (this.s.filter === 'touchup') {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 0.28
        ctx.filter = 'blur(3px)'
        ctx.drawImage(this.out, 0, 0)
        ctx.globalAlpha = 1
      }
      ctx.filter = 'none'
    } catch {
      /* one bad frame: try the next one */
    } finally {
      this.busy = false
    }
  }

  destroy(): void {
    if (this.closed) return
    this.closed = true
    this.stopTicker()
    this.track.stop()
    this.video.pause()
    this.video.srcObject = null
  }
}
