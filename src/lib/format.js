export const fmt = (n, d = 2) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

// Price formatter honoring a market's display precision (BTC→2, DOGE→6, PEPE→10).
export const fmtPrice = (n, dp = 2) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

// Compact coin quantity: show enough significant figures for cheap coins.
export const fmtQty = (n) => {
  const a = Math.abs(n)
  const d = a >= 1000 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : 2
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  return fmt(n, d)
}

export const usd = (n, d = 2) => (n < 0 ? '-$' : '$') + fmt(Math.abs(n), d)

export const signedUsd = (n, d = 2) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n), d)

export const pct = (n, d = 2) => (n >= 0 ? '+' : '') + fmt(n, d) + '%'

// 950 → "950", 12_345 → "12.3K", 12_000_000 → "12.0M", 3.4e9 → "3.40B", 5e12 → "5.00T"
const UNITS = [[1e12, 'T', 2], [1e9, 'B', 2], [1e6, 'M', 1], [1e3, 'K', 1]]
export const compact = (n) => {
  const a = Math.abs(n)
  for (const [v, u, d] of UNITS) if (a >= v) return (n / v).toFixed(d) + u
  return String(Math.round(n))
}
