import { prisma } from '../prisma'
import { chatJson, groqEnabled, quickJson } from './groq'

/**
 * Roman Urdu and English for every transcript line.
 *
 * Whisper writes Urdu speech in Urdu script. Each line is then written again, word for
 * word, in Roman Urdu (Urdu in English letters, the way the team types it: "shaadi to
 * maine nahin karni"), with English words in normal English ("website", "meeting").
 * Nothing is translated in Roman Urdu: it is the same words, only in other letters.
 *
 * Live: every new line is written in Roman Urdu straight away (about half a second) so
 * the caption is readable. When the notes are written, all lines get a second, careful
 * pass with the lines around them as context, plus an English translation.
 *
 * Uses its own Groq model (default openai/gpt-oss-20b) so its free daily limit is
 * separate from the model that writes the notes.
 */

const MODEL = () => process.env.GROQ_TRANSLATE_MODEL || 'openai/gpt-oss-20b'

const ROMAN_RULES =
  'Transliterate, never translate: keep exactly the speaker\'s words and word order, only in English letters, the way Pakistanis type Urdu on WhatsApp ' +
  '(for example "shaadi to maine nahin karni, wo to khair hai"). ' +
  'English words said in the middle of Urdu are often written in Urdu script by speech recognition (ویب سائٹ, میٹنگ, ڈیزائن, فائنل, ٹیم): write them in normal English spelling (website, meeting, design, final, team). ' +
  'Keep names of people, companies and products, numbers and dates exactly. Do not add, drop, fix or summarise words. '

const LIVE_SYSTEM =
  'You turn one line of a Pakistani work meeting (Urdu, often mixed with English, written by speech recognition) into Roman Urdu. ' +
  ROMAN_RULES + 'If the line is already in English letters, return it unchanged. Answer JSON {"roman": "..."}.'

const SYSTEM =
  'You rewrite lines from a work meeting transcript. The team is in Pakistan and speaks Urdu or English, often mixed, ' +
  'written by speech recognition in Urdu script, Hindi script or Roman letters. For every line give two versions: ' +
  '"roman": the line in Roman Urdu. ' + ROMAN_RULES +
  '"en": a faithful, natural English translation of the same line. ' +
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

/** Lines being written in Roman Urdu right now, per call (the notes wait for them). */
const pendingByCall = new Map<string, number>()

export function translatePending(callId: string): number {
  return pendingByCall.get(callId) ?? 0
}

/** Is the line in Urdu or Hindi letters (so it needs Roman Urdu)? */
export function needsRoman(text: string): boolean {
  return /[؀-ۿݐ-ݿऀ-ॿ਀-੿]/.test(text)
}

/**
 * A new transcript line, written in Roman Urdu now (for the live caption). Lines already
 * in English letters are kept as they are. Returns the text to show: Roman Urdu, or the
 * line as said when Groq could not answer in time (it is finished with the notes).
 */
export async function romanizeLine(line: { id: string; callId: string; text: string; context?: string }): Promise<string> {
  if (!needsRoman(line.text)) {
    // Already in English letters (English, or Roman Urdu as said): nothing to rewrite.
    await prisma.callTranscriptLine.update({ where: { id: line.id }, data: { textRoman: line.text, ...(needsTranslation(line.text) ? {} : { textEn: line.text }) } })
    return line.text
  }
  if (!groqEnabled()) return line.text
  pendingByCall.set(line.callId, translatePending(line.callId) + 1)
  try {
    const user = `${line.context ? `Earlier lines (context only, do not rewrite):\n${line.context}\n\n` : ''}Line:\n${line.text}`
    const out = await quickJson(LIVE_SYSTEM, user, MODEL(), 500, 6000)
    if (!out) return line.text
    const roman = String(parseJson(out).roman ?? '').trim()
    if (!roman) return line.text
    await prisma.callTranscriptLine.update({ where: { id: line.id }, data: { textRoman: roman } })
    return roman
  } catch {
    return line.text
  } finally {
    const n = translatePending(line.callId) - 1
    if (n > 0) pendingByCall.set(line.callId, n)
    else pendingByCall.delete(line.callId)
  }
}

function parseJson(text: string): Record<string, unknown> {
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('no JSON in the translation')
  return JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>
}

/** Translate every line of a call that has no English yet (in groups of 25). Used before writing the notes. */
export async function translateMissing(callId: string): Promise<void> {
  if (!groqEnabled()) return
  // Lines without English yet: their Roman Urdu is also redone, carefully, with context.
  const lines = await prisma.callTranscriptLine.findMany({ where: { callId, OR: [{ textEn: null }, { textRoman: null }] }, orderBy: { at: 'asc' }, select: { id: true, text: true, textRoman: true } })
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
        // Keep the live Roman Urdu if this pass gave none.
        if (Number.isInteger(n) && group[n] && (en || roman)) await prisma.callTranscriptLine.update({ where: { id: group[n].id }, data: { textEn: en || roman, textRoman: roman || group[n].textRoman || en } })
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
  pendingByCall.clear()
}
