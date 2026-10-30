import { useId, type SVGProps } from 'react'

/**
 * The website's own icons: drawn for Metriq on a 24px grid, two tones (a soft fill under a
 * 1.6px line), so they read as one set and not as stock outline icons.
 */

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 22, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}
const Tint = (props: SVGProps<SVGPathElement>) => <path fill="currentColor" stroke="none" opacity={0.16} {...props} />

export const IconAttendance = (p: P) => (
  <Svg {...p}>
    <Tint d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
    <path d="M20.6 9.4A9 9 0 1 0 14.6 20.6" />
    <path d="M12 7v5l3 2" />
    <path d="m16.5 18.5 1.8 1.8 3.4-3.6" />
  </Svg>
)

export const IconBoard = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <Tint d="M10 9h4v7h-4z" />
    <path d="M9 4v16M15 4v16" />
    <path d="M5.5 8h1.5M11 8h2M17 8h1.5M11 11h2M17 11h1.5" />
  </Svg>
)

export const IconChat = (p: P) => (
  <Svg {...p}>
    <Tint d="M9 6h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-1v3l-3.5-3H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
    <path d="M9 6h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-1v3l-3.5-3H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
    <path d="M7 13H5.5L3 15.5V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    <path d="M11 10.5h6M11 13h3.5" />
  </Svg>
)

export const IconReport = (p: P) => (
  <Svg {...p}>
    <Tint d="M6 5h12v16H6z" />
    <path d="M15 4h2a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2" />
    <rect x="9" y="2.5" width="6" height="3" rx="1" />
    <path d="M9 17v-3M12 17v-6M15 17v-4.5" />
  </Svg>
)

export const IconDialer = (p: P) => (
  <Svg {...p}>
    <Tint d="M4 5.5c0 7.7 6.8 14.5 14.5 14.5l1.5-3.6-3.7-1.8-1.9 2C11.7 15.4 8.6 12.3 7.4 9.6l2-1.9-1.8-3.7Z" />
    <path d="M4 5.5c0 7.7 6.8 14.5 14.5 14.5l1.5-3.6-3.7-1.8-1.9 2C11.7 15.4 8.6 12.3 7.4 9.6l2-1.9-1.8-3.7L4 5.5Z" />
    <path d="M14.5 3.5a6 6 0 0 1 6 6M14.5 7a2.5 2.5 0 0 1 2.5 2.5" />
  </Svg>
)

export const IconDepartments = (p: P) => (
  <Svg {...p}>
    <Tint d="M4 4h7v7H4z" />
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <path d="M16.5 13.5v6M13.5 16.5h6" />
  </Svg>
)

export const IconRoles = (p: P) => (
  <Svg {...p}>
    <Tint d="M9 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
    <circle cx="9" cy="7" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 10.6-5" />
    <path d="M18 13.5l3.5 1.4v2.5c0 2-1.5 3.4-3.5 4.1-2-.7-3.5-2.1-3.5-4.1v-2.5Z" />
    <path d="m16.7 17.6 1 1 1.8-2" />
  </Svg>
)

export const IconNotes = (p: P) => (
  <Svg {...p}>
    <Tint d="M5 3h10l4 4v14H5z" />
    <path d="M15 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7l-4-4Z" />
    <path d="M15 3v4h4" />
    <path d="M8.5 15v-2M11 17v-6M13.5 16v-4M16 15v-2" />
  </Svg>
)

export const IconConnect = (p: P) => (
  <Svg {...p}>
    <Tint d="M12 2.5l2.2 5.3L19.5 10l-5.3 2.2L12 17.5l-2.2-5.3L4.5 10l5.3-2.2Z" />
    <path d="M12 2.5l2.2 5.3L19.5 10l-5.3 2.2L12 17.5l-2.2-5.3L4.5 10l5.3-2.2Z" />
    <path d="M19 16.5v4M17 18.5h4M5 17.5v3M3.5 19h3" />
  </Svg>
)

export const IconGlobeClock = (p: P) => (
  <Svg {...p}>
    <Tint d="M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z" />
    <path d="M18.8 9.5A8 8 0 1 0 9.6 18.9" />
    <path d="M3 11h16M11 3c2.2 2.3 3.2 5 3.2 8M11 3C8.8 5.3 7.8 8 7.8 11s1 5.7 3.2 8" />
    <circle cx="17.5" cy="17.5" r="4" />
    <path d="M17.5 15.8v1.8l1.2.8" />
  </Svg>
)

export const IconPhone = (p: P) => (
  <Svg {...p}>
    <Tint d="M7 2.5h10v19H7z" />
    <rect x="6" y="2.5" width="12" height="19" rx="3" />
    <path d="M10.5 5.5h3" />
    <path d="m9.5 13 1.8 1.8 3.4-3.6" />
  </Svg>
)

