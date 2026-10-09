import { prisma } from '../prisma'
import { chatJson, groqEnabled } from './groq'

/**
 * Roman Urdu and English for every transcript line.
 *
 * Whisper writes Urdu correctly in Urdu script (its own "translate to English" mode is
 * much worse), so each line is written down as said and then a language model writes it
 * again in Roman Urdu (Urdu in English letters, the way the team types it: "shaadi to
 * maine nahin karni") and in English. Roman Urdu is what people see by default; English
 * and the Urdu script stay available.
 *
 * Uses its own Groq model (default openai/gpt-oss-20b) so its free daily limit is
 * separate from the model that writes the notes. Lines are translated one after the
 * other in the background, with the previous lines as context; a line that cannot be
 * translated now is tried again (in bulk) when the notes are written.
 */

const MODEL = () => process.env.GROQ_TRANSLATE_MODEL || 'openai/gpt-oss-20b'

const SYSTEM =
  'You rewrite lines from a work meeting transcript. The team is in Pakistan and speaks Urdu, Hindi-like Urdu, Punjabi or English, often mixed, ' +
  'written by speech recognition in Urdu script, Hindi script or Roman letters. For every line give two versions: ' +
  '"roman": exactly the same words in Roman Urdu, the way Pakistanis type Urdu on WhatsApp in English letters (for example "shaadi to maine nahin karni, wo to khair hai"). ' +
  'Do not translate in "roman": keep the speaker\'s own words and word order, and keep English words in English. ' +
  '"en": a faithful, natural English translation. Keep names of people, companies, products, numbers and dates exactly. ' +
  'If a line is already English, both versions are the line unchanged. Never add anything that was not said. Answer with JSON only.'

// Common English words vs. common Roman-Urdu words: decides whether a Latin-letter line needs translating.
const EN_WORDS = new Set('the a an is are was were be been we you they he she it i this that these those to of in on at for with and or but not will would can could should have has had do does did my your our their what when where why how which who please'.split(' '))
const UR_WORDS = new Set('hai hain ha tha thi the ka ki ke ko se mein main mai nahi nahin kya aur yeh ye woh wo raha rahi rahe kar karo karna karte karta kiya ho hoga hogi bhi to ab abhi phir kuch sab jo jab tak wala wali hum ham aap tum mera meri hamara apna bilkul theek sahi acha accha chalo dekh dekhte'.split(' '))

