import { create } from 'zustand'

const KEY = 'whale.auth'
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}

export const useAuth = create((set) => ({
  session: load(), // { token, user: { name, role } } | null
  setSession: (s) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      /* ignore */
    }
    set({ session: s })
  },
  logout: () => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
    set({ session: null })
  },
}))
