import { create } from 'zustand'
import { api, setOnUnauthorized } from '@/lib/api'

interface User {
  id: string
  name: string
  email: string
}

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  error: string | null

  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
  clearError: () => void
  init: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  loading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({ loading: true, error: null })
    try {
      const res = await api.login({ email, password })
      localStorage.setItem('token', res.token)
      set({ user: res.user, token: res.token, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      set({ error: message, loading: false })
      throw err
    }
  },

  register: async (name: string, email: string, password: string) => {
    set({ loading: true, error: null })
    try {
      const res = await api.register({ name, email, password })
      localStorage.setItem('token', res.token)
      set({ user: res.user, token: res.token, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      set({ error: message, loading: false })
      throw err
    }
  },

  logout: () => {
    localStorage.removeItem('token')
    set({ user: null, token: null, error: null })
  },

  clearError: () => {
    set({ error: null })
  },

  init: async () => {
    // Wire the global 401 handler to auto-logout
    setOnUnauthorized(() => {
      localStorage.removeItem('token')
      useAuthStore.setState({ user: null, token: null, error: null })
    })

    const token = localStorage.getItem('token')
    if (!token) {
      set({ loading: false })
      return
    }
    set({ token, loading: true })
    try {
      const user = await api.me()
      set({ user, loading: false })
    } catch {
      // Token invalid or expired — clear and show login
      localStorage.removeItem('token')
      set({ user: null, token: null, loading: false })
    }
  },
}))
