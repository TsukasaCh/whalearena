import { useEffect, useState } from 'react'
import { useAuth } from './store/useAuth'
import { useSocket } from './net/useSocket'
import { useRoute, navigate, ROUTES } from './router'
import Landing from './components/Landing'
import AuthGate from './components/AuthGate'
import TopBar from './components/TopBar'
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
  const [view, setView] = useState('home') // trader view: 'home' | 'trade'
  const showHome = !isMM && view === 'home'

  return (
    <div className="flex h-full flex-col bg-bg text-txt">
      <TopBar user={session.user} isMM={isMM} view={view} onNav={setView} />

      {showHome ? (
        <HomeDashboard onEnter={() => setView('trade')} />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section className="flex min-h-[46vh] flex-1 flex-col border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
            <div className="min-h-0 flex-1">
              <Chart />
            </div>
            <ConceptStrip isMM={isMM} />
          </section>
          <aside
            className={`flex min-h-0 w-full shrink-0 flex-col lg:w-[380px] ${
              isMM ? 'lg:border-l-2 lg:border-gold/40' : ''
            }`}
          >
            {isMM ? <MarketMakerPanel /> : <RetailPanel />}
          </aside>
        </main>
      )}

      <Toast />
    </div>
  )
}

function ConceptStrip({ isMM }) {
  return (
    <div className="hidden items-center gap-3 border-t border-border bg-panel px-4 py-1.5 text-[11px] text-sub lg:flex">
      {isMM ? (
        <>
          <span className="font-semibold text-gold">God Mode:</span>
          <span>
            Paint the candles to sweep every trader's{' '}
            <span className="text-down">stop-loss &amp; liquidation</span>, then harvest their margin.
          </span>
        </>
      ) : (
        <>
          <span className="font-semibold text-accent">You are a trader:</span>
          <span>
            open a leveraged position — but the Whale is hunting your{' '}
            <span className="text-down">liquidation price</span>.
          </span>
        </>
      )}
      <span className="ml-auto italic text-sub/60">Educational game — not financial advice.</span>
    </div>
  )
}
