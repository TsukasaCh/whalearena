import { useEffect, useRef, useState } from 'react'
import { useSim, TIMEFRAMES } from '../store/useSimStore'
import { useAuth } from '../store/useAuth'
import { navigate, ROUTES } from '../router'
import { usd, fmtPrice, pct, compact, marketCap, usdCompact } from '../lib/format'
import { CoinIcon } from './ui'

const NAV = [
  { id: 'home', label: 'Assets' },
  { id: 'spot', label: 'Spot' },
  { id: 'perp', label: 'Futures' },
]

// Global navigation: brand, section links, account summary (OKX-style black bar).
export default function TopBar({ user, isMM, view, onNav }) {
  const equity = useSim((s) => s.equity)
  const balance = useSim((s) => s.balance)
  const crowd = useSim((s) => s.crowd)
  const connected = useSim((s) => s.connected)
  const mm = useSim((s) => s.mm)
  const doLogout = useAuth((s) => s.logout)
  const logout = () => { doLogout(); navigate(ROUTES.landing) }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-bg px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-4 sm:gap-7">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xl leading-none">🐋</span>
          <span className="hidden text-[15px] font-extrabold tracking-tight text-txt sm:inline">
            WHALE<span className="text-gold">ARENA</span>
          </span>
          {isMM && (
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">God Mode</span>
          )}
        </div>

        {!isMM && (
          <nav className="flex items-center gap-0.5 sm:gap-1">
            {NAV.map((v) => (
              <button
                key={v.id}
                onClick={() => onNav(v.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === v.id ? 'bg-panel2 text-txt' : 'text-sub hover:text-txt'
                }`}
              >
                {v.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="hidden text-right leading-tight md:block">
          <div
            className="text-[11px] text-sub"
            title={isMM ? undefined : 'Total nilai semua aset: saldo bebas + posisi + order limit + spot + staking'}
          >
            {isMM ? 'Harvested' : `Equity · Avail ${usd(balance)}`}
          </div>
          <div className={`font-mono text-sm font-semibold ${isMM ? 'text-gold' : 'text-txt'}`}>
            {isMM ? usd(crowd.harvested, 0) : usd(equity)}
          </div>
        </div>

        {isMM && (
          <button onClick={() => mm('reset')} className="btn btn-ghost btn-sm" title="Reset this market for everyone">
            ↻ Reset
          </button>
        )}

        <span className="hidden h-5 w-px bg-border md:block" />

        <div className="flex items-center gap-2">
          <span
            className="relative flex h-8 w-8 items-center justify-center rounded-full bg-panel2 text-xs font-bold uppercase text-txt"
            title={`${user.name} · ${connected ? 'Connected' : 'Reconnecting…'}`}
          >
            {(user.name || '?').slice(0, 1)}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg ${
                connected ? 'bg-up' : 'bg-down'
              }`}
            />
          </span>
          <span className="hidden max-w-[120px] truncate text-sm font-medium text-txt lg:inline">{user.name}</span>
          <button onClick={logout} className="btn btn-outline btn-sm hover:!border-down hover:text-down">
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}

// Market header for the trading screen: pair picker, last price and key stats.
export function TickerBar({ isMM, mode = 'perp' }) {
  const price = useSim((s) => s.price)
  const symbol = useSim((s) => s.symbol)
  const dp = useSim((s) => s.dp)
  const symbols = useSim((s) => s.symbols)
  const crowd = useSim((s) => s.crowd)
  const setSymbol = useSim((s) => s.setSymbol)

  const meta = symbols.find((s) => s.symbol === symbol)
  const chg = meta?.change ?? 0
  const isSpot = mode === 'spot'

  const prev = useRef(price)
  const [dir, setDir] = useState(0)
  useEffect(() => {
    setDir(price > prev.current ? 1 : price < prev.current ? -1 : 0)
    prev.current = price
  }, [price])

  const basis = meta?.spot && meta?.price ? ((meta.price - meta.spot) / meta.spot) * 100 : null
  const oi = (crowd.longOI || 0) + (crowd.shortOI || 0)
  // spot fundamentals: market cap = spot price × circulating supply, ranked among listed tokens
  const mcap = marketCap(meta)
  const rank = mcap ? symbols.filter((s) => (marketCap(s) || 0) > mcap).length + 1 : null
  const longPct = oi > 0 ? (crowd.longOI / oi) * 100 : null

  return (
    <div className="mx-1 flex shrink-0 items-center gap-5 overflow-x-auto rounded-lg bg-panel px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <MarketPicker symbol={symbol} symbols={symbols} onPick={setSymbol} badge={isSpot ? 'Spot' : 'Perp'} showCap={isSpot} />

      <div className="shrink-0 leading-tight">
        <div
          className={`font-mono text-xl font-semibold transition-colors ${
            dir > 0 ? 'text-up' : dir < 0 ? 'text-down' : chg >= 0 ? 'text-up' : 'text-down'
          }`}
        >
          {price ? fmtPrice(price, dp) : '—'}
        </div>
        <div className={`font-mono text-xs ${chg >= 0 ? 'text-up' : 'text-down'}`}>{pct(chg)}</div>
      </div>

      <div className="flex shrink-0 items-center gap-6">
        {meta?.spot != null && (
          <TickStat label={isSpot ? 'Futures price' : 'Spot index'} value={fmtPrice(isSpot ? meta.price : meta.spot, dp)} />
        )}
        {basis != null && (
          <TickStat
            label="Basis"
            title="Futures premium vs spot (basis)"
            value={`${basis >= 0 ? '+' : ''}${basis.toFixed(2)}%`}
            valueClass={Math.abs(basis) < 0.05 ? 'text-txt' : basis >= 0 ? 'text-up' : 'text-down'}
          />
        )}
        {isSpot && mcap && (
          <TickStat
            label="Market cap"
            title="Harga spot × suplai beredar"
            value={<>{usdCompact(mcap)}<span className="text-sub"> · #{rank}</span></>}
          />
        )}
        {isSpot && meta?.supply > 0 && <TickStat label="Circulating supply" value={`${compact(meta.supply)} ${meta.base || symbol}`} />}
        {!isSpot && <FundingStat />}
        {!isSpot && oi > 0 && <TickStat label="Open interest" value={compact(oi)} />}
        {!isSpot && longPct != null && (
          <TickStat
            label="Long / Short"
            value={
              <>
                <span className="text-up">{Math.round(longPct)}%</span>
                <span className="text-sub"> / </span>
                <span className="text-down">{Math.round(100 - longPct)}%</span>
              </>
            }
          />
        )}
        {crowd.traders > 0 && <TickStat label="Traders" value={compact(crowd.traders)} />}
        {isMM && <TickStat label="Liquidated" value={compact(crowd.liquidatedTotal || 0)} valueClass="text-gold" />}
      </div>
    </div>
  )
}

function TickStat({ label, value, valueClass = 'text-txt', title }) {
  return (
    <div className="shrink-0 leading-tight" title={title}>
      <div className="whitespace-nowrap text-[11px] text-sub">{label}</div>
      <div className={`whitespace-nowrap font-mono text-xs font-medium ${valueClass}`}>{value}</div>
    </div>
  )
}

// next hourly funding: predicted rate (longs pay when positive) + countdown
function FundingStat() {
  const funding = useSim((s) => s.crowd.funding)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!funding) return null
  const left = Math.max(0, funding.next - Math.floor(now / 1000))
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  const pos = funding.rate >= 0
  return (
    <TickStat
      label="Funding / Countdown"
      title={pos ? 'Positif: long bayar ke short' : 'Negatif: short bayar ke long'}
      value={
        <>
          <span className={pos ? 'text-up' : 'text-down'}>{pos ? '+' : ''}{(funding.rate * 100).toFixed(4)}%</span>
          <span className="text-sub"> / </span>
          {mm}:{ss}
        </>
      }
    />
  )
}

// Chart toolbar: candle interval switcher.
export function TimeframeTabs() {
  const timeframe = useSim((s) => s.timeframe)
  const setTimeframe = useSim((s) => s.setTimeframe)
  return (
    <div className="flex items-center gap-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          onClick={() => setTimeframe(tf)}
          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            timeframe === tf ? 'bg-panel2 text-txt' : 'text-sub hover:text-txt'
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  )
}

// Pair selector (symbol + a searchable popover list of all pairs).
function MarketPicker({ symbol, symbols, onPick, badge, showCap = false }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const toggle = () => {
    // fixed-position popover: the ticker bar scrolls horizontally and would clip it
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ left: Math.max(8, r.left), top: r.bottom + 10 })
    setQ('')
    setOpen((o) => !o)
  }
  const needle = q.trim().toLowerCase()
  const list = needle
    ? symbols.filter((s) => s.symbol.toLowerCase().includes(needle) || (s.name || '').toLowerCase().includes(needle))
    : symbols
  return (
    <div className="shrink-0" ref={ref}>
      <button onClick={toggle} className="flex items-center gap-2.5 rounded-lg py-1 pr-1 text-left hover:opacity-80">
        <CoinIcon symbol={symbol} size={28} />
        <span className="text-lg font-bold tracking-tight text-txt">{symbol}USDT</span>
        <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] font-medium text-sub">{badge}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" className={`text-sub transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="fixed z-50 flex max-h-[min(28rem,70vh)] w-80 max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl border border-white/5 bg-panel2 shadow-2xl shadow-black/60"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="p-3 pb-2">
            <div className="field !bg-panel3/60">
              <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-sub">
                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="!font-sans" />
            </div>
          </div>
          <div className="flex justify-between px-4 pb-1 text-[11px] text-sub">
            <span>{showCap ? 'Name / Market cap' : 'Name'}</span>
            <span>Last price / Change</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {list.map((s) => (
              <button
                key={s.symbol}
                onClick={() => { onPick(s.symbol); setOpen(false) }}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-panel3/60 ${
                  s.symbol === symbol ? 'bg-panel3/40' : ''
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <CoinIcon symbol={s.symbol} size={24} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="text-[13px] font-semibold text-txt">{s.symbol}<span className="font-normal text-sub">USDT</span></span>
                    <span className="truncate text-[11px] text-sub">{showCap && marketCap(s) ? `MCap ${usdCompact(marketCap(s))}` : s.name}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end leading-tight">
                  <span className="font-mono text-[13px] text-txt">{fmtPrice(showCap ? s.spot ?? s.price : s.price, s.dp)}</span>
                  <span className={`font-mono text-[11px] ${s.change >= 0 ? 'text-up' : 'text-down'}`}>{pct(s.change)}</span>
                </span>
              </button>
            ))}
            {list.length === 0 && <div className="py-6 text-center text-xs text-sub">No markets found</div>}
          </div>
        </div>
      )}
    </div>
  )
}
