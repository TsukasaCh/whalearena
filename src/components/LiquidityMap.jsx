import { useMemo } from 'react'
import { useSim } from '../store/useSimStore'
import { fmtPrice, compact } from '../lib/format'

// Liquidation heatmap built from the server's combined liquidity (bots + real
// traders). Pools with a real trader in them are flagged 👤.
export default function LiquidityMap() {
  const price = useSim((s) => s.price)
  const dp = useSim((s) => s.dp)
  const map = useSim((s) => s.map)

  const { rows, maxW } = useMemo(() => {
    if (!price) return { rows: [], maxW: 1 }
    const bucket = price * 0.003
    const m = new Map()
    for (const e of map) {
      const key = Math.round(e.l / bucket)
      let g = m.get(key)
      if (!g) { g = { price: key * bucket, long: 0, short: 0, count: 0, real: false }; m.set(key, g) }
      if (e.s) g.long += e.n
      else g.short += e.n
      g.count++
      if (e.r) g.real = true
    }
    let pools = [...m.values()]
      .map((g) => ({ ...g, weight: g.long + g.short, side: g.long >= g.short ? 'long' : 'short' }))
      .filter((p) => Math.abs(p.price - price) / price < 0.08)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 9)
      .map((p) => ({ ...p, id: 'p' + p.price.toFixed(dp) }))
    pools.push({ price, marker: true, id: 'mark' })
    pools.sort((a, b) => b.price - a.price)
    const maxW = Math.max(1, ...pools.map((p) => p.weight || 0))
    return { rows: pools, maxW }
  }, [map, price])

  return (
    <div className="space-y-1">
      {rows.map((r) => {
        if (r.marker) {
          return (
            <div key={r.id} className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-gold/40" />
              <span className="rounded-full bg-gold/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-gold">
                {fmtPrice(price, dp)}
              </span>
              <div className="h-px flex-1 bg-gold/40" />
            </div>
          )
        }
        const w = ((r.weight || 0) / maxW) * 100
        const color = r.side === 'short' ? 'bg-down/45' : 'bg-up/45'
        return (
          <div key={r.id} className={`flex items-center gap-2 rounded-md ${r.real ? 'bg-accent/10' : ''}`}>
            <span className={`w-16 shrink-0 text-right font-mono text-[11px] ${r.real ? 'text-accent' : 'text-sub'}`}>
              {fmtPrice(r.price, dp)}
            </span>
            <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-panel2">
              <div className={`h-full rounded-md ${color} transition-all`} style={{ width: `${w}%` }} />
              <span className="absolute inset-y-0 right-1.5 flex items-center gap-1 font-mono text-[10px] text-txt/80">
                {r.real && <span className="text-accent">👤</span>}
                {r.count} · ${compact(r.weight)}
              </span>
            </div>
          </div>
        )
      })}
      {rows.length <= 1 && (
        <div className="py-4 text-center text-[11px] text-sub">No liquidity in range</div>
      )}
    </div>
  )
}
