import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'

/**
 * Background-noise removal for my microphone (traffic, fans, people talking nearby,
 * keyboard). Uses RNNoise, an open-source noise remover that runs inside the browser:
 * the sound never leaves the computer for this. If anything goes wrong it falls back
 * to the plain microphone, so a call never ends up silent because of it.
 */

const KEY = 'pt-noise-filter'
export function noiseFilterPref(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}
export function setNoiseFilterPref(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* ignore */ }
}

let wasm: Promise<ArrayBuffer> | null = null

export interface NoiseFilter {
  /** The cleaned-up microphone (send this). */
  track: MediaStreamTrack
  setEnabled(on: boolean): void
  destroy(): void
}

export async function createNoiseFilter(mic: MediaStreamTrack): Promise<NoiseFilter | null> {
  if (typeof AudioWorkletNode === 'undefined') return null
  try {
    const ctx = new AudioContext({ sampleRate: 48000 })
    wasm = wasm ?? loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath })
    const [binary] = await Promise.all([wasm, ctx.audioWorklet.addModule(rnnoiseWorkletPath)])
    await ctx.resume().catch(() => undefined)
    if (ctx.state !== 'running') {
      // The browser did not let sound processing start: use the plain microphone.
      void ctx.close()
      return null
    }
    const src = ctx.createMediaStreamSource(new MediaStream([mic]))
    const rnnoise = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary })
    const dest = ctx.createMediaStreamDestination()
    src.connect(rnnoise)
    rnnoise.connect(dest)
    let on = true
    const track = dest.stream.getAudioTracks()[0]
    return {
      track,
      setEnabled(next: boolean) {
        if (next === on) return
        on = next
        try {
          src.disconnect()
          rnnoise.disconnect()
          if (on) { src.connect(rnnoise); rnnoise.connect(dest) } else src.connect(dest)
        } catch { /* already closed */ }
      },
      destroy() {
        try { rnnoise.destroy() } catch { /* ignore */ }
        track.stop()
        void ctx.close().catch(() => undefined)
      },
    }
  } catch {
    return null
  }
}
