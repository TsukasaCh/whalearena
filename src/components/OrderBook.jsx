import { useMemo, useRef, useState, useEffect } from 'react'
import { useSim } from '../store/useSimStore'
import { fmtPrice, fmtQty, compact } from '../lib/format'

const LEVELS = 16
const clean = (n) => Number(n.toPrecision(4)) // tidy grouping tick (no float noise)
const dpOfTick = (t) => (t > 0 ? Math.max(0, -Math.floor(Math.log10(t))) : 2)

// The order book now RENDERS the server-authoritative bot ladder (real resting
// liquidity that market orders walk & consume), with the player's own limit
// orders overlaid. `group` only aggregates the server levels into coarser rows.
export default function OrderBook() {
  const price = useSim((s) => s.price)
  const symbol = useSim((s) => s.symbol)
  const dp = useSim((s) => s.dp)
  const baseAsset = useSim((s) => s.baseAsset)
  const book = useSim((s) => s.book)
  const resting = useSim((s) => s.resting)
  const myOrders = useSim((s) => s.pendingOrders)

  const tick = book?.tick || 0
  const groupings = useMemo(() => (tick > 0 ? [1, 2, 5, 10, 20].map((m) => clean(m * tick)) : []), [tick])
  const [group, setGroup] = useState(0)
  useEffect(() => {
    if (!tick) return
    let saved
    try { saved = Number(localStorage.getItem('whale.book.group.' + symbol)) } catch { /* ignore */ }
    setGroup(groupings.includes(saved) ? saved : tick)
  }, [symbol, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const g = group || tick || 1
  const gdp = Math.max(dpOfTick(g), 0)

  const built = useMemo(() => {
    if (!price || !book || !book.asks) return { asks: [], bids: [], maxSize: 1, totA: 0, totB: 0 }
    const midIdx = Math.floor(price / g + 1e-9)
    const askIdx0 = midIdx + 1
    const idxOf = (p) => Math.floor(p / g + 1e-9)
    const askMap = new Map()
    const bidMap = new Map()
    const put = (map, key, p, q, real, mine) => {
      let e = map.get(key)
      if (!e) { e = { key, price: key * g, size: 0, real: 0, mine: false }; map.set(key, e) }
      e.size += q
      if (real) { e.real += q; if (mine) e.mine = true }
    }
    for (const a of book.asks) put(askMap, Math.max(askIdx0, idxOf(a.p)), a.p, a.q, false, false)
    for (const b of book.bids) put(bidMap, Math.min(midIdx, idxOf(b.p)), b.p, b.q, false, false)
    // overlay the player's own + other users' real resting limit orders
    const mineKeys = new Set((myOrders || []).map((o) => idxOf(o.price)))
    for (const o of resting || []) {
      const bid = o.s === 1
      const key = bid ? Math.min(midIdx, idxOf(o.p)) : Math.max(askIdx0, idxOf(o.p))
      put(bid ? bidMap : askMap, key, o.p, o.q, true, mineKeys.has(idxOf(o.p)))
    }
    const asks = [...askMap.values()].sort((a, b) => a.price - b.price).slice(0, LEVELS)
    const bids = [...bidMap.values()].sort((a, b) => b.price - a.price).slice(0, LEVELS)
    let cumA = 0, cumB = 0, maxSize = 1e-9, sum = 0
    for (const r of asks) { cumA += r.size; r.cum = cumA; maxSize = Math.max(maxSize, r.size); sum += r.size }
    for (const r of bids) { cumB += r.size; r.cum = cumB; maxSize = Math.max(maxSize, r.size); sum += r.size }
    const avg = sum / ((asks.length + bids.length) || 1)
    const wallLine = avg * 1.8
    for (const r of [...asks, ...bids]) r.wall = r.size >= wallLine || r.real > 0
    asks.reverse() // highest ask on top
    return { asks, bids, maxSize, totA: cumA, totB: cumB }
  }, [price, book, resting, myOrders, g])

  const prevPrice = useRef(price)
  const dir = price > prevPrice.current ? 1 : price < prevPrice.current ? -1 : 0
  if (price !== prevPrice.current) prevPrice.current = price

  const chooseGroup = (gp) => {
    setGroup(gp)
    try { localStorage.setItem('whale.book.group.' + symbol, String(gp)) } catch { /* ignore */ }
  }

  const buyPct = built.totA + built.totB ? (built.totB / (built.totA + built.totB)) * 100 : 50

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-sub">Order Book</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-sub">group</span>
          <select
            value={group}
            onChange={(e) => chooseGroup(Number(e.target.value))}
            className="rounded border border-border bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-txt outline-none"
          >
            {groupings.map((gr) => (
              <option key={gr} value={gr}>{fmtPrice(gr, dpOfTick(gr))}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-sub">
        <span>Price (USDT)</span>
        <span>Size ({baseAsset})</span>
      </div>

      <div>
        {built.asks.map((r) => (
          <Row key={'a' + r.key} row={r} maxSize={built.maxSize} tone="down" pdp={gdp} />
        ))}
      </div>

      <div className="my-0.5 flex items-center justify-between rounded bg-panel2/60 px-2 py-1">
        <span className={`font-mono text-sm font-bold ${dir > 0 ? 'text-up' : dir < 0 ? 'text-down' : 'text-txt'}`}>
          {dir > 0 ? '▲' : dir < 0 ? '▼' : '•'} {fmtPrice(price, dp)}
        </span>
        <span className="text-[10px] text-sub">mark</span>
      </div>

      <div>
        {built.bids.map((r) => (
          <Row key={'b' + r.key} row={r} maxSize={built.maxSize} tone="up" pdp={gdp} />
        ))}
      </div>

      <div className="mt-2">
        <div className="mb-0.5 flex justify-between font-mono text-[10px]">
          <span className="text-up">{Math.round(buyPct)}% · {compact(built.totB)}</span>
          <span className="text-down">{compact(built.totA)} · {Math.round(100 - buyPct)}%</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-down/50">
          <div className="h-full bg-up/70" style={{ width: `${buyPct}%` }} />
        </div>
      </div>
    </div>
  )
}

function Row({ row, maxSize, tone, pdp }) {
  const w = Math.max(3, (row.size / maxSize) * 100)
  const isUp = tone === 'up'
  const barBg = isUp ? 'bg-up' : 'bg-down'
  const priceColor = isUp ? 'text-up' : 'text-down'
  const real = row.real > 0 // a genuine resting user limit order sits here
  return (
    <div className="relative flex items-center justify-between px-1 py-[1.5px] font-mono text-[10px]">
      <div
        className={`absolute inset-y-0 right-0 ${barBg} transition-[width] duration-300 ease-out`}
        style={{ width: `${w}%`, opacity: real ? 0.5 : row.wall ? 0.32 : 0.12 }}
      />
      {row.wall && (
        <div
          className={`absolute inset-y-0 w-[2px] ${row.mine ? 'bg-gold' : barBg} ${row.mine ? '' : 'opacity-90'}`}
          style={{ right: `${w}%` }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1">
        {real && (
          <span className={row.mine ? 'text-gold' : priceColor} title={row.mine ? 'Order limit kamu' : 'Order limit trader lain'}>
            {row.mine ? '◆' : '•'}
          </span>
        )}
        <span className={priceColor}>{fmtPrice(row.price, pdp)}</span>
      </span>
      <span className={`relative z-10 ${row.wall ? 'font-bold text-txt' : 'text-txt/75'}`}>{fmtQty(row.size)}</span>
    </div>
  )
}
