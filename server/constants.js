// Shared engine constants (server side). The client mirrors TF/VIEW/BASE_PERIOD
// for local candle aggregation.
export const BASE_PERIOD = 60 // seconds per base (1m) bar — candles bucket by REAL wall-clock time
export const BASE_VOL = 0.0003 // per-tick (250ms) volatility for the live market
export const HIST_VOL = 0.0016 // per-substep volatility used when seeding history
export const TF = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 }
export const VIEW = 60
// live 1m base kept in memory / streamed per symbol (~10 days). Deep older history
// is served as coarse hourly bars (see HIST_DAYS) so 3 months stay lightweight.
export const BASE_CAP = TF['4h'] * VIEW
export const TICK_MS = 250

// Deep history: ~3 months of hourly bars per symbol, generated once at boot and
// stitched onto the live 1m base so 1h/4h/1d charts scroll back a full quarter.
export const HIST_DAYS = 92
export const HIST_HOURS = HIST_DAYS * 24

export const INITIAL_BALANCE = 10000
export const MMR = 0.005

// Trading fees on notional (Binance-style): market orders + SL/TP/trailing
// closes pay TAKER, resting limit fills pay MAKER. Liquidations pay none.
// (Mirrored in src/lib/trading.js — keep in sync.)
export const TAKER_FEE = 0.0005 // 0.05%
export const MAKER_FEE = 0.0002 // 0.02%

// Funding settles every hour on the hour (UTC). Rate follows the long/short OI
// imbalance: positive → longs pay shorts, negative → shorts pay longs. Zero-sum
// between real users (see Market.applyFunding); it is taken from / added to the
// position's isolated margin, so liq price moves. The settlement minute also
// gets a candle in the funding direction sized by the funding volume.
export const FUNDING_INTERVAL = 3600 // seconds
export const FUNDING_BASE = 0.0000125 // 0.01% per 8h, spread hourly
export const FUNDING_K = 0.0004 // rate per unit of (long-short)/(long+short) imbalance
export const FUNDING_CAP = 0.0005 // ±0.05% per hour
// share of the matched funding notional that turns into order flow at settlement
// (at the rate cap); scales down linearly with |rate|
export const FUNDING_FLOW = 0.5

// Reference price the order-flow model is tuned around (BTC-scale). Depth and
// the ambient/drift/nudge flows scale by (DEPTH_REF / price) so a $0.13 DOGE and
// a $64k BTC show sane order-book sizes and move by comparable PERCENTAGES.
// (Mirrored in src/components/OrderBook.jsx — keep in sync.)
export const DEPTH_REF = 60000

export const BOT_TARGET = 95
export const BOT_MAX = 140
export const INITIAL_BOTS = 85

// ── Spot vs Futures venues ────────────────────────────────────────────────────
// Every symbol runs TWO independent markets: a futures (perp) book and a spot
// book, each with its own price, order book, candle history and liquidity. They
// are tethered by an arbitrage pull each tick (see MarketHub.couple): the price
// gap (basis) is closed a little every tick, and the THINNER book moves more —
// so a short squeeze on deep futures drags a thin spot market up hard behind it.
export const SPOT_DEPTH_SCALE = 0.4 // spot books are thinner than futures
export const BASIS_PULL = 0.06 // per-tick fraction of the spot/perp gap arbitraged away

// ── Staking ───────────────────────────────────────────────────────────────────
// Move spot coins into a staking pocket to earn yield; move them back to spot to
// trade. Rewards accrue continuously (compounded) at this annual rate and are
// paid in the same coin, so the staked balance slowly grows on its own.
export const STAKE_APY = 0.07 // 7% annual
export const YEAR_MS = 365 * 24 * 60 * 60 * 1000

// ── Price band ───────────────────────────────────────────────────────────────
// Every market has a slow "fair value" anchor. The live price is pulled back
// toward it and hard-capped to a band around it, and the anchor itself drifts
// after the price but may not leave a range around the market's seed price. That
// keeps the big coins from running away — and it is also what stops a coin from
// going on a real run. A market can override any of these with its own `band`.
export const DEFAULT_BAND = {
  price: [0.5, 2], // hard cap on price, as multiples of the anchor
  anchor: [0.4, 2.4], // range the anchor may reach, as multiples of the seed price
  follow: 0.0003, // per-tick share of the price/anchor gap the anchor closes (higher = moves stick)
  pull: 0.0006, // per-tick share of that gap the price is pulled back (higher = moves fade faster)
}

// ── Tradable markets ────────────────────────────────────────────────────────
// Each market runs its own price sim, order book, bots and history. `price` is
// the seed spot; `vol` scales that market's live/hist volatility (alts chop more
// than BTC); `dp` is the price display precision; `base` is the coin ticker;
// `supply` is the circulating coin supply (market cap = spot price × supply);
// `total` is the total / max supply where the coin has one (FDV = price × total).
export const MARKETS = [
  { symbol: 'BTC', name: 'Bitcoin',   base: 'BTC',  price: 64000,   vol: 1.0, dp: 2, supply: 19.7e6, total: 21e6 },
  { symbol: 'ETH', name: 'Ethereum',  base: 'ETH',  price: 3200,    vol: 1.15, dp: 2, supply: 120.2e6 },
  { symbol: 'SOL', name: 'Solana',    base: 'SOL',  price: 165,     vol: 1.5, dp: 3, supply: 465e6 },
  { symbol: 'BNB', name: 'BNB',       base: 'BNB',  price: 590,     vol: 1.1, dp: 2, supply: 147.6e6 },
  { symbol: 'XRP', name: 'XRP',       base: 'XRP',  price: 0.58,    vol: 1.4, dp: 5, supply: 56e9, total: 100e9 },
  { symbol: 'DOGE', name: 'Dogecoin', base: 'DOGE', price: 0.135,   vol: 1.8, dp: 6, supply: 145e9 },
  { symbol: 'ADA', name: 'Cardano',   base: 'ADA',  price: 0.44,    vol: 1.5, dp: 5, supply: 35.6e9, total: 45e9 },
  { symbol: 'AVAX', name: 'Avalanche',base: 'AVAX', price: 27.5,    vol: 1.6, dp: 4, supply: 395e6, total: 720e6 },
  { symbol: 'LINK', name: 'Chainlink',base: 'LINK', price: 14.2,    vol: 1.5, dp: 4, supply: 587e6, total: 1e9 },
  { symbol: 'TRX', name: 'TRON',      base: 'TRX',  price: 0.145,   vol: 1.2, dp: 6, supply: 87e9 },
  { symbol: 'TON', name: 'Toncoin',   base: 'TON',  price: 5.4,     vol: 1.5, dp: 4, supply: 2.5e9 },
  { symbol: 'PEPE', name: 'Pepe',     base: 'PEPE', price: 0.0000092, vol: 2.2, dp: 10, supply: 420.69e12, total: 420.69e12 },
  // RCLD is the game's own coin: a free-floating band so buying pressure can take
  // it on a real run (up to 20× above / 20× below fair value at once, and fair
  // value itself re-anchors within about a minute instead of springing back).
  {
    symbol: 'RCLD', name: 'RCLD', base: 'RCLD', price: 0.5, vol: 2.0, dp: 5, supply: 200e6, total: 1e9,
    band: { price: [0.05, 20], anchor: [0.02, 5000], follow: 0.004, pull: 0.0001 },
  },
]
export const SYMBOLS = MARKETS.map((m) => m.symbol)
export const DEFAULT_SYMBOL = 'BTC'
export const marketFor = (symbol) => MARKETS.find((m) => m.symbol === symbol) || MARKETS[0]
