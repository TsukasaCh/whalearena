// Aggregate the shared base (1-minute) series into the candles for a given
// timeframe. Every timeframe is a view of the SAME underlying data, grouped by
// clock-aligned time buckets — so a bullish run on 1m is a bullish candle on 4h.

// Build the displayed candles: group base bars (+ the live bar) into buckets of
// `bucket` base bars, aligned to the clock, and return the last `view` of them.
export function buildView(base, baseCurrent, bucket, view, basePeriod) {
  const span = bucket * basePeriod
  // Only the tail can ever be visible — bound the work for low timeframes.
  const need = view * bucket + bucket
  const src = base.length > need ? base.slice(-need) : base

  const groups = []
  let curKey = null
  let g = null
  const fold = (bar) => {
    const key = Math.floor(bar.time / span)
    if (key !== curKey) {
      g = { time: key * span, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume || 0 }
      groups.push(g)
      curKey = key
    } else {
      if (bar.high > g.high) g.high = bar.high
      if (bar.low < g.low) g.low = bar.low
      g.close = bar.close
      g.volume += bar.volume || 0
    }
  }
  for (const b of src) fold(b)
  if (baseCurrent) fold(baseCurrent)
  return groups.slice(-view)
}

// Build the FULL scrollable series for a timeframe: deep hourly history (only
// meaningful at ≥1h) stitched onto the live 1m base, aggregated into `bucket`
// base-periods. Deep bars and base bars occupy disjoint time ranges, so folding
// both into the same clock-aligned buckets merges seamlessly at the boundary.
export function buildSeries(deep, base, baseCurrent, bucket, basePeriod) {
  const span = bucket * basePeriod
  const map = new Map()
  const fold = (bar) => {
    const key = Math.floor(bar.time / span) * span
    let g = map.get(key)
    if (!g) {
      g = { time: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume || 0 }
      map.set(key, g)
    } else {
      if (bar.high > g.high) g.high = bar.high
      if (bar.low < g.low) g.low = bar.low
      g.close = bar.close
      g.volume += bar.volume || 0
    }
  }
  if (bucket >= 60 && deep) for (const b of deep) fold(b) // ~3 months of hourly history
  for (const b of base) fold(b)
  if (baseCurrent) fold(baseCurrent)
  const arr = [...map.values()].sort((a, b) => a.time - b.time)
  const cap = bucket < 60 ? 6000 : 4200 // keep the chart snappy
  return arr.length > cap ? arr.slice(-cap) : arr
}

// The single current (last) aggregated candle — recomputed cheaply each tick by
// scanning only the base bars that fall in the current bucket.
export function currentCandle(base, baseCurrent, bucket, basePeriod) {
  const span = bucket * basePeriod
  const curKey = Math.floor(baseCurrent.time / span)
  let open = baseCurrent.open
  let high = baseCurrent.high
  let low = baseCurrent.low
  let volume = baseCurrent.volume || 0
  for (let i = base.length - 1; i >= 0; i--) {
    const b = base[i]
    if (Math.floor(b.time / span) !== curKey) break
    open = b.open
    if (b.high > high) high = b.high
    if (b.low < low) low = b.low
    volume += b.volume || 0
  }
  return { time: curKey * span, open, high, low, close: baseCurrent.close, volume }
}
