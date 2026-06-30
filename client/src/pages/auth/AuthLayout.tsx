import type { ReactNode } from 'react'
import { Activity, Star } from 'lucide-react'

interface Testimonial {
  quote: string
  name: string
  role: string
}

export interface AuthLayoutProps {
  children: ReactNode
  headline: string
  testimonial?: Testimonial
}

/** Split auth layout: form on the left, gradient brand panel on the right. */
export function AuthLayout({ children, headline, testimonial }: AuthLayoutProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center bg-card p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>

      <div className="relative hidden flex-col overflow-hidden bg-gradient-to-br from-primary to-accent p-10 text-white lg:flex">
        <div className="flex items-center gap-2 text-headline-md font-semibold">
          <Activity size={22} /> PulseTrack
        </div>

        <h2 className="mt-14 max-w-md text-[2rem] font-bold leading-tight tracking-tight">{headline}</h2>

        {/* Lightweight dashboard preview placeholder (replaceable with Pexels/screenshot). */}
        <div className="mt-10 rounded-card bg-black/20 p-4 shadow-overlay ring-1 ring-white/10">
          <div className="mb-3 flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
          </div>
          <div className="flex h-32 items-end gap-2">
            {[40, 65, 50, 80, 60, 95, 72].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-white/40" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        {testimonial && (
          <div className="mt-auto rounded-card bg-white/10 p-5 backdrop-blur-sm ring-1 ring-white/15">
            <div className="mb-2 flex gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={14} className="fill-white text-white" />
              ))}
            </div>
            <p className="text-body-md italic">“{testimonial.quote}”</p>
            <p className="mt-3 text-body-sm font-semibold">
              {testimonial.name} · <span className="font-normal text-white/80">{testimonial.role}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
