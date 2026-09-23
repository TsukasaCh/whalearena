import { MARKETS, INITIAL_BALANCE } from './constants.js'
import { Market, depthFor, qtyFromMargin, liquidationPrice, unrealizedPnl } from './market.js'

export { depthFor }

const round = (n) => Math.round(n * 100) / 100
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// The MarketHub owns the shared wallet (balance + lifetime stats + merged trade
// history) and one Market per tradable symbol. Positions and resting limit
// orders live per-symbol inside each Market's `books`, keyed by account id (lowercased username).
export class MarketHub {
  constructor() {
    this.users = new Map() // id -> { id, name, balance, trades, wins, realized, history }
    this.dirty = new Set() // user ids whose wallet changed and needs persisting
    this.markets = new Map()
    for (const cfg of MARKETS) {
      this.markets.set(cfg.symbol, new Market(cfg, (uid, s) => this.settle(uid, s)))
    }
  }

  market(symbol) { return this.markets.get(symbol) }
  symbols() { return [...this.markets.keys()] }
  hasSymbol(symbol) { return this.markets.has(symbol) }

  // Market → wallet settlement callback (a position closed / was liquidated).
  settle(uid, { credit, pnl, record }) {
    const u = this.users.get(uid)
    if (!u) return
    u.balance = round(u.balance + credit)
    u.trades += 1
    if (pnl > 0) u.wins += 1
    u.realized = round(u.realized + pnl)
    u.history = [record, ...u.history].slice(0, 40)
    this.dirty.add(uid)
  }

  // `id` is the account's stable key (lowercased username), NOT a connection id:
  // positions and resting limit orders belong to the account and stay live in the
  // markets after the browser closes — fills, SL/TP and liquidation keep running.
  addUser(id, name, account) {
    const existing = this.users.get(id)
    if (existing) return existing // already live (other tab / reconnect) — memory is authoritative
    const a = account || {}
    const u = {
      id, name,
      balance: round(a.balance ?? INITIAL_BALANCE),
      trades: a.trades || 0,
      wins: a.wins || 0,
      realized: a.realized || 0,
      history: Array.isArray(a.history) ? a.history : [],
    }
    this.users.set(id, u)
    // restore persisted positions / resting orders into their markets
    for (const [sym, b] of Object.entries(a.books || {})) {
      const m = this.markets.get(sym)
      if (!m || !b) continue
      const pendingOrders = Array.isArray(b.pendingOrders) ? b.pendingOrders : []
      if (!b.position && !pendingOrders.length) continue
      m.books.set(id, { position: b.position || null, pendingOrders })
    }
    return u
  }

  // what gets written to the DB: wallet + every open book + recent history
  persistState(id) {
    const u = this.users.get(id)
    if (!u) return null
    return { balance: u.balance, trades: u.trades, wins: u.wins, realized: u.realized, books: this.userBooks(id), history: u.history }
  }

  userBooks(id) {
    const books = {}
    for (const [sym, m] of this.markets) {
      const book = m.books.get(id)
      if (!book) continue
      if (book.position || (book.pendingOrders && book.pendingOrders.length)) {
        books[sym] = { position: book.position || null, pendingOrders: book.pendingOrders || [] }
      }
    }
    return books
  }

  // users holding anything live in any market (for periodic persistence)
  activeUserIds() {
    const ids = new Set()
    for (const m of this.markets.values()) for (const uid of m.books.keys()) ids.add(uid)
    return ids
  }

  getUser(id) { return this.users.get(id) }

  // total account equity = free balance + margin + unrealized across ALL markets
  userEquity(id) {
    const u = this.users.get(id)
    if (!u) return 0
    let eq = u.balance
    for (const m of this.markets.values()) {
      const book = m.books.get(id)
      if (book && book.position) eq += book.position.margin + unrealizedPnl(book.position.side, book.position.entry, m.price, book.position.qty)
    }
    return round(eq)
  }
  userUnrealized(id) {
    let pnl = 0
    for (const m of this.markets.values()) {
      const book = m.books.get(id)
      if (book && book.position) pnl += unrealizedPnl(book.position.side, book.position.entry, m.price, book.position.qty)
    }
    return round(pnl)
  }

