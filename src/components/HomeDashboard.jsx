import { useState } from 'react'
import { useSim, accruedStake, STAKE_APY } from '../store/useSimStore'
import { useAuth } from '../store/useAuth'
import { unrealizedPnl, roe } from '../lib/trading'
import { usd, fmt, fmtPrice, fmtQty, pct, signedUsd, marketCap, usdCompact } from '../lib/format'
import ShareCard from './ShareCard'
import { CoinIcon } from './ui'
import { algoView } from './AlgoOrders'

const STARTING = 10000

export default function HomeDashboard({ onEnter }) {
  const name = useAuth((s) => s.session?.user?.name || 'Trader')
  const equity = useSim((s) => s.equity)
  const balance = useSim((s) => s.balance)
  const stats = useSim((s) => s.stats)
  const history = useSim((s) => s.history)
  const books = useSim((s) => s.books)
  const spot = useSim((s) => s.spot)
  const staked = useSim((s) => s.staked)
  const symbols = useSim((s) => s.symbols)
  const leaderboard = useSim((s) => s.leaderboard)
  const setSymbol = useSim((s) => s.setSymbol)
  const cancelLimitFor = useSim((s) => s._send)
  const cancelAlgo = useSim((s) => s.cancelAlgo)
  const [share, setShare] = useState(null)

  const totalPnl = equity - STARTING
  const winRate = stats.trades ? (stats.wins / stats.trades) * 100 : 0
  const metaOf = (sym) => symbols.find((s) => s.symbol === sym) || {}

  // flatten books across every market
  const positions = []
  const pending = []
  const algos = [] // running TWAP / VWAP orders (their unspent margin is locked too)
  for (const [sym, b] of Object.entries(books || {})) {
    if (b.position) positions.push({ symbol: sym, ...b.position })
    for (const o of b.pendingOrders || []) pending.push({ symbol: sym, ...o })
    for (const a of b.algos || []) algos.push({ ...a, spot: !!a.spot || sym.endsWith(':spot'), symbol: sym.replace(':spot', '') })
  }
  // spot holdings across every market
  const holdings = []
  for (const [sym, h] of Object.entries(spot || {})) {
    if (!h || h.qty <= 0) continue
    const price = metaOf(sym).price ?? 0
    holdings.push({ symbol: sym, qty: h.qty, cost: h.cost, avg: h.qty ? h.cost / h.qty : 0, price, value: h.qty * price, pnl: h.qty * price - h.cost })
  }
  const spotValue = holdings.reduce((s, h) => s + h.value, 0)
  // value parked in running SPOT algo orders: coins waiting to be sold, or USDT waiting to buy
  const spotAlgos = algos.filter((a) => a.spot)
  const spotAlgoValue = spotAlgos.reduce((s, a) => {
    const mk = metaOf(a.symbol)
    return s + (a.side === 'sell' ? (a.remQty || 0) * (mk.spot ?? mk.price ?? 0) : a.reserved || 0)
  }, 0)
  const perpAlgoCount = algos.length - spotAlgos.length
  // staked coins across every market (accrued to now)
  const stakes = []
  for (const [sym, st] of Object.entries(staked || {})) {
    if (!st || st.qty <= 0) continue
    const mk = metaOf(sym)
    const px = mk.spot ?? mk.price ?? 0
    const qty = accruedStake(st)
    stakes.push({ symbol: sym, qty, price: px, value: qty * px, earned: (st.earned || 0) + (qty - st.qty), dp: mk.dp ?? 2 })
  }
  const stakedValue = stakes.reduce((s, x) => s + x.value, 0)

  const openMarket = (sym, mode = 'perp') => { setSymbol(sym); onEnter(mode) }
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

  const futuresValue = equity - balance - spotValue - spotAlgoValue - stakedValue // margin + uPnL + resting limits + futures algos
  const totalPct = (totalPnl / STARTING) * 100
  const sideBadge = (long) => `rounded px-1.5 py-0.5 text-[11px] font-semibold ${long ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* ───────── left: overview, portfolio, books ───────── */}
          <div className="min-w-0 space-y-4 lg:col-span-2">
            {/* estimated total value */}
            <div className="card p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-sub">
                    Estimated total value · <span className="text-txt">{name}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-mono text-4xl font-semibold tracking-tight text-txt">{fmt(equity)}</span>
                    <span className="text-sm font-medium text-sub">USD</span>
                  </div>
                  <div className="mt-2 text-sm">
                    <span className="border-b border-dashed border-sub/50 text-sub" title={`Sejak modal awal ${usd(STARTING, 0)}`}>
                      Total PnL
                    </span>{' '}
                    <span className={`font-mono ${totalPnl >= 0 ? 'text-up' : 'text-down'}`}>
                      {signedUsd(totalPnl)} ({pct(totalPct)})
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-5 text-right sm:gap-8">
                  <MiniStat label="Realized PnL" value={signedUsd(stats.realized || 0)} tone={(stats.realized || 0) >= 0 ? 'up' : 'down'} />
                  <MiniStat label="Win rate" value={stats.trades ? `${fmt(winRate, 0)}%` : '—'} />
                  <MiniStat label="Trades" value={`${stats.wins}/${stats.trades}`} />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button onClick={() => onEnter('perp')} className="btn btn-primary px-6">Trade futures</button>
                <button onClick={() => onEnter('spot')} className="btn btn-ghost px-6">Spot</button>
                <button onClick={shareAccount} className="btn btn-ghost px-6">🚀 Flex PnL</button>
              </div>
            </div>

            {/* portfolio */}
            <div className="card p-5 sm:p-7">
              <h2 className="mb-4 text-lg font-semibold text-txt">Portfolio</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile label="Available" value={usd(balance)} hint="Free balance" />
                <Tile label="Futures" value={usd(futuresValue)} hint={`${positions.length} open · ${pending.length} resting${perpAlgoCount ? ` · ${perpAlgoCount} algo` : ''}`} onClick={() => onEnter('perp')} />
                <Tile label="Spot" value={usd(spotValue + spotAlgoValue)} hint={`${holdings.length} coin${holdings.length === 1 ? '' : 's'}${spotAlgos.length ? ` · ${spotAlgos.length} algo` : ''}`} onClick={() => onEnter('spot')} />
                <Tile label="Earn" value={usd(stakedValue)} hint={`${(STAKE_APY * 100).toFixed(0)}% APY staking`} onClick={() => onEnter('spot')} />
              </div>
            </div>

            {/* open positions */}
            <Panel title="Open positions" right={`${positions.length} open`}>
              {positions.length === 0 ? (
                <Empty>No open positions · <button onClick={() => onEnter()} className="font-semibold text-txt underline-offset-2 hover:underline">open a trade →</button></Empty>
              ) : (
                <div className="divide-y divide-border">
                  {positions.map((p) => {
                    const mark = metaOf(p.symbol).price ?? p.entry
                    const dp = metaOf(p.symbol).dp ?? 2
                    const upnl = unrealizedPnl({ side: p.side, entry: p.entry, price: mark, qty: p.qty })
                    const r = roe(upnl, p.margin)
                    return (
                      <div key={p.symbol} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <button onClick={() => openMarket(p.symbol)} className="flex min-w-0 items-center gap-3 text-left">
                          <CoinIcon symbol={p.symbol} size={32} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-txt">{p.symbol}USDT</span>
                              <span className={sideBadge(p.side === 'long')}>{p.side === 'long' ? 'Long' : 'Short'} {p.leverage}x</span>
                            </span>
                            <span className="mt-0.5 block font-mono text-xs text-sub">Entry {fmtPrice(p.entry, dp)} · Liq <span className="text-down">{fmtPrice(p.liq, dp)}</span></span>
                          </span>
                        </button>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className={`font-mono text-sm font-semibold ${upnl >= 0 ? 'text-up' : 'text-down'}`}>{signedUsd(upnl)}</div>
                            <div className={`font-mono text-xs ${upnl >= 0 ? 'text-up' : 'text-down'}`}>{pct(r)} ROE</div>
                          </div>
                          <button onClick={() => sharePosition(p)} title="Flex this position" className="btn btn-ghost btn-sm !px-2.5">🚀</button>
                          <button onClick={() => openMarket(p.symbol)} className="btn btn-ghost btn-sm">Manage</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>

            {/* spot holdings */}
            <Panel title="Spot holdings" right={holdings.length ? usd(spotValue) : `${holdings.length} coins`}>
              {holdings.length === 0 ? (
                <Empty>No coins held · <button onClick={() => onEnter('spot')} className="font-semibold text-txt underline-offset-2 hover:underline">buy spot →</button></Empty>
              ) : (
                <div className="divide-y divide-border">
                  {holdings.map((h) => {
                    const dp = metaOf(h.symbol).dp ?? 2
                    const r = h.cost ? (h.pnl / h.cost) * 100 : 0
                    return (
                      <div key={h.symbol} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <button onClick={() => openMarket(h.symbol, 'spot')} className="flex min-w-0 items-center gap-3 text-left">
                          <CoinIcon symbol={h.symbol} size={32} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-txt">{h.symbol}</span>
                            <span className="mt-0.5 block font-mono text-xs text-sub">{fmtQty(h.qty)} · avg {fmtPrice(h.avg, dp)}</span>
                          </span>
                        </button>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="font-mono text-sm font-semibold text-txt">{usd(h.value)}</div>
                            <div className={`font-mono text-xs ${h.pnl >= 0 ? 'text-up' : 'text-down'}`}>{signedUsd(h.pnl)} · {pct(r)}</div>
                          </div>
                          <button onClick={() => openMarket(h.symbol, 'spot')} className="btn btn-ghost btn-sm">Trade</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>

            {/* staking */}
            <Panel title={`Staking · ${(STAKE_APY * 100).toFixed(0)}% APY`} right={stakes.length ? usd(stakedValue) : '—'}>
              {stakes.length === 0 ? (
                <Empty>No coins staked · <button onClick={() => onEnter('spot')} className="font-semibold text-txt underline-offset-2 hover:underline">stake spot coins →</button></Empty>
              ) : (
                <div className="divide-y divide-border">
                  {stakes.map((x) => (
                    <div key={x.symbol} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <button onClick={() => openMarket(x.symbol, 'spot')} className="flex min-w-0 items-center gap-3 text-left">
                        <CoinIcon symbol={x.symbol} size={32} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-txt">{x.symbol}</span>
                            <span className="rounded bg-up/15 px-1.5 py-0.5 text-[11px] font-semibold text-up">Staked</span>
                          </span>
                          <span className="mt-0.5 block font-mono text-xs text-sub">{fmtQty(x.qty)} · <span className="text-up">+{fmtQty(x.earned)}</span> earned</span>
                        </span>
                      </button>
                      <div className="font-mono text-sm font-semibold text-txt">{usd(x.value)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* pending limit orders */}
            {algos.length > 0 && (
              <Panel title="Algo orders" right={`${algos.length} running`}>
                <div className="divide-y divide-border">
                  {algos.map((a) => {
                    const v = algoView(a, metaOf(a.symbol).base ?? a.symbol)
                    return (
                      <div key={a.symbol + a.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                        <button onClick={() => openMarket(a.symbol, v.spot ? 'spot' : 'perp')} className="flex items-center gap-2 text-left">
                          <span className="text-sm font-semibold text-txt">{a.symbol}{v.spot ? '' : 'USDT'}</span>
                          <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] font-semibold text-txt">{v.spot ? 'Spot ' : ''}{a.type.toUpperCase()}</span>
                          <span className={sideBadge(v.buy)}>{v.label}</span>
                        </button>
                        <span className="font-mono text-sub">
                          {v.progress} · slice {Math.min(a.done, a.slices)}/{a.slices}
                        </span>
                        <button onClick={() => cancelAlgo(a.id, a.symbol, v.spot)} className="btn btn-outline btn-sm hover:!border-down hover:text-down">Cancel</button>
                      </div>
                    )
                  })}
                </div>
              </Panel>
            )}

            <Panel title="Pending limit orders" right={`${pending.length} resting`}>
              {pending.length === 0 ? (
                <Empty>No resting limit orders</Empty>
              ) : (
                <div className="divide-y divide-border">
                  {pending.map((o) => {
                    const dp = metaOf(o.symbol).dp ?? 2
                    const part = o.filled > 1e-9
                    return (
                      <div key={o.symbol + o.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-txt">{o.symbol}USDT</span>
                          <span className={sideBadge(o.side === 'long')}>{o.side === 'long' ? 'Buy' : 'Sell'} {o.leverage}x</span>
                        </span>
                        <span className="font-mono text-txt">@ {fmtPrice(o.price, dp)}{o.visFrac > 0 ? <span className="ml-1.5 text-sub">· Iceberg {Math.round(o.visFrac * 100)}%</span> : null}</span>
                        <span className="font-mono text-sub">{usd(o.margin)}{part ? ` · ${Math.round((o.filled / o.qty) * 100)}%` : ''}</span>
                        <button onClick={() => cancelOrder(o.symbol, o.id)} className="btn btn-outline btn-sm hover:!border-down hover:text-down">Cancel</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>

            {/* markets */}
            <Panel title="Markets" right={`${symbols.length} pairs`}>
              <div className="-mx-2">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_7rem] items-center gap-3 px-2 pb-1 text-xs text-sub sm:grid-cols-[minmax(0,1.4fr)_5rem_7rem_5rem_auto] md:grid-cols-[minmax(0,1.4fr)_5rem_7rem_5rem_5.5rem_auto]">
                  <span>Name</span>
                  <span className="hidden sm:block" />
                  <span className="text-right">Last price</span>
                  <span className="hidden text-right sm:block">Change</span>
                  <span className="hidden text-right md:block" title="Harga spot × suplai beredar">Market cap</span>
                  <span className="hidden w-[68px] sm:block" />
                </div>
                {symbols.map((m) => {
                  const up = (m.change ?? 0) >= 0
                  return (
                    <div
                      key={m.symbol}
                      role="button"
                      tabIndex={0}
                      onClick={() => openMarket(m.symbol)}
                      onKeyDown={(e) => { if (e.key === 'Enter') openMarket(m.symbol) }}
                      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_7rem] items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-panel2 sm:grid-cols-[minmax(0,1.4fr)_5rem_7rem_5rem_auto] md:grid-cols-[minmax(0,1.4fr)_5rem_7rem_5rem_5.5rem_auto]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <CoinIcon symbol={m.symbol} size={32} />
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate text-sm font-semibold text-txt">{m.symbol}<span className="font-normal text-sub">/USDT</span></span>
                          <span className="block truncate text-xs text-sub">{m.name}<span className="md:hidden"> · {usdCompact(marketCap(m))}</span></span>
                        </span>
                      </span>
                      <Spark data={m.spark} up={up} />
                      <span className="text-right leading-tight">
                        <span className="block font-mono text-sm text-txt">{fmtPrice(m.price, m.dp)}</span>
                        <span className={`block font-mono text-xs sm:hidden ${up ? 'text-up' : 'text-down'}`}>{pct(m.change ?? 0)}</span>
                      </span>
                      <span className={`hidden text-right font-mono text-sm sm:block ${up ? 'text-up' : 'text-down'}`}>{pct(m.change ?? 0)}</span>
                      <span className="hidden text-right font-mono text-sm text-txt md:block">{usdCompact(marketCap(m))}</span>
                      <span className="hidden sm:block">
                        <span className="btn btn-ghost btn-sm">Trade</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </Panel>
          </div>

          {/* ───────── right: activity + leaderboard ───────── */}
          <div className="min-w-0 space-y-4">
            <Panel title="Recent trades" right={`last ${Math.min(history.length, 12)}`}>
              {history.length === 0 ? (
                <Empty>No closed trades yet</Empty>
              ) : (
                <div className="divide-y divide-border">
                  {history.slice(0, 12).map((h, i) => {
                    const dp = metaOf(h.symbol).dp ?? 2
                    const spotTrade = h.kind === 'spot'
                    return (
                      <div key={i} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium text-txt">
                            <span>{h.symbol}</span>
                            {spotTrade ? (
                              <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] font-semibold text-sub">Spot sell</span>
                            ) : (
                              <span className={sideBadge(h.side === 'long')}>{h.side === 'long' ? 'Long' : 'Short'} {h.leverage}x</span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-xs text-sub">
                            {spotTrade ? `${fmtQty(h.qty)} @ ${fmtPrice(h.price, dp)}` : `${fmtPrice(h.entry, dp)} → ${fmtPrice(h.exit, dp)}`} · {reasonLabel(h.reason)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`font-mono text-sm font-medium ${h.pnl >= 0 ? 'text-up' : 'text-down'}`}>{signedUsd(h.pnl)}</span>
                          {!spotTrade && (
                            <button onClick={() => shareTrade(h)} title="Flex this trade" className="rounded-full p-1 text-sm opacity-70 hover:bg-panel2 hover:opacity-100">🚀</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>

            <Panel title="Leaderboard" right="by equity">
              {leaderboard.length === 0 ? (
                <Empty>No traders yet</Empty>
              ) : (
                <div className="-mx-2 max-h-[30rem] overflow-y-auto">
                  {leaderboard.map((r, i) => {
                    const me = !r.bot && r.name.toLowerCase() === name.toLowerCase()
                    return (
                      <div key={r.name + '-' + i} className={`flex items-center justify-between gap-2 rounded-xl px-2 py-2 text-[13px] ${me ? 'bg-panel2' : ''}`}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className={`w-5 shrink-0 text-center font-mono text-xs ${i < 3 ? 'font-bold text-gold' : 'text-sub'}`}>{i + 1}</span>
                          <span className="truncate font-medium text-txt">{r.name}</span>
                          {me && <span className="shrink-0 rounded bg-txt px-1.5 py-0.5 text-[10px] font-bold text-black">You</span>}
                          {r.bot ? (
                            <span className={`shrink-0 ${sideBadge(r.side === 'long')} !text-[10px]`}>{r.symbol} {r.side === 'long' ? 'L' : 'S'}{r.lev}x</span>
                          ) : r.online ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-up" title="online" />
                          ) : null}
                        </span>
                        <span className="shrink-0 text-right leading-tight">
                          <span className="block font-mono text-txt">{usd(r.equity, 0)}</span>
                          {r.bot || r.pnl ? <span className={`block font-mono text-[11px] ${r.pnl >= 0 ? 'text-up' : 'text-down'}`}>{signedUsd(r.pnl)}</span> : null}
                        </span>
                      </div>
                    )
                  })}
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
    <div className="card p-5 sm:p-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-txt">{title}</h2>
        {right != null && <span className="font-mono text-xs text-sub">{right}</span>}
      </div>
      {children}
    </div>
  )
}
function Empty({ children }) {
  return <div className="py-8 text-center text-sm text-sub">{children}</div>
}
function MiniStat({ label, value, tone = 'neutral' }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-txt'
  return (
    <div>
      <div className="whitespace-nowrap text-xs text-sub">{label}</div>
      <div className={`mt-1 whitespace-nowrap font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  )
}
// portfolio tile (account bucket)
function Tile({ label, value, hint, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`rounded-xl bg-panel2/60 p-4 text-left transition-colors ${onClick ? 'hover:bg-panel2' : ''}`}
    >
      <div className="text-sm text-sub">{label}</div>
      <div className="mt-3 font-mono text-lg font-semibold text-txt">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-sub">{hint}</div>}
    </Tag>
  )
}

// tiny inline sparkline
function Spark({ data, up }) {
  if (!data || data.length < 2) return <div className="hidden w-20 sm:block" />
  const w = 80, h = 28
  const min = Math.min(...data), max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${1 + (h - 2) - ((v - min) / span) * (h - 2)}`).join(' ')
  return (
    <svg width={w} height={h} className="hidden shrink-0 sm:block">
      <polyline points={pts} fill="none" stroke={up ? '#25a750' : '#ca3f64'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function reasonLabel(r) {
  if (r === 'liq') return '☠ liq'
  if (r === 'tp') return 'TP'
  if (r === 'sl') return 'SL'
  if (r === 'trail') return 'trail'
  if (r === 'spot') return 'spot'
  return 'closed'
}
