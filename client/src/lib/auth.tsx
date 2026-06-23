import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import type { CurrentUser, Department } from './types'

export interface SignupInput {
  name: string
  email: string
  password: string
  companyName?: string
  department: Department
}

export interface SignupResult {
  pending: boolean
  message: string
}

interface AuthContextValue {
  user: CurrentUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (input: SignupInput) => Promise<SignupResult>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  updateProfile: (name: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: CurrentUser }>('/auth/me')
      setUser(user)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.post<{ user: CurrentUser }>('/auth/login', { email, password })
    setUser(user)
  }, [])

  // Team Lead self-registration creates a PENDING account — it does NOT log in.
  const signup = useCallback(async (input: SignupInput): Promise<SignupResult> => {
    const res = await api.post<{ pending?: boolean; message?: string }>('/auth/signup', { ...input })
    return { pending: res.pending ?? true, message: res.message ?? 'Your request has been sent for approval.' }
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout')
    setUser(null)
  }, [])

  const updateProfile = useCallback(async (name: string) => {
    const { user } = await api.patch<{ user: CurrentUser }>('/auth/profile', { name })
    setUser(user)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refresh, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}