  // Complete user snapshot for the `me` message: wallet + every open book.
  userState(id) {
    const u = this.users.get(id)
    if (!u) return null
    const books = this.userBooks(id)
    return {
      balance: u.balance,
      stats: { trades: u.trades, wins: u.wins, realized: u.realized },
      history: u.history,
      equity: this.userEquity(id),
      unrealized: this.userUnrealized(id),
      books,
    }
  }

  // ── order actions (symbol-scoped) ─────────────────────────────────────────
  openPosition(id, symbol, { side, leverage, margin, sl, tp }) {
    const u = this.users.get(id)
    const m = this.markets.get(symbol)
    if (!u || !m) return { ok: false, error: 'No session' }
    leverage = clamp(Math.round(+leverage || 1), 1, 100)
    margin = +margin
    if (!margin || margin <= 0) return { ok: false, error: 'Invalid margin' }
    if (margin > u.balance) return { ok: false, error: 'Insufficient balance' }
    if (!['long', 'short'].includes(side)) return { ok: false, error: 'Bad side' }
    // validate BEFORE walking: the walk fills other users' limit orders
    const cur = m.books.get(id)
    if (cur?.position && cur.position.side !== side) return { ok: false, error: 'Tutup posisi dulu untuk balik arah' }
    if (cur?.pendingOrders.some((o) => o.side !== side)) return { ok: false, error: 'Cancel limit order sisi sebaliknya dulu' }
    const book = m.book(id)
    // market taker WALKS the book: entry is the size-weighted fill across the
    // resting levels it consumes — other users' limit orders at their price, then
    // bot liquidity (natural slippage), worse than mid
    const qtyMid = qtyFromMargin(margin, leverage, m.price)
    const { price: entry, userQty } = m.walkBook(side, qtyMid, id)
    const addQty = qtyFromMargin(margin, leverage, entry)
    // only the part that hit bot liquidity pushes price; user makers absorbed the rest
    const flow = Math.max(0, addQty - userQty)
    if (book.position) {
      m.dcaInto(book.position, addQty, entry, margin)
      u.balance = round(u.balance - margin)
      m.pendingFlow += side === 'long' ? flow : -flow
      this.dirty.add(id)
      return { ok: true, user: u, symbol, added: true }
    }
    const liq = m.r(liquidationPrice(side, entry, leverage))
    let cleanSl = sl ? +sl : null
    let cleanTp = tp ? +tp : null
    if (side === 'long') {
      if (cleanSl && cleanSl >= entry) cleanSl = null
      if (cleanTp && cleanTp <= entry) cleanTp = null
    } else {
      if (cleanSl && cleanSl <= entry) cleanSl = null
      if (cleanTp && cleanTp >= entry) cleanTp = null
    }
    book.position = { side, entry: m.r(entry), leverage, margin, qty: m.rq(addQty), sl: cleanSl, tp: cleanTp, liq, openedAt: Date.now() }
    u.balance = round(u.balance - margin)
    m.pendingFlow += side === 'long' ? flow : -flow
    this.dirty.add(id)
    return { ok: true, user: u, symbol }
  }

