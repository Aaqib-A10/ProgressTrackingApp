/**
 * Errors that happen on a Metriq page but were thrown by code that is not Metriq's: a browser
 * extension, an ad blocker, antivirus "web protection", a password manager or a translator
 * that injects its own script into the page. Their stacks point at "<anonymous>",
 * "chrome-extension://..." or another site, never at our own /assets files, and their names
 * are often scrambled (_0x5229ea). Nothing in our code can fix them, so they stay out of the
 * error log.
 *
 * The rule: if the stack has frames and NOT ONE of them is a file from the page's own site,
 * the error is foreign. With no stack we cannot tell, so it is kept.
 *
 * The web app has the same rule in client/src/lib/errorReporter.ts (keep the two in step).
 */

/** Where each stack frame's code came from ("https://site/assets/x.js:1:2", "<anonymous>:1:30"). */
export function frameLocations(stack: string): string[] {
  const out: string[] = []
  for (const raw of stack.split('\n')) {
    const line = raw.trim()
    let loc: string | null = null
    if (line.startsWith('at ')) {
      // Chrome / Edge: "at fn (where)" or "at where"
      const m = /\(([^()]*)\)\s*$/.exec(line)
      loc = m ? m[1] : line.slice(3).replace(/^async\s+/, '')
    } else if (/^[^\s@]*@\S+:\d+(:\d+)?$/.test(line)) {
      // Firefox / Safari: "fn@where:line:col"
      loc = line.slice(line.lastIndexOf('@', line.search(/:\d+(:\d+)?$/)) + 1)
    }
    if (loc) out.push(loc.trim())
  }
  return out
}

function hostOf(u: string): string | null {
  try { return new URL(u).host || null } catch { return null }
}

/**
 * True when the error came from someone else's script on our page.
 * `pageUrl` is the page the person was on; when it is not a full address, any http(s) file counts as ours.
 */
export function isForeignScriptError(stack: string | null | undefined, pageUrl: string | null | undefined): boolean {
  if (!stack) return false
  const locs = frameLocations(stack)
  if (!locs.length) return false
  const own = pageUrl && /^https?:\/\//i.test(pageUrl) ? hostOf(pageUrl) : null
  const ours = locs.some((l) => /^https?:\/\//i.test(l) && (!own || hostOf(l) === own))
  return !ours
}
