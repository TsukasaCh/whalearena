import { useEffect, useState } from 'react'
import { useAuth } from './store/useAuth'
import { useSim } from './store/useSimStore'
import { useSocket } from './net/useSocket'
import { useRoute, navigate, ROUTES } from './router'
import Landing from './components/Landing'
import AuthGate from './components/AuthGate'
import TopBar, { TickerBar, TimeframeTabs } from './components/TopBar'
import Chart from './components/Chart'
import RetailPanel from './components/RetailPanel'
import MarketMakerPanel from './components/MarketMakerPanel'
import HomeDashboard from './components/HomeDashboard'
import Toast from './components/Toast'

export default function App() {
  const route = useRoute()
  const session = useAuth((s) => s.session)
  const role = session?.user?.role

  // Landing (/) is public; the trading app connects the socket only when we're
  // actually on a play/console route with a matching session.
  const isTrader = route === ROUTES.trader && role === 'trader'
  const isHost = route === ROUTES.whale && role === 'host'
  const inApp = isTrader || isHost
  useSocket(inApp ? session : null)

  const known = route === ROUTES.landing || route === ROUTES.trader || route === ROUTES.whale

  useEffect(() => {
    // Unknown paths → beranda; a logged-in user on the wrong login → the right one.
    if (!known) navigate(ROUTES.landing)
    else if (route === ROUTES.trader && role === 'host') navigate(ROUTES.whale)
    else if (route === ROUTES.whale && role === 'trader') navigate(ROUTES.trader)
  }, [route, role, known])

  if (!known) return null
  if (route === ROUTES.landing) return <Landing session={session} />
  if (route === ROUTES.whale) return isHost ? <TradingApp isMM /> : <AuthGate role="host" />
  return isTrader ? <TradingApp session={session} /> : <AuthGate role="trader" />
}

function TradingApp({ isMM = false }) {
  const session = useAuth((s) => s.session)
  const [view, setView] = useState('home') // trader view: 'home' | 'spot' | 'perp'
  const showHome = !isMM && view === 'home'
  const mode = view === 'spot' ? 'spot' : 'perp' // which trading surface the panel shows
  const setMode = useSim((s) => s.setMode)
  const connected = useSim((s) => s.connected)

  // subscribe the socket to the matching venue whenever the trader switches tab
  // (or reconnects) — Spot and Futures are different order books on the server
  useEffect(() => {
    if (!isMM && (view === 'spot' || view === 'perp') && connected) setMode(mode)
  }, [view, mode, isMM, connected, setMode])

  return (
    <div className="flex h-full flex-col bg-bg text-txt">
      <TopBar user={session.user} isMM={isMM} view={view} onNav={setView} />

      {showHome ? (
        <HomeDashboard onEnter={(m = 'perp') => setView(m)} />
      ) : (
        <>
          <TickerBar isMM={isMM} mode={mode} />
          <main className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1 lg:flex-row lg:overflow-hidden">
            <section className="flex min-h-[56vh] shrink-0 flex-col overflow-hidden rounded-lg bg-panel lg:min-h-0 lg:flex-1 lg:shrink">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-1.5">
                <TimeframeTabs />
                <span className="truncate text-[11px] text-sub">
                  {mode === 'spot' ? 'Spot' : 'Perpetual'} · Simulated market
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <Chart />
              </div>
              <ConceptStrip isMM={isMM} mode={mode} />
            </section>
            <aside
              className={`flex w-full shrink-0 flex-col lg:min-h-0 ${
                isMM
                  ? 'overflow-hidden rounded-lg bg-panel lg:w-[380px] lg:ring-1 lg:ring-gold/25'
                  : 'lg:w-[380px] xl:w-[640px]'
              }`}
            >
              {isMM ? <MarketMakerPanel /> : <RetailPanel mode={mode} />}
            </aside>
          </main>
        </>
      )}

      <Toast />
    </div>
  )
}

function ConceptStrip({ isMM, mode = 'perp' }) {
  return (
    <div className="hidden shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-sub lg:flex">
      {isMM ? (
        <>
          <span className="font-semibold text-gold">God Mode:</span>
          <span>
            Paint the candles to sweep every trader's{' '}
            <span className="text-down">stop-loss &amp; liquidation</span>, then harvest their margin.
          </span>
        </>
      ) : mode === 'spot' ? (
        <>
          <span className="font-semibold text-txt">Spot:</span>
          <span>
            buy the coin outright and hold it — <span className="text-up">no leverage, no liquidation</span>.
            Your PnL is just price × the coins you own.
          </span>
        </>
      ) : (
        <>
          <span className="font-semibold text-txt">Perpetual:</span>
          <span>
            open a leveraged position — but the Whale is hunting your{' '}
            <span className="text-down">liquidation price</span>.
          </span>
        </>
      )}
      <span className="ml-auto shrink-0 text-sub/60">Educational game — not financial advice.</span>
    </div>
  )
}