  closePosition(id, symbol) {
    const u = this.users.get(id)
    const m = this.markets.get(symbol)
    if (!u || !m) return { ok: false }
    const book = m.books.get(id)
    if (!book || !book.position) return { ok: false }
    const pos = book.position
    // closing is a market order in the OPPOSITE direction — it walks the book too
    const { price: exit, userQty } = m.walkBook(pos.side === 'long' ? 'short' : 'long', pos.qty, id)
    const pnl = unrealizedPnl(pos.side, pos.entry, exit, pos.qty)
    u.balance = round(u.balance + pos.margin + pnl)
    const flow = Math.max(0, pos.qty - userQty)
    m.pendingFlow += pos.side === 'long' ? -flow : flow
    u.trades += 1
    if (pnl > 0) u.wins += 1
    u.realized = round(u.realized + pnl)
    u.history = [{ symbol, side: pos.side, leverage: pos.leverage, entry: pos.entry, exit: m.r(exit), qty: pos.qty, margin: pos.margin, pnl: round(pnl), reason: 'manual', closedAt: Date.now() }, ...u.history].slice(0, 40)
    book.position = null
    m.dropIfEmpty(id)
    this.dirty.add(id)
    return { ok: true, user: u, symbol, event: { type: 'closed', symbol, pnl: round(pnl), price: m.r(exit), id: Date.now() } }
  }

  placeLimit(id, symbol, { side, leverage, margin, price, sl, tp }) {
    const u = this.users.get(id)
    const m = this.markets.get(symbol)
    if (!u || !m) return { ok: false, error: 'No session' }
    const book = m.book(id)
    const committed = book.position ? book.position.side : (book.pendingOrders[0] ? book.pendingOrders[0].side : null)
    if (committed && committed !== side) return { ok: false, error: 'Semua order harus sisi yang sama — cancel/tutup dulu untuk balik arah' }
    leverage = clamp(Math.round(+leverage || 1), 1, 100)
    margin = +margin
    price = +price
    if (!margin || margin <= 0) return { ok: false, error: 'Invalid margin' }
    if (margin > u.balance) return { ok: false, error: 'Insufficient balance' }
    if (!['long', 'short'].includes(side)) return { ok: false, error: 'Bad side' }
    if (!price || price <= 0) return { ok: false, error: 'Invalid price' }
    if (side === 'long' && price >= m.price) return { ok: false, error: 'Limit buy must be BELOW market' }
    if (side === 'short' && price <= m.price) return { ok: false, error: 'Limit sell must be ABOVE market' }
    let cleanSl = sl ? +sl : null
    let cleanTp = tp ? +tp : null
    if (side === 'long') {
      if (cleanSl && cleanSl >= price) cleanSl = null
      if (cleanTp && cleanTp <= price) cleanTp = null
    } else {
      if (cleanSl && cleanSl <= price) cleanSl = null
      if (cleanTp && cleanTp >= price) cleanTp = null
    }
    u.balance = round(u.balance - margin)
    const oid = 'o' + Math.random().toString(36).slice(2, 9)
    book.pendingOrders.push({ id: oid, side, leverage, margin, price: m.r(price), sl: cleanSl, tp: cleanTp, qty: m.rq(qtyFromMargin(margin, leverage, price)), filled: 0 })
    this.dirty.add(id)
    return { ok: true, user: u, symbol }
  }

  cancelLimit(id, symbol, orderId) {
    const u = this.users.get(id)
    const m = this.markets.get(symbol)
    if (!u || !m) return { ok: false }
    const book = m.books.get(id)
    if (!book || !book.pendingOrders.length) return { ok: false }
    const keep = []
    let refunded = 0
    for (const o of book.pendingOrders) {
      if (orderId && o.id !== orderId) { keep.push(o); continue }
      refunded += o.margin * Math.max(0, o.qty - o.filled) / (o.qty || 1)
    }
    if (keep.length === book.pendingOrders.length) return { ok: false }
    u.balance = round(u.balance + refunded)
    book.pendingOrders = keep
    m.dropIfEmpty(id)
    this.dirty.add(id)
    return { ok: true, user: u, symbol }
  }