export const IconWalls = (p: P) => (
  <Svg {...p}>
    <Tint d="M12 2.8 20 6v5.5c0 4.6-3.3 8.4-8 9.7-4.7-1.3-8-5.1-8-9.7V6Z" />
    <path d="M12 2.8 20 6v5.5c0 4.6-3.3 8.4-8 9.7-4.7-1.3-8-5.1-8-9.7V6Z" />
    <path d="M12 7v10M8 10h8M8 14h8" opacity={0.7} />
  </Svg>
)

export const IconLock = (p: P) => (
  <Svg {...p}>
    <Tint d="M5 10h14v11H5z" />
    <rect x="4.5" y="10" width="15" height="11" rx="2.5" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <path d="M9 15.5h.01M12 15.5h.01M15 15.5h.01" strokeWidth={2.4} />
  </Svg>
)

export const IconBackup = (p: P) => (
  <Svg {...p}>
    <Tint d="M4 6c0-1.7 3.1-3 7-3s7 1.3 7 3v5c0 1.7-3.1 3-7 3s-7-1.3-7-3Z" />
    <ellipse cx="11" cy="6" rx="7" ry="3" />
    <path d="M4 6v12c0 1.7 3.1 3 7 3M18 6v4" />
    <path d="M4 12c0 1.7 3.1 3 7 3" />
    <path d="M21 16.5a3.5 3.5 0 1 1-1-2.5M21 13v2.2h-2.2" />
  </Svg>
)

export const IconKey = (p: P) => (
  <Svg {...p}>
    <Tint d="M8 9.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
    <circle cx="8" cy="14" r="4.5" />
    <path d="m11.2 10.8 8.3-8.3M16 6l2.5 2.5M18.5 3.5 21 6" />
    <path d="M8 14h.01" strokeWidth={2.6} />
  </Svg>
)

export const IconSupport = (p: P) => (
  <Svg {...p}>
    <Tint d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6Z" />
    <path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6Z" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 2.5v1.5M5.5 4.5l1 1.2M18.5 4.5l-1 1.2" />
  </Svg>
)

export const IconExport = (p: P) => (
  <Svg {...p}>
    <Tint d="M4 13h16v7H4z" />
    <path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
    <path d="M12 3v11M7.5 7.5 12 3l4.5 4.5" />
  </Svg>
)

export const IconSpark = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </Svg>
)

export const IconCheck = (p: P) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
)

export const IconArrow = (p: P) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
)

/* The old tools Metriq replaces, small and grey. */
export const IconWhatsapp = (p: P) => (
  <Svg {...p}>
    <path d="M4 20l1.3-4A8 8 0 1 1 8.4 19Z" />
    <path d="M9 9.5c.4 2.3 2.2 4.1 4.5 4.6l1-1.1 1.6.7-.4 1.5c-3.2.1-6.6-3.1-6.6-6.4l1.5-.4.7 1.6Z" fill="currentColor" stroke="none" opacity={0.6} />
  </Svg>
)
export const IconFingerprint = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 18.5C5.6 16.7 5 14.6 5 12a7 7 0 0 1 12.6-4.2" />
    <path d="M19 12c0 3-.5 5.3-1.4 7" />
    <path d="M9 19.5c-.7-1.9-1-4.4-1-7.5a4 4 0 0 1 8 0c0 2.8-.2 5.3-.9 7.4" />
    <path d="M12 12c0 3.2.3 5.8 1 8" />
  </Svg>
)
export const IconSheet = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M3.5 9h17M3.5 14h17M9 4v16M15 4v16" />
  </Svg>
)
export const IconForm = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="3" width="15" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h4" />
    <circle cx="16" cy="16" r="1" fill="currentColor" />
  </Svg>
)
export const IconVideo = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2.5" />
    <path d="m16 10.5 5-3v9l-5-3" />
  </Svg>
)
export const IconSticky = (p: P) => (
  <Svg {...p}>
    <path d="M4 4h16v10l-6 6H4Z" />
    <path d="M14 20v-6h6" />
    <path d="M8 9h7M8 12.5h4" />
  </Svg>
)

/** Metriq's own mark (the same drawing as the logo). */
export function MetriqMark({ size = 40, className }: { size?: number; className?: string }) {
  // Its own gradient id: the same mark can be on the page twice, one copy hidden.
  const id = `mk-mark-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#${id})`} />
      <path d="M12 35 V15 L24 27 L36 15 V35" stroke="#FFFFFF" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="36" cy="35" r="2.6" fill="#22D3EE" />
    </svg>
  )
}
