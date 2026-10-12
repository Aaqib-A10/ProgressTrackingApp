import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '../prisma'
import * as Calls from './calls'
import { transcribeAudio, type SpeechMode } from './groq'
import * as Translate from './translate'

/**
 * Server-side transcription for the AI note taker.
 *
 * While notes are on, one browser in the call records each person's sound separately and
 * sends a short piece whenever they pause (a few seconds of speech). Each piece is turned
 * into text with Groq Whisper in that person's language, written in Roman Urdu, saved as a
 * transcript line with the right speaker and shown as a live caption, usually 2 to 3
 * seconds after the sentence ends. The audio file is deleted straight away.
 *
 * Several pieces are transcribed at the same time, within Groq's per-minute limit
 * (GROQ_STT_RPM, 19 on the free tier; raise it on a paid plan).
 */

const DIR = path.resolve('uploads', 'stt')
const RPM = () => Math.max(1, Number(process.env.GROQ_STT_RPM ?? 19))
const CONCURRENCY = () => Math.max(1, Number(process.env.GROQ_STT_CONCURRENCY ?? 3))

interface Job {
  id: string
  callId: string
  userId: string
  speakerName: string
  at: Date
  file: string
  mime: string
  mode: SpeechMode
  /** How long the person was actually speaking in this piece (to spot made-up text). */
  speechMs?: number
}

const queue: Job[] = []
const pendingByCall = new Map<string, number>()
let active = 0
const starts: number[] = [] // when the last requests started (rate limit)

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
  pump()
}

/** Wait for a free place under the per-minute limit. */
async function slot(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (starts.length && now - starts[0] > 60_000) starts.shift()
    if (starts.length < RPM()) { starts.push(now); return }
    await new Promise((ok) => setTimeout(ok, Math.max(200, 60_000 - (now - starts[0]) + 50)))
  }
}

function pump(): void {
  while (active < CONCURRENCY() && queue.length) {
    const job = queue.shift()!
    active++
    void run(job).finally(() => { active--; pump() })
  }
}

/** What this person said just before (helps Whisper continue a sentence cut in two). */
async function previousWords(job: Job): Promise<string | undefined> {
  const prev = await prisma.callTranscriptLine.findFirst({ where: { callId: job.callId, userId: job.userId, at: { lt: job.at, gt: new Date(job.at.getTime() - 90_000) } }, orderBy: { at: 'desc' }, select: { text: true } })
  return prev?.text.slice(-200) || undefined
}

async function run(job: Job): Promise<void> {
  try {
    await slot()
    const audio = await fs.readFile(job.file)
    const prompt = await previousWords(job).catch(() => undefined)
    const text = await transcribeAudio(audio, { mode: job.mode, prompt, mime: job.mime, speechMs: job.speechMs })
    if (!text) return
    const line = await prisma.callTranscriptLine.create({ data: { callId: job.callId, userId: job.userId, speakerName: job.speakerName, text, at: job.at } })
    // The two lines before this one help to read names and half sentences right.
    const before = await prisma.callTranscriptLine.findMany({ where: { callId: job.callId, at: { lt: job.at } }, orderBy: { at: 'desc' }, take: 2, select: { speakerName: true, text: true, textRoman: true } })
    const context = before.reverse().map((b) => `${b.speakerName}: ${b.textRoman ?? b.text}`).join('\n')
    const shown = await Translate.romanizeLine({ id: line.id, callId: job.callId, text, context })
    const live = Calls.getLive(job.callId)
    if (live) Calls.addCaption(live, job.userId, job.speakerName, shown, true)
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

/** Wait until every piece of this call has been transcribed (or the time runs out). */
export async function waitForCall(callId: string, maxMs = 15 * 60_000): Promise<void> {
  const until = Date.now() + maxMs
  while (pendingFor(callId) > 0 && Date.now() < until) await new Promise((ok) => setTimeout(ok, 1000))
}

/** Test helper. */
export function resetStt(): void {
  queue.length = 0
  pendingByCall.clear()
  starts.length = 0
}
