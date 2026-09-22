import { useEffect, useRef, useState } from 'react'
import { useSim, TIMEFRAMES } from '../store/useSimStore'
import { useAuth } from '../store/useAuth'
import { navigate, ROUTES } from '../router'
import { usd, fmt, fmtPrice, pct } from '../lib/format'

export default function TopBar({ user, isMM, view, onNav }) {
  const price = useSim((s) => s.price)
  const symbol = useSim((s) => s.symbol)
  const dp = useSim((s) => s.dp)
  const symbols = useSim((s) => s.symbols)
  const equity = useSim((s) => s.equity)
  const crowd = useSim((s) => s.crowd)
  const connected = useSim((s) => s.connected)
  const timeframe = useSim((s) => s.timeframe)
  const setTimeframe = useSim((s) => s.setTimeframe)
  const setSymbol = useSim((s) => s.setSymbol)
  const mm = useSim((s) => s.mm)
  const doLogout = useAuth((s) => s.logout)
  const logout = () => { doLogout(); navigate(ROUTES.landing) }

  const meta = symbols.find((s) => s.symbol === symbol)
  const chg = meta?.change ?? 0

  const prev = useRef(price)
  const [dir, setDir] = useState(0)
  useEffect(() => {
    setDir(price > prev.current ? 1 : price < prev.current ? -1 : 0)
    prev.current = price
  }, [price])

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel px-4 py-2">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🐋</span>
          <div className="leading-tight">
            <div className="text-sm font-extrabold tracking-tight text-txt">
              WHALE <span className="text-gold">ARENA</span>
            </div>
            <div className="text-[10px] uppercase tracking-widest text-sub">
              {isMM ? 'God Mode' : 'Trader'}
            </div>
          </div>
        </div>

        {!isMM && (
          <div className="flex overflow-hidden rounded-md border border-border">
            {[
              { id: 'home', label: '🏠 Home' },
              { id: 'trade', label: '📈 Trade' },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => onNav(v.id)}
                className={`px-3 py-1 text-xs font-semibold transition-colors ${
                  view === v.id ? 'bg-accent/20 text-accent' : 'text-sub hover:text-txt'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}

        <div className="hidden items-center gap-3 sm:flex">
          <MarketPicker symbol={symbol} symbols={symbols} onPick={setSymbol} />
          <span
            className={`font-mono text-xl font-bold tabular-nums transition-colors ${
              dir > 0 ? 'text-up' : dir < 0 ? 'text-down' : 'text-txt'
            }`}
          >
            {price ? fmtPrice(price, dp) : '—'}
          </span>
          <span className={`font-mono text-xs font-semibold ${chg >= 0 ? 'text-up' : 'text-down'}`}>
            {pct(chg)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-right md:block">
          <div className="text-[10px] uppercase tracking-wide text-sub">
            {isMM ? 'Harvested' : 'Equity'}
          </div>
          <div className={`font-mono text-sm font-semibold ${isMM ? 'text-gold' : 'text-txt'}`}>
            {isMM ? usd(crowd.harvested, 0) : usd(equity)}
          </div>
        </div>

        <div className="flex overflow-hidden rounded-md border border-border">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 text-xs font-semibold ${
                timeframe === tf ? 'bg-panel2 text-txt' : 'text-sub hover:text-txt'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {isMM && (
          <button
            onClick={() => mm('reset')}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-sub hover:text-txt"
            title="Reset this market for everyone"
          >
            ↻ Reset
          </button>
        )}

        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-up' : 'bg-down'}`}
            title={connected ? 'Connected' : 'Reconnecting…'}
          />
          <span className="hidden text-xs font-semibold text-txt sm:inline">{user.name}</span>
          <button
            onClick={logout}
            className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-sub hover:text-down"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}

// Compact market dropdown (symbol + a searchable popover list of all pairs).
function MarketPicker({ symbol, symbols, onPick }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-panel2 px-2 py-1 text-xs font-bold text-txt hover:border-accent/50"
      >
        <span>{symbol}/USDT</span>
        <span className="text-sub">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-96 w-64 overflow-y-auto rounded-lg border border-border bg-panel shadow-2xl">
          {symbols.map((s) => (
            <button
              key={s.symbol}
              onClick={() => { onPick(s.symbol); setOpen(false) }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-panel2 ${
                s.symbol === symbol ? 'bg-accent/10' : ''
              }`}
            >
              <span className="flex flex-col">
                <span className="font-bold text-txt">{s.symbol}<span className="text-sub">/USDT</span></span>
                <span className="text-[10px] text-sub">{s.name}</span>
              </span>
              <span className="flex flex-col items-end">
                <span className="font-mono text-txt">{fmtPrice(s.price, s.dp)}</span>
                <span className={`font-mono text-[10px] ${s.change >= 0 ? 'text-up' : 'text-down'}`}>{pct(s.change)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
