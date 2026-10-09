import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '../prisma'
import * as Calls from './calls'
import { transcribeAudio, type SpeechMode } from './groq'
import * as Translate from './translate'

// A rewritten line becomes the live caption, in Roman Urdu (English stays English).
Translate.setOnTranslated((l) => {
  const live = Calls.getLive(l.callId)
  if (live) Calls.addCaption(live, l.userId, l.speakerName, l.textRoman, true)
})

/**
 * Server-side transcription queue for the AI note taker.
 *
 * While notes are on, one browser in the call records each person's sound separately and
 * sends a short piece (cut at a pause, 15 to 45 seconds) whenever they have spoken.
 * Pieces are transcribed one at a time with Groq Whisper (free tier: about 20 a
 * minute), saved as transcript lines with the right speaker, and shown as captions.
 * The audio file is deleted as soon as it has been turned into text.
 */

const DIR = path.resolve('uploads', 'stt')
const MIN_GAP_MS = Number(process.env.GROQ_STT_MIN_GAP_MS ?? 3200) // stay under ~20 requests a minute

interface Job {
  id: string
  callId: string
  userId: string
  speakerName: string
  at: Date
  file: string
  mime: string
  mode: SpeechMode
  prompt?: string
}

const queue: Job[] = []
const pendingByCall = new Map<string, number>()
let running = false
let lastRun = 0

export function pendingFor(callId: string): number {
  return pendingByCall.get(callId) ?? 0
}

export async function enqueue(input: Omit<Job, 'id' | 'file'> & { audio: Buffer }): Promise<void> {
  await fs.mkdir(DIR, { recursive: true })
  const id = randomUUID()
  const file = path.join(DIR, `${id}.audio`)
  await fs.writeFile(file, input.audio)
  const { audio: _audio, ...rest } = input
  queue.push({ ...rest, id, file })
  pendingByCall.set(input.callId, pendingFor(input.callId) + 1)
  void work()
}

async function work(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      const wait = lastRun + MIN_GAP_MS - Date.now()
      if (wait > 0) await new Promise((ok) => setTimeout(ok, wait))
      lastRun = Date.now()
      try {
        const audio = await fs.readFile(job.file)
        const text = await transcribeAudio(audio, { mode: job.mode, prompt: job.prompt, mime: job.mime })
        if (text) {
          const line = await prisma.callTranscriptLine.create({ data: { callId: job.callId, userId: job.userId, speakerName: job.speakerName, text, at: job.at } })
          // English straight away when it already is; otherwise the caption shows once translated.
          const en = await Translate.addLine({ id: line.id, callId: job.callId, text })
          const live = Calls.getLive(job.callId)
          if (live && en) Calls.addCaption(live, job.userId, job.speakerName, en, true)
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[stt] could not transcribe a piece:', (e as Error).message)
      } finally {
        await fs.rm(job.file, { force: true }).catch(() => undefined)
        const n = pendingFor(job.callId) - 1
        if (n > 0) pendingByCall.set(job.callId, n)
        else pendingByCall.delete(job.callId)
      }
    }
  } finally {
    running = false
  }
}

/** Wait until every piece of this call has been transcribed (or the time runs out). */
export async function waitForCall(callId: string, maxMs = 15 * 60_000): Promise<void> {
  const until = Date.now() + maxMs
  while (pendingFor(callId) > 0 && Date.now() < until) await new Promise((ok) => setTimeout(ok, 1000))
}

/** Test helper. */
export function resetStt(): void {
  queue.length = 0
  pendingByCall.clear()
  lastRun = 0
}
