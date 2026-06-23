export type ClassValue = string | number | false | null | undefined

/** Tiny classNames joiner — filters falsy values and joins with spaces. */
export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ')
}
