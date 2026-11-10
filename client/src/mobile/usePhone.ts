import { useEffect, useState } from 'react'

const QUERY = '(max-width: 767px)'

/** True on a phone-width screen (below 768px, where the bottom tab bar shows). Follows rotation and resizing. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}
