import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'

export type Role = 'passenger' | 'operator' | 'engineer' | 'admin'
export interface User {
  id: number; email: string; full_name: string; role: Role; team: string | null
  preferred_language: 'en' | 'ta'; is_active: boolean; is_demo: boolean
}

interface AuthCtx {
  user: User | null
  permissions: string[]
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (data: { full_name: string; email: string; password: string; preferred_language: string }) => Promise<void>
  logout: () => void
  can: (perm: string) => boolean
  isStaff: boolean
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [permissions, setPerms] = useState<string[]>([])
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    if (!getToken()) { setReady(true); return }
    try {
      const r = await api<{ user: User; permissions: string[] }>('/api/auth/me')
      setUser(r.user); setPerms(r.permissions)
    } catch { setToken(null); setUser(null) }
    finally { setReady(true) }
  }, [])

  useEffect(() => {
    refresh()
    const onLogout = () => { setUser(null); setPerms([]) }
    window.addEventListener('megaasset:logout', onLogout)
    return () => window.removeEventListener('megaasset:logout', onLogout)
  }, [refresh])

  const accept = (r: { access_token: string; user: User; permissions: string[] }) => {
    setToken(r.access_token); setUser(r.user); setPerms(r.permissions)
  }
  const login = async (email: string, password: string) => accept(await api('/api/auth/login', { method: 'POST', json: { email, password } }))
  const signup = async (data: { full_name: string; email: string; password: string; preferred_language: string }) =>
    accept(await api('/api/auth/signup', { method: 'POST', json: data }))
  const logout = () => { setToken(null); setUser(null); setPerms([]) }
  const can = (p: string) => permissions.includes('*') || permissions.includes(p)
  const isStaff = !!user && user.role !== 'passenger'

  return <Ctx.Provider value={{ user, permissions, ready, login, signup, logout, can, isStaff, refresh }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside provider')
  return c
}
