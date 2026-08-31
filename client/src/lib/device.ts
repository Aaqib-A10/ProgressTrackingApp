/**
 * Tiny client-side device check — mirrors the server's `parseUserAgent`
 * (server/src/lib/userAgent.ts) closely enough to decide "phone/tablet vs laptop".
 * Used only for a friendly UI notice; the server is the real enforcer.
 */
export function isMobileOrTablet(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  return /Mobi|iPhone|iPod|iPad|Android|Tablet|Windows Phone/.test(ua)
}