/** Does this line need translating (not plain English)? */
export function needsTranslation(text: string): boolean {
  if (/[؀-ۿݐ-ݿऀ-ॿ਀-੿]/.test(text)) return true
  const words = text.toLowerCase().match(/[a-z']+/g) ?? []
  if (!words.length) return false
  let en = 0
  let ur = 0
  for (const w of words) { if (EN_WORDS.has(w)) en++; if (UR_WORDS.has(w)) ur++ }
  return ur >= 2 && ur >= en
}

const queue: string[] = []
const pendingByCall = new Map<string, number>()
let running = false

export function translatePending(callId: string): number {
  return pendingByCall.get(callId) ?? 0
}

/** A new transcript line: English lines are copied, the rest go to the translator. Returns the text to show now (English lines), else null. */
export async function addLine(line: { id: string; callId: string; text: string }): Promise<string | null> {
  if (!needsTranslation(line.text)) {
    await prisma.callTranscriptLine.update({ where: { id: line.id }, data: { textEn: line.text, textRoman: line.text } })
    return line.text
  }
  if (!groqEnabled()) return null
  queue.push(line.id)
  pendingByCall.set(line.callId, translatePending(line.callId) + 1)
  void work()
  return null
}

/** Called after each translated line (to show it as a caption). */
let onTranslated: ((line: { id: string; callId: string; userId: string; speakerName: string; textEn: string; textRoman: string }) => void) | null = null
export function setOnTranslated(fn: typeof onTranslated): void {
  onTranslated = fn
}

async function work(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const id = queue.shift()!
      const line = await prisma.callTranscriptLine.findUnique({ where: { id } })
      if (!line) continue
      try {
        if (!line.textEn || !line.textRoman) {
          const before = await prisma.callTranscriptLine.findMany({ where: { callId: line.callId, at: { lt: line.at } }, orderBy: { at: 'desc' }, take: 3, select: { speakerName: true, text: true, textRoman: true } })
          const context = before.reverse().map((b) => `${b.speakerName}: ${b.textRoman ?? b.text}`).join('\n')
          const out = await translateOne(line.text, context)
          if (out.en || out.roman) {
            const textEn = out.en || line.text
            const textRoman = out.roman || textEn
            await prisma.callTranscriptLine.update({ where: { id }, data: { textEn, textRoman } })
            onTranslated?.({ id, callId: line.callId, userId: line.userId, speakerName: line.speakerName, textEn, textRoman })
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[translate] line not translated now (tried again with the notes):', (e as Error).message)
      } finally {
        const n = translatePending(line.callId) - 1
        if (n > 0) pendingByCall.set(line.callId, n)
        else pendingByCall.delete(line.callId)
      }
    }
  } finally {
    running = false
  }
}

function parseJson(text: string): Record<string, unknown> {
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('no JSON in the translation')
  return JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>
}

async function translateOne(text: string, context: string): Promise<{ roman: string; en: string }> {
  const user = `${context ? `Earlier in the meeting (for context only, do not rewrite):\n${context}\n\n` : ''}Rewrite this line:\n${text}\n\nReturn {"roman": "Roman Urdu", "en": "English"}`
  const j = parseJson(await chatJson(SYSTEM, user, 800, MODEL()))
  return { roman: String(j.roman ?? '').trim(), en: String(j.en ?? '').trim() }
}

/** Translate every line of a call that has no English yet (in groups of 25). Used before writing the notes. */
export async function translateMissing(callId: string): Promise<void> {
  if (!groqEnabled()) return
  const lines = await prisma.callTranscriptLine.findMany({ where: { callId, OR: [{ textEn: null }, { textRoman: null }] }, orderBy: { at: 'asc' }, select: { id: true, text: true } })
  for (const l of lines) if (!needsTranslation(l.text)) await prisma.callTranscriptLine.update({ where: { id: l.id }, data: { textEn: l.text, textRoman: l.text } })
  const todo = lines.filter((l) => needsTranslation(l.text))
  for (let i = 0; i < todo.length; i += 25) {
    const group = todo.slice(i, i + 25)
    try {
      const user = `Rewrite each line. Return {"lines": [{"i": number, "roman": "Roman Urdu", "en": "English"}]} with one entry per line, same i.\n${JSON.stringify(group.map((l, n) => ({ i: n, text: l.text })))}`
      const j = parseJson(await chatJson(SYSTEM, user, 6000, MODEL()))
      const out = Array.isArray(j.lines) ? (j.lines as { i?: unknown; en?: unknown; roman?: unknown }[]) : []
      for (const o of out) {
        const n = Number(o.i)
        const en = String(o.en ?? '').trim()
        const roman = String(o.roman ?? '').trim()
        if (Number.isInteger(n) && group[n] && (en || roman)) await prisma.callTranscriptLine.update({ where: { id: group[n].id }, data: { textEn: en || roman, textRoman: roman || en } })
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[translate] could not translate part of the transcript:', (e as Error).message)
    }
  }
}

/** Wait until the background translator has finished this call's lines (at most `maxMs`). */
export async function waitForCall(callId: string, maxMs = 60_000): Promise<void> {
  const until = Date.now() + maxMs
  while (translatePending(callId) > 0 && Date.now() < until) await new Promise((ok) => setTimeout(ok, 500))
}

export function resetTranslate(): void {
  queue.length = 0
  pendingByCall.clear()
}
