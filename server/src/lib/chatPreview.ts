/**
 * Short words for a message with a file, for the chat list and pop-up notifications:
 * "🎤 Voice message (0:12)", "📷 Photo", "🎥 Video", or "📎 report.pdf".
 */
export function fileLabel(name: string | null, mime: string | null): string {
  const voice = /^voice-note-(\d+)s\./.exec(name ?? '')
  if (voice) {
    const s = Number(voice[1])
    return `🎤 Voice message (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`
  }
  if (/^audio\//i.test(mime ?? '')) return '🎤 Voice message'
  if (/^image\//i.test(mime ?? '')) return '📷 Photo'
  if (/^video\//i.test(mime ?? '')) return '🎥 Video'
  return `📎 ${name ?? 'File'}`
}
