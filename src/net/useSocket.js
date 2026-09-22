import { useEffect } from 'react'
import { useSim } from '../store/useSimStore'
import { useAuth } from '../store/useAuth'

function dispatch(m) {
  const s = useSim.getState()
  switch (m.type) {
    case 'authFail':
      useAuth.getState().logout()
      break
    case 'welcome':
      s.applyWelcome(m)
      break
    case 'snap':
      s.applySnap(m)
      break
    case 'm':
      s.applyMarket(m)
      break
    case 'ticks':
      s.applyTicks(m.ticks)
      break
    case 'tickers':
      s.applyTickers(m.tickers)
      break
    case 'c':
      s.applyCrowd(m)
      break
    case 'map':
      s.applyMap(m)
      break
    case 'lb':
      s.applyLeaderboard(m.lb)
      break
    case 'me':
      s.applyMe(m)
      break
    case 'orderError':
      s.setOrderError(m.error)
      break
    default:
      break
  }
}

// Opens the WebSocket to the server and pipes messages into the store.
// Same-origin URL: dev goes through the Vite proxy, prod hits the node server.
export function useSocket(session) {
  useEffect(() => {
    if (!session) return undefined
    let ws
    let closed = false
    let retry
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(session.token)}`

    const connect = () => {
      ws = new WebSocket(url)
      ws.onopen = () => {
        useSim.getState().setConnected(true)
        useSim.getState().setSender((o) => {
          if (ws.readyState === 1) ws.send(JSON.stringify(o))
        })
      }
      ws.onmessage = (e) => {
        try {
          dispatch(JSON.parse(e.data))
        } catch {
          /* ignore malformed */
        }
      }
      ws.onclose = () => {
        useSim.getState().setConnected(false)
        useSim.getState().setSender(null)
        if (!closed) retry = setTimeout(connect, 900)
      }
      ws.onerror = () => {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
    }
    connect()

    return () => {
      closed = true
      clearTimeout(retry)
      try {
        if (ws) ws.close()
      } catch {
        /* ignore */
      }
    }
  }, [session])
}
