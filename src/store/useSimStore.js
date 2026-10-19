import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { currentCandle } from '../lib/candles'

// Client-side mirror of the server-authoritative markets. The MarketHub runs on
// the server; this store applies snapshots/deltas for the ACTIVE symbol, keeps a
// light ticker for every market, and holds the user's wallet + per-symbol books.

export const BASE_PERIOD = 60 // must match server
export const TF = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 }
export const TIMEFRAMES = Object.keys(TF)
export const VIEW = 60
export const STAKE_APY = 0.07 // must match server
export const STAKE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
// live accrued staked qty from a stored { qty, since } (compounds at STAKE_APY)
export const accruedStake = (s, now = Date.now()) =>
  s && s.qty > 0 ? s.qty * Math.pow(1 + STAKE_APY, (now - (s.since || now)) / STAKE_YEAR_MS) : 0
const round = (n) => Math.round(n * 100) / 100

const emptyCrowd = { traders: 0, realTraders: 0, longOI: 0, shortOI: 0, harvested: 0, liquidatedTotal: 0, autoHunt: false }

// pull the active symbol's position / pending orders out of the books map
const bookOf = (books, symbol) => books?.[symbol] || { position: null, pendingOrders: [] }
// resting SPOT limit orders live in the spot venue's book (keyed `${symbol}:spot`)
const spotBookOf = (books, symbol) => books?.[symbol + ':spot']?.pendingOrders || []

