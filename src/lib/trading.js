// ---------------------------------------------------------------------------
// Core futures trading math (isolated margin, linear USDT-style contract).
// Simplified but directionally correct — good enough for an educational sim.
// ---------------------------------------------------------------------------

// Maintenance margin rate. Real exchanges use tiered MMR; we use a flat rate.
export const MMR = 0.005 // 0.5%

// Trading fees on notional — mirror of server/constants.js (keep in sync).
export const TAKER_FEE = 0.0005 // 0.05% · market orders, SL/TP/trailing closes
export const MAKER_FEE = 0.0002 // 0.02% · resting limit fills

/** Contracts / coin quantity controlled by a position. */
export function qtyFromMargin(margin, leverage, entry) {
  if (!entry) return 0
  return (margin * leverage) / entry
}

/** Notional (position) value = the full exposure the leverage buys. */
export function notional(margin, leverage) {
  return margin * leverage
}

/**
 * Liquidation price for an isolated position.
 *
 * Derivation (long):
 *   equity = margin + qty * (P - entry)
 *   liquidation happens when equity == maintenanceMargin = mmr * notional
 *   => P = entry * (1 - 1/leverage + mmr)
 *
 * Short is the mirror image:
 *   => P = entry * (1 + 1/leverage - mmr)
 */
export function liquidationPrice({ side, entry, leverage, mmr = MMR }) {
  if (side === 'long') return entry * (1 - 1 / leverage + mmr)
  return entry * (1 + 1 / leverage - mmr)
}

/** Unrealized PnL in quote currency (USD). */
export function unrealizedPnl({ side, entry, price, qty }) {
  const diff = side === 'long' ? price - entry : entry - price
  return diff * qty
}

/** Return on equity (%) — PnL relative to the margin you put up. */
export function roe(pnl, margin) {
  return margin ? (pnl / margin) * 100 : 0
}

/** Distance from mark price to liquidation, as a fraction (0..1). */
export function distanceToLiq(price, liq) {
  if (!price) return 1
  return Math.abs(price - liq) / price
}
