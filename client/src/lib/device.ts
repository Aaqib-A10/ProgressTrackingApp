/**
 * Client-side "is this a phone/tablet?" check for the attendance laptop-only gate.
 *
 * The UA string alone is NOT enough: Chrome's "Request Desktop Site" rewrites the
 * UA (and the UA-Client-Hints) to look like a desktop, which is how the gate was
 * bypassed. So we also read the PHYSICAL input capabilities via media queries —
 * `(any-pointer: fine)` / `(any-hover: hover)` — which desktop mode does NOT
 * change. A real phone/tablet has only a coarse pointer and no hover; a laptop
 * (even a touchscreen one) has a trackpad/mouse, so it is never falsely flagged.
 *
 * The server re-checks this via the X-Client-Mobile header (set in api.ts) and is
 * the real enforcer; this also drives the in-app "laptop only" notice.
 */
export function isMobileOrTablet(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const uaMobile = /Mobi|iPhone|iPod|iPad|Android|Tablet|Windows Phone/.test(ua)

  const mm = (q: string) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false)
  const coarse = mm('(any-pointer: coarse)')
  const noFinePointer = !mm('(any-pointer: fine)')
  const noHover = !mm('(any-hover: hover)')

  // userAgentData.mobile stays a reliable positive on Chromium mobile.
  const uaDataMobile = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile === true

  return uaMobile || uaDataMobile || (coarse && noFinePointer && noHover)
}