export const useSim = create(
  subscribeWithSelector((set, get) => ({
    connected: false,
    timeframe: '1m',

    // active market
    symbol: 'BTC',
    mode: 'perp', // which venue is shown: 'perp' (futures) | 'spot'
    dp: 2,
    baseAsset: 'BTC',
    price: 0,
    base: [],
    deep: [],
    baseCurrent: null,
    disp: null,
    epoch: 0,
    lastLiqEvent: null,

    // every market (ticker list for the home + top bar selector)
    symbols: [], // [{ symbol, name, base, dp, price, change, spark }]

    // trader wallet (global) + per-symbol books
    balance: 0,
    stats: { trades: 0, wins: 0, realized: 0 },
    history: [], // merged recent closed trades across all symbols
    books: {}, // { [symbol]: { position, pendingOrders } }
    spot: {}, // spot holdings { [symbol]: { qty, cost } }
    staked: {}, // staking pocket { [symbol]: { qty, cost, since, earned } }
    equity: 0,
    unrealized: 0,
    // mirrors of the ACTIVE symbol's book (kept so existing components work)
    position: null,
    pendingOrders: [],
    spotPending: [], // resting spot limit orders for the active symbol
    leaderboard: [],
    toast: null,

    // crowd / MM (active symbol)
    crowd: emptyCrowd,
    map: [],
    resting: [], // real user resting limit orders [{ p, s, q }]
    book: { tick: 0, asks: [], bids: [] }, // live bot order book (server-authoritative)

    orderDraft: { leverage: 20, margin: 500 },
    spotDraft: { spend: 500, qty: 0 }, // default size for chart-placed spot limits
    _send: null,

    setConnected: (connected) => set({ connected }),
    setSender: (fn) => set({ _send: fn }),

    // ---- inbound ----
    _applyMarketSnap: (m) => {
      const base = m.base || []
      const baseCurrent = m.baseCurrent || null
      set({
        symbol: m.symbol ?? get().symbol,
        mode: m.mode ?? get().mode,
        dp: m.dp ?? get().dp,
        baseAsset: m.baseAsset ?? get().baseAsset,
        base,
        deep: m.deep || [],
        baseCurrent,
        price: m.price ?? get().price,
        crowd: m.crowd || get().crowd,
        resting: m.resting ?? [],
        book: m.book || { tick: 0, asks: [], bids: [] },
        disp: baseCurrent ? currentCandle(base, baseCurrent, TF[get().timeframe], BASE_PERIOD) : null,
        epoch: get().epoch + 1,
      })
    },

    applyWelcome: (m) => {
      if (m.tickers) set({ symbols: m.tickers })
      get()._applyMarketSnap(m)
      if (m.me) get().applyMe(m.me)
      if (m.map) set({ map: m.map })
      if (m.lb) set({ leaderboard: m.lb })
    },

    applySnap: (m) => {
      // re-mirror the active book for the (possibly new) symbol
      const b = bookOf(get().books, m.symbol)
      set({ position: b.position, pendingOrders: b.pendingOrders, spotPending: spotBookOf(get().books, m.symbol) })
      get()._applyMarketSnap(m)
    },

    applyMarket: (m) => {
      const st = get()
      if ((m.s && m.s !== st.symbol) || (m.md && m.md !== st.mode)) return // stale stream from a previous venue
      let base = st.base
      const CAP = TF['4h'] * VIEW
      if (m.f) base = base.length >= CAP ? [...base.slice(-(CAP - 1)), m.f] : [...base, m.f]
      const baseCurrent = m.bc
      const disp = currentCandle(base, baseCurrent, TF[st.timeframe], BASE_PERIOD)
      const patch = { price: m.p, base, baseCurrent, disp }
      if (m.liq) patch.lastLiqEvent = { ...m.liq, time: disp.time }
      const pos = st.position
      if (pos && pos.trail) {
        let anchor = pos.trail.anchor
        let level
        if (pos.side === 'long') { if (m.p > anchor) anchor = m.p; level = round(anchor * (1 - pos.trail.pct)) }
        else { if (m.p < anchor) anchor = m.p; level = round(anchor * (1 + pos.trail.pct)) }
        patch.position = { ...pos, trail: { ...pos.trail, anchor }, trailLevel: level }
      }
      // keep the active symbol's ticker price in step — but the markets list is
      // the FUTURES headline price, so only sync it from the perp stream
      if (st.mode === 'perp') patch.symbols = st.symbols.map((s) => (s.symbol === st.symbol ? { ...s, price: m.p } : s))
      set(patch)
    },

    applyTicks: (ticks) => {
      const bySym = new Map(ticks.map((t) => [t.symbol, t]))
      set({ symbols: get().symbols.map((s) => { const t = bySym.get(s.symbol); return t ? { ...s, price: t.price, change: t.change, spot: t.spot ?? s.spot } : s }) })
    },
    applyTickers: (tickers) => {
      // merge (keep live price if a fresher tick already arrived is fine — these carry price too)
      set({ symbols: tickers })
    },

    applyCrowd: (m) => {
      if ((m.s && m.s !== get().symbol) || (m.md && m.md !== get().mode)) return
      const patch = { crowd: m.crowd }
      if (m.resting) patch.resting = m.resting
      if (m.book) patch.book = m.book
      set(patch)
    },
    applyMap: (m) => { if ((!m.s || m.s === get().symbol) && (!m.md || m.md === get().mode)) set({ map: m.map }) },
    applyLeaderboard: (leaderboard) => set({ leaderboard }),

    applyMe: (m) => {
      const books = m.books || {}
      const b = bookOf(books, get().symbol)
      const patch = {
        balance: m.balance,
        stats: m.stats || get().stats,
        history: m.history || get().history,
        books,
        spot: m.spot || {},
        staked: m.staked || {},
        equity: m.equity ?? get().equity,
        unrealized: m.unrealized ?? get().unrealized,
        position: b.position,
        pendingOrders: b.pendingOrders,
        spotPending: spotBookOf(books, get().symbol),
      }
      if (m.event) patch.toast = m.event
      set(patch)
    },

    setOrderError: (error) => set({ toast: { type: 'error', msg: error, id: Date.now() } }),
    setNotice: (msg) => set({ toast: { type: 'notice', msg, id: Date.now() } }),
    dismissToast: () => set({ toast: null }),
    setOrderDraft: (patch) => set((s) => ({ orderDraft: { ...s.orderDraft, ...patch } })),

    // ---- switch active market ----
    setSymbol: (symbol) => {
      const st = get()
      if (symbol === st.symbol || !st.symbols.find((s) => s.symbol === symbol)) return
      const meta = st.symbols.find((s) => s.symbol === symbol)
      const b = bookOf(st.books, symbol)
      set({
        symbol,
        dp: meta?.dp ?? st.dp,
        baseAsset: meta?.base ?? symbol,
        price: meta?.price ?? 0,
        base: [], deep: [], baseCurrent: null, disp: null,
        resting: [], crowd: emptyCrowd, map: [], book: { tick: 0, asks: [], bids: [] },
        lastLiqEvent: null,
        position: b.position, pendingOrders: b.pendingOrders,
        spotPending: spotBookOf(st.books, symbol),
      })
      const send = st._send
      if (send) send({ type: 'sub', symbol, mode: st.mode })
    },

    // ---- switch venue (Spot ↔ Futures) for the same symbol ----
    setMode: (mode) => {
      const st = get()
      if (mode !== 'spot' && mode !== 'perp') return
      if (mode === st.mode) return
      set({
        mode,
        base: [], deep: [], baseCurrent: null, disp: null,
        resting: [], crowd: emptyCrowd, map: [], book: { tick: 0, asks: [], bids: [] },
        lastLiqEvent: null,
      })
      const send = st._send
      if (send) send({ type: 'sub', symbol: st.symbol, mode })
    },

    // ---- outbound (active symbol) ----
    openPosition: (params) => { const s = get(); s._send && s._send({ type: 'open', symbol: s.symbol, ...params }) },
    closePosition: () => { const s = get(); s._send && s._send({ type: 'close', symbol: s.symbol }) },
    spotBuy: (quote) => { const s = get(); s._send && s._send({ type: 'spotBuy', symbol: s.symbol, quote }) },
    spotSell: (qty) => { const s = get(); s._send && s._send({ type: 'spotSell', symbol: s.symbol, qty }) },
    spotLimit: ({ side, price, spend, qty }) => { const s = get(); s._send && s._send({ type: 'spotLimit', symbol: s.symbol, side, price, spend, qty }) },
    spotCancelLimit: (id) => { const s = get(); s._send && s._send({ type: 'spotCancelLimit', symbol: s.symbol, id }) },
    spotMoveLimit: (id, price) => { const s = get(); s._send && s._send({ type: 'spotMoveLimit', symbol: s.symbol, id, price }) },
    stake: (qty) => { const s = get(); s._send && s._send({ type: 'stake', symbol: s.symbol, qty }) },
    unstake: (qty) => { const s = get(); s._send && s._send({ type: 'unstake', symbol: s.symbol, qty }) },
    setSpotDraft: (patch) => set((s) => ({ spotDraft: { ...s.spotDraft, ...patch } })),
    modifyPosition: (payload) => { const s = get(); s._send && s._send({ type: 'modify', symbol: s.symbol, ...payload }) },
    placeLimit: (payload) => { const s = get(); s._send && s._send({ type: 'limit', symbol: s.symbol, ...payload }) },
    cancelLimit: (id) => { const s = get(); s._send && s._send({ type: 'cancelLimit', symbol: s.symbol, id }) },
    moveLimit: (id, price) => { const s = get(); s._send && s._send({ type: 'moveLimit', symbol: s.symbol, id, price }) },
    mm: (cmd, payload) => { const s = get(); s._send && s._send({ type: 'mm', symbol: s.symbol, cmd, payload }) },
    adminFund: (name, amount, fundMode) => { const s = get(); s._send && s._send({ type: 'adminFund', name, amount, fundMode }) },

    // ---- derived: everything across all markets (for the OKX-style home) ----
    allPositions: () => {
      const { books, symbols } = get()
      const meta = new Map(symbols.map((s) => [s.symbol, s]))
      const out = []
      for (const [sym, b] of Object.entries(books)) {
        if (b.position) out.push({ symbol: sym, ...b.position, mark: meta.get(sym)?.price ?? b.position.entry, dp: meta.get(sym)?.dp ?? 2 })
      }
      return out
    },
    allPending: () => {
      const { books, symbols } = get()
      const meta = new Map(symbols.map((s) => [s.symbol, s]))
      const out = []
      for (const [sym, b] of Object.entries(books)) {
        for (const o of b.pendingOrders || []) out.push({ symbol: sym, ...o, dp: meta.get(sym)?.dp ?? 2 })
      }
      return out
    },
    allHoldings: () => {
      const { spot, symbols } = get()
      const meta = new Map(symbols.map((s) => [s.symbol, s]))
      const out = []
      for (const [sym, h] of Object.entries(spot || {})) {
        if (!h || h.qty <= 0) continue
        const mk = meta.get(sym) || {}
        const price = mk.price ?? 0
        out.push({ symbol: sym, qty: h.qty, cost: h.cost, avg: h.qty ? h.cost / h.qty : 0, value: h.qty * price, price, dp: mk.dp ?? 2, base: mk.base ?? sym })
      }
      return out
    },

    // ---- local UI ----
    setTimeframe: (tf) => {
      const st = get()
      if (!TF[tf] || tf === st.timeframe) return
      set({
        timeframe: tf,
        disp: st.baseCurrent ? currentCandle(st.base, st.baseCurrent, TF[tf], BASE_PERIOD) : null,
        epoch: st.epoch + 1,
      })
    },
  }))
)
