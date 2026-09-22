import { useSyncExternalStore } from 'react'

// Tiny dependency-free router: tracks location.pathname and lets any component
// navigate via the History API. Works with the server's SPA fallback (every
// path serves index.html), so deep links like /whale-god load the app directly.
const EVT = 'whale:navigate'

function subscribe(cb) {
  window.addEventListener('popstate', cb)
  window.addEventListener(EVT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(EVT, cb)
  }
}

export function navigate(path) {
  if (path === window.location.pathname) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new Event(EVT))
}

export function useRoute() {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

// Where the two logins live. Traders only ever see /play; the whale endpoint
// is intentionally not linked anywhere in the public UI.
export const ROUTES = {
  landing: '/',
  trader: '/play',
  whale: '/whale-god',
}
