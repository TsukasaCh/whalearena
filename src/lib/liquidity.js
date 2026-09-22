// Aggregate the bot crowd's liquidation prices into "pools" — the histogram of
// where forced liquidations would fire, weighted by notional. This is both the
// heatmap the MM sees and the target selector the hunts use.

export function liquidityPools(bots, price) {
  if (!price) return []
  const bucket = price * 0.003 // ~0.3% grid
  const map = new Map()
  for (const b of bots) {
    const key = Math.round(b.liq / bucket)
    let e = map.get(key)
    if (!e) {
      e = { key, price: key * bucket, long: 0, short: 0, count: 0 }
      map.set(key, e)
    }
    const notional = b.margin * b.leverage
    if (b.side === 'long') e.long += notional
    else e.short += notional
    e.count += 1
  }
  return [...map.values()].map((e) => ({
    ...e,
    weight: e.long + e.short,
    side: e.long >= e.short ? 'long' : 'short',
  }))
}

// Pick the densest pool within range — the juiciest target to hunt.
export function densestPool(pools, price, maxDistFrac = 0.06) {
  let best = null
  for (const p of pools) {
    const d = Math.abs(p.price - price) / price
    if (d > maxDistFrac || d < 0.0015) continue
    if (!best || p.weight > best.weight) best = p
  }
  return best
}
