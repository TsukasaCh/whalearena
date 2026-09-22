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

// Reference price the order-flow model is tuned around (BTC-scale). Depth and
// the ambient/drift/nudge flows scale by (DEPTH_REF / price) so a $0.13 DOGE and
// a $64k BTC show sane order-book sizes and move by comparable PERCENTAGES.
// (Mirrored in src/components/OrderBook.jsx — keep in sync.)
export const DEPTH_REF = 60000

export const BOT_TARGET = 95
export const BOT_MAX = 140
export const INITIAL_BOTS = 85

// ── Tradable markets ────────────────────────────────────────────────────────
// Each market runs its own price sim, order book, bots and history. `price` is
// the seed spot; `vol` scales that market's live/hist volatility (alts chop more
// than BTC); `dp` is the price display precision; `base` is the coin ticker.
export const MARKETS = [
  { symbol: 'BTC', name: 'Bitcoin',   base: 'BTC',  price: 64000,   vol: 1.0, dp: 2 },
  { symbol: 'ETH', name: 'Ethereum',  base: 'ETH',  price: 3200,    vol: 1.15, dp: 2 },
  { symbol: 'SOL', name: 'Solana',    base: 'SOL',  price: 165,     vol: 1.5, dp: 3 },
  { symbol: 'BNB', name: 'BNB',       base: 'BNB',  price: 590,     vol: 1.1, dp: 2 },
  { symbol: 'XRP', name: 'XRP',       base: 'XRP',  price: 0.58,    vol: 1.4, dp: 5 },
  { symbol: 'DOGE', name: 'Dogecoin', base: 'DOGE', price: 0.135,   vol: 1.8, dp: 6 },
  { symbol: 'ADA', name: 'Cardano',   base: 'ADA',  price: 0.44,    vol: 1.5, dp: 5 },
  { symbol: 'AVAX', name: 'Avalanche',base: 'AVAX', price: 27.5,    vol: 1.6, dp: 4 },
  { symbol: 'LINK', name: 'Chainlink',base: 'LINK', price: 14.2,    vol: 1.5, dp: 4 },
  { symbol: 'TRX', name: 'TRON',      base: 'TRX',  price: 0.145,   vol: 1.2, dp: 6 },
  { symbol: 'TON', name: 'Toncoin',   base: 'TON',  price: 5.4,     vol: 1.5, dp: 4 },
  { symbol: 'PEPE', name: 'Pepe',     base: 'PEPE', price: 0.0000092, vol: 2.2, dp: 10 },
]
export const SYMBOLS = MARKETS.map((m) => m.symbol)
export const DEFAULT_SYMBOL = 'BTC'
export const marketFor = (symbol) => MARKETS.find((m) => m.symbol === symbol) || MARKETS[0]
