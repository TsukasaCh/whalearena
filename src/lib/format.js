export const fmt = (n, d = 2) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

// Price formatter honoring a market's display precision (BTC→2, DOGE→6, PEPE→10).
export const fmtPrice = (n, dp = 2) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

// Compact coin quantity: show enough significant figures for cheap coins.
export const fmtQty = (n) => {
  const a = Math.abs(n)
  const d = a >= 1000 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : 2
  return a >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : fmt(n, d)
}

export const usd = (n, d = 2) => (n < 0 ? '-$' : '$') + fmt(Math.abs(n), d)

export const signedUsd = (n, d = 2) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n), d)

export const pct = (n, d = 2) => (n >= 0 ? '+' : '') + fmt(n, d) + '%'

export const compact = (n) =>
  Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n))