  moveLimit(id, symbol, orderId, price) {
    const m = this.markets.get(symbol)
    const u = this.users.get(id)
    if (!m || !u) return { ok: false }
    const book = m.books.get(id)
    if (!book) return { ok: false }
    const o = book.pendingOrders.find((x) => x.id === orderId)
    if (!o) return { ok: false }
    if (o.filled > 1e-9) return { ok: false, error: 'Order sudah kefill sebagian — tidak bisa digeser' }
    price = m.r(+price)
    if (!price || price <= 0) return { ok: false }
    if (o.side === 'long' && price >= m.price) return { ok: false, error: 'Limit buy harus di bawah market' }
    if (o.side === 'short' && price <= m.price) return { ok: false, error: 'Limit sell harus di atas market' }
    o.price = price
    o.qty = m.rq(qtyFromMargin(o.margin, o.leverage, price))
    this.dirty.add(id)
    return { ok: true, user: u, symbol }
  }

  modify(id, symbol, { sl, tp, trailPct }) {
    const m = this.markets.get(symbol)
    if (!m) return { ok: false }
    const book = m.books.get(id)
    if (!book || !book.position) return { ok: false }
    const pos = book.position
    if (sl !== undefined) {
      let s = sl ? +sl : null
      if (s && ((pos.side === 'long' && s >= m.price) || (pos.side === 'short' && s <= m.price))) s = null
      pos.sl = s ? m.r(s) : null
    }
    if (tp !== undefined) {
      let t = tp ? +tp : null
      if (t && ((pos.side === 'long' && t <= m.price) || (pos.side === 'short' && t >= m.price))) t = null
      pos.tp = t ? m.r(t) : null
    }
    if (trailPct !== undefined) {
      const p = +trailPct
      if (p && p > 0) {
        pos.trail = { pct: clamp(p, 0.05, 20) / 100, anchor: m.price }
        pos.trailLevel = m.r(pos.side === 'long' ? m.price * (1 - pos.trail.pct) : m.price * (1 + pos.trail.pct))
      } else {
        pos.trail = null
        pos.trailLevel = null
      }
    }
    this.dirty.add(id)
    return { ok: true, user: this.users.get(id), symbol }
  }

  mm(symbol, cmd, payload = {}) {
    const m = this.markets.get(symbol)
    if (!m) return
    // a reset wipes every book in this market — make sure the DB forgets them too
    if (cmd === 'reset') for (const uid of m.books.keys()) this.dirty.add(uid)
    m.mm(cmd, payload)
  }

  // ── per-tick advance of every market ──────────────────────────────────────
  tick() {
    const deltas = []
    for (const m of this.markets.values()) deltas.push(m.step())
    return deltas
  }

  // ── read helpers ──────────────────────────────────────────────────────────
  snapshot(symbol) { const m = this.markets.get(symbol); return m ? m.snapshot() : null }
  crowd(symbol) { const m = this.markets.get(symbol); return m ? m.crowd() : null }
  restingOrders(symbol) { const m = this.markets.get(symbol); return m ? m.restingOrders() : [] }
  bookSnapshot(symbol) { const m = this.markets.get(symbol); return m ? m.bookSnapshot() : null }
  mapData(symbol) { const m = this.markets.get(symbol); return m ? m.mapData() : [] }

  tickers() {
    const out = []
    for (const m of this.markets.values()) out.push(m.ticker())
    return out
  }
  // lightweight price-only ticks for the live markets list (all symbols)
  priceTicks() {
    const out = []
    for (const m of this.markets.values()) out.push({ symbol: m.symbol, price: m.r(m.price), change: Math.round(m.change24h() * 100) / 100 })
    return out
  }

  // top bots across all markets, for the global leaderboard
  botEntries(limit = 40) {
    const all = []
    for (const m of this.markets.values()) all.push(...m.botEntries())
    all.sort((a, b) => b.equity - a.equity)
    return all.slice(0, limit).map((b) => ({ name: b.name, symbol: b.symbol, equity: round(b.equity), pnl: round(b.pnl), roe: round(b.roe), side: b.side, lev: b.lev, bot: true }))
  }
}
