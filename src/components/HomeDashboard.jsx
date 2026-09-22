import { useState } from 'react'
import { useSim } from '../store/useSimStore'
import { useAuth } from '../store/useAuth'
import { unrealizedPnl, roe } from '../lib/trading'
import { usd, fmt, fmtPrice, pct, signedUsd } from '../lib/format'
import ShareCard from './ShareCard'

const STARTING = 10000

export default function HomeDashboard({ onEnter }) {
  const name = useAuth((s) => s.session?.user?.name || 'Trader')
  const equity = useSim((s) => s.equity)
  const stats = useSim((s) => s.stats)
  const history = useSim((s) => s.history)
  const books = useSim((s) => s.books)
  const symbols = useSim((s) => s.symbols)
  const leaderboard = useSim((s) => s.leaderboard)
  const setSymbol = useSim((s) => s.setSymbol)
  const cancelLimitFor = useSim((s) => s._send)
  const [share, setShare] = useState(null)

  const totalPnl = equity - STARTING
  const winRate = stats.trades ? (stats.wins / stats.trades) * 100 : 0
  const metaOf = (sym) => symbols.find((s) => s.symbol === sym) || {}

  // flatten books across every market
  const positions = []
  const pending = []
  for (const [sym, b] of Object.entries(books || {})) {
    if (b.position) positions.push({ symbol: sym, ...b.position })
    for (const o of b.pendingOrders || []) pending.push({ symbol: sym, ...o })
  }

  const openMarket = (sym) => { setSymbol(sym); onEnter() }
  const cancelOrder = (sym, id) => { if (cancelLimitFor) cancelLimitFor({ type: 'cancelLimit', symbol: sym, id }) }

  const shareAccount = () =>
    setShare({ mode: 'account', roe: (totalPnl / STARTING) * 100, pnl: totalPnl, equity, winRate, wins: stats.wins, trades: stats.trades })
  const sharePosition = (p) => {
    const mark = metaOf(p.symbol).price ?? p.entry
    const pnl = unrealizedPnl({ side: p.side, entry: p.entry, price: mark, qty: p.qty })
    setShare({ mode: 'position', symbol: p.symbol, side: p.side, leverage: p.leverage, entry: p.entry, exit: mark, dp: metaOf(p.symbol).dp ?? 2, roe: roe(pnl, p.margin), pnl, closed: false })
  }
  const shareTrade = (h) =>
    setShare({ mode: 'position', symbol: h.symbol, side: h.side, leverage: h.leverage, entry: h.entry, exit: h.exit, dp: metaOf(h.symbol).dp ?? 2, roe: roe(h.pnl, h.margin), pnl: h.pnl, closed: true })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-sub">Welcome back</div>
            <h1 className="text-2xl font-extrabold text-txt">
              {name} <span className="text-sub">👋</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={shareAccount}
              className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm font-bold text-gold hover:bg-gold/20"
            >
              🚀 Flex PnL
            </button>
            <button
              onClick={() => onEnter()}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-white hover:brightness-110"
            >
              📈 Enter Market
            </button>
          </div>
        </div>

        {/* stat cards */}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Equity" value={usd(equity)} />
          <Card label="Total PnL" value={signedUsd(totalPnl)} sub={pct((totalPnl / STARTING) * 100)} tone={totalPnl >= 0 ? 'up' : 'down'} />
          <Card label="Realized PnL" value={signedUsd(stats.realized || 0)} tone={(stats.realized || 0) >= 0 ? 'up' : 'down'} />
          <Card label="Win Rate" value={stats.trades ? `${fmt(winRate, 0)}%` : '—'} sub={`${stats.wins}/${stats.trades} trades`} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* left column: markets + leaderboard */}
          <div className="space-y-4 lg:col-span-1">
            <Panel title="Markets" right={<span className="text-[10px] text-sub">{symbols.length} pairs</span>}>
              <div className="max-h-[360px] space-y-0.5 overflow-y-auto pr-1">
                {symbols.map((m) => (
                  <button
                    key={m.symbol}
                    onClick={() => openMarket(m.symbol)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-panel2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-txt">{m.symbol}<span className="font-normal text-sub">/USDT</span></div>
                      <div className="truncate text-[10px] text-sub">{m.name}</div>
                    </div>
                    <Spark data={m.spark} up={(m.change ?? 0) >= 0} />
                    <div className="w-24 text-right">
                      <div className="font-mono text-xs text-txt">{fmtPrice(m.price, m.dp)}</div>
                      <div className={`font-mono text-[10px] ${(m.change ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>{pct(m.change ?? 0)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="🏆 Leaderboard" right={<span className="text-[10px] text-sub">by equity</span>}>
              {leaderboard.length === 0 ? (
                <Empty>No traders yet</Empty>
              ) : (
                <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                  {leaderboard.map((r, i) => {
                    const me = !r.bot && r.name.toLowerCase() === name.toLowerCase()
                    return (
                      <div key={r.name + '-' + i} className={`flex items-center justify-between rounded px-2.5 py-1.5 text-xs ${me ? 'bg-accent/15 ring-1 ring-accent/40' : 'bg-panel2/50'}`}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="w-5 shrink-0 text-right font-mono text-sub">{i + 1}</span>
                          <span className={`truncate font-semibold ${me ? 'text-accent' : 'text-txt'}`}>{r.name}</span>
                          {r.bot ? (
                            <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${r.side === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{r.symbol} {r.side === 'long' ? 'L' : 'S'}{r.lev}x</span>
                          ) : r.online ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-up" title="online" />
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-3 font-mono">
                          {r.bot || r.pnl ? <span className={r.pnl >= 0 ? 'text-up' : 'text-down'}>{signedUsd(r.pnl)}</span> : null}
                          <span className="w-20 text-right text-txt">{usd(r.equity, 0)}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>
          </div>

          {/* right column: positions, pending, recent trades */}
          <div className="space-y-4 lg:col-span-2">
            <Panel title="Open Positions" right={<span className="text-[10px] text-sub">{positions.length} open</span>}>
              {positions.length === 0 ? (
                <Empty>No open positions · <button onClick={() => onEnter()} className="font-semibold text-accent hover:underline">open a trade →</button></Empty>
              ) : (
                <div className="space-y-1.5">
                  {positions.map((p) => {
                    const mark = metaOf(p.symbol).price ?? p.entry
                    const dp = metaOf(p.symbol).dp ?? 2
                    const upnl = unrealizedPnl({ side: p.side, entry: p.entry, price: mark, qty: p.qty })
                    const r = roe(upnl, p.margin)
                    return (
                      <div key={p.symbol} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-panel2/50 px-3 py-2">
                        <button onClick={() => openMarket(p.symbol)} className="flex items-center gap-2 text-left">
                          <span className={`rounded px-2 py-0.5 text-xs font-bold ${p.side === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{p.symbol} {p.side === 'long' ? 'LONG' : 'SHORT'} {p.leverage}x</span>
                          <span className="font-mono text-[11px] text-sub">entry {fmtPrice(p.entry, dp)} · liq <span className="text-down">{fmtPrice(p.liq, dp)}</span></span>
                        </button>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className={`font-mono text-sm font-bold ${upnl >= 0 ? 'text-up' : 'text-down'}`}>{signedUsd(upnl)}</div>
                            <div className={`font-mono text-[10px] ${upnl >= 0 ? 'text-up' : 'text-down'}`}>{pct(r)} ROE</div>
                          </div>
                          <button onClick={() => sharePosition(p)} title="Flex this position" className="rounded-md bg-gold/15 px-2 py-1 text-xs font-bold text-gold hover:bg-gold/25">🚀</button>
                          <button onClick={() => openMarket(p.symbol)} className="rounded-md bg-panel2 px-2.5 py-1 text-xs font-semibold text-txt hover:bg-border">Manage →</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>

            <Panel title="⏳ Pending Limit Orders" right={<span className="text-[10px] text-sub">{pending.length} resting</span>}>
              {pending.length === 0 ? (
                <Empty>No resting limit orders</Empty>
              ) : (
                <div className="space-y-1">
                  {pending.map((o) => {
                    const dp = metaOf(o.symbol).dp ?? 2
                    const part = o.filled > 1e-9
                    return (
                      <div key={o.symbol + o.id} className="flex items-center justify-between gap-2 rounded bg-panel2/50 px-3 py-1.5 font-mono text-xs">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${o.side === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{o.symbol} {o.side === 'long' ? 'BUY' : 'SELL'} {o.leverage}x</span>
                        <span className="text-accent">@ {fmtPrice(o.price, dp)}</span>
                        <span className="text-[10px] text-sub">{usd(o.margin)}{part ? ` · ${Math.round((o.filled / o.qty) * 100)}%` : ''}</span>
                        <button onClick={() => cancelOrder(o.symbol, o.id)} className="rounded bg-panel2 px-2 py-0.5 text-[10px] font-semibold text-txt hover:text-down">✕ Cancel</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>

            <Panel title="Recent Trades" right={<span className="text-[10px] text-sub">last {Math.min(history.length, 12)}</span>}>
              {history.length === 0 ? (
                <Empty>No closed trades yet</Empty>
              ) : (
                <div className="space-y-1">
                  {history.slice(0, 12).map((h, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded bg-panel2/50 px-3 py-1.5 font-mono text-xs">
                      <span className="flex items-center gap-2">
                        <span className="w-12 font-bold text-txt">{h.symbol}</span>
                        <span className={h.side === 'long' ? 'text-up' : 'text-down'}>{h.side === 'long' ? 'LONG' : 'SHORT'} {h.leverage}x</span>
                      </span>
                      <span className="hidden text-[10px] text-sub sm:inline">{fmtPrice(h.entry, metaOf(h.symbol).dp ?? 2)} → {fmtPrice(h.exit, metaOf(h.symbol).dp ?? 2)}</span>
                      <span className="text-[10px] text-sub">{reasonLabel(h.reason)}</span>
                      <span className={`w-24 text-right ${h.pnl >= 0 ? 'text-up' : 'text-down'}`}>{signedUsd(h.pnl)}</span>
                      <button onClick={() => shareTrade(h)} title="Flex this trade" className="text-gold hover:brightness-125">🚀</button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>

      {share && <ShareCard share={share} onClose={() => setShare(null)} />}
    </div>
  )
}

function Panel({ title, right, children }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-sub">{title}</span>
        {right}
      </div>
      {children}
    </div>
  )
}
function Empty({ children }) {
  return <div className="py-6 text-center text-sm text-sub/60">{children}</div>
}
function Card({ label, value, sub, tone = 'neutral' }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-txt'
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="text-[10px] uppercase tracking-wide text-sub">{label}</div>
      <div className={`font-mono text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className={`font-mono text-[11px] ${color}`}>{sub}</div>}
    </div>
  )
}

// tiny inline sparkline
function Spark({ data, up }) {
  if (!data || data.length < 2) return <div className="w-14" />
  const w = 56, h = 22
  const min = Math.min(...data), max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * h}`).join(' ')
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={pts} fill="none" stroke={up ? '#00E676' : '#FF5252'} strokeWidth="1.5" />
    </svg>
  )
}

function reasonLabel(r) {
  if (r === 'liq') return '☠ liq'
  if (r === 'tp') return 'TP'
  if (r === 'sl') return 'SL'
  if (r === 'trail') return 'trail'
  return 'closed'
}
