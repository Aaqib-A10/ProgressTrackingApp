/**
 * The colour themes the app offers (client/src/theme/themes/index.ts: keep the two lists the same). The server only
 * stores which one a person or a company picked; the colours live in the app.
 */
// One look, in light and dark (24 Nov 2026: the six extra colour themes were taken out).
export const THEME_IDS = ['metriq'] as const
export type ThemeId = (typeof THEME_IDS)[number]
export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v)
/** A brand colour as the company sets it: #rrggbb. */
export const BRAND_COLOR = /^#[0-9a-fA-F]{6}$/
