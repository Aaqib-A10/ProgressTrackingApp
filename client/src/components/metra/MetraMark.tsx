import { useId } from 'react'
import { cn } from '../../lib/cn'

/**
 * Metra's mark: a soft rounded square in the app's blues (indigo to azure) holding a flowing "M" drawn as a
 * pulse line (Metriq's metrics, turning into Metra's initial), a second softer wave behind it, and a small
 * four-point spark at the top right. Small sizes (≤ 20px) drop the highlight and the second wave and use
 * thicker strokes, so the mark stays crisp in the menu.
 */
export function MetraMark({ size = 28, className, title }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '')
  const small = size <= 20
  const stroke = small ? 3.1 : 2.5
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient id={`mg${id}`} x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4F46E5" />
          <stop offset="0.55" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#38BDF8" />
        </linearGradient>
        {!small && (
          <radialGradient id={`mh${id}`} cx="10" cy="7" r="14" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.32" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9.5" fill={`url(#mg${id})`} />
      {!small && <rect x="1" y="1" width="30" height="30" rx="9.5" fill={`url(#mh${id})`} />}
      {!small && <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="none" stroke="#FFFFFF" strokeOpacity="0.18" />}
      {/* the softer wave behind */}
      {!small && (
        <path d="M6.5 23.5 C8.6 23.5 9.4 13.5 11.9 13.5 C14.3 13.5 14.6 20.6 16 20.6 C17.4 20.6 17.7 13.5 20.1 13.5 C22.6 13.5 23.4 23.5 25.5 23.5"
          fill="none" stroke="#FFFFFF" strokeOpacity="0.38" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* the pulse that is an M */}
      <path
        d={small ? 'M6.5 22.5 C8.5 22.5 9 10.5 11.8 10.5 C14.4 10.5 14.4 18.5 16 18.5 C17.6 18.5 17.6 10.5 20.2 10.5 C23 10.5 23.5 22.5 25.5 22.5' : 'M6.5 21.5 C8.6 21.5 9.2 10.2 11.9 10.2 C14.5 10.2 14.5 18 16 18 C17.5 18 17.5 10.2 20.1 10.2 C22.8 10.2 23.4 21.5 25.5 21.5'}
        fill="none" stroke="#FFFFFF" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      />
      {/* the spark */}
      <path d={small ? 'M25.2 3.6 L26.1 6.2 L28.7 7.1 L26.1 8 L25.2 10.6 L24.3 8 L21.7 7.1 L24.3 6.2 Z' : 'M25 4.2 L25.75 6.45 L28 7.2 L25.75 7.95 L25 10.2 L24.25 7.95 L22 7.2 L24.25 6.45 Z'} fill="#FFFFFF" />
    </svg>
  )
}

/** The mark as a menu icon (same call shape as a lucide icon: size and className). */
export function MetraNavIcon({ size = 16, className }: { size?: number | string; className?: string; strokeWidth?: number | string }) {
  return <MetraMark size={Number(size) || 16} className={className} />
}
