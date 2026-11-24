import { MARKETS, SYMBOLS, INITIAL_BALANCE, TAKER_FEE, MAKER_FEE, BASIS_PULL, STAKE_APY, YEAR_MS } from './constants.js'
import { Market, depthFor, qtyFromMargin, liquidationPrice, unrealizedPnl, closeOut } from './market.js'

export { depthFor }

const round = (n) => Math.round(n * 100) / 100
const r8 = (n) => Math.round(n * 1e8) / 1e8 // coin precision for staking (keep tiny rewards)
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
// Iceberg limit orders: `visible` is the fraction of the order shown on the book
// (the "tip"). Anything that is not a number strictly between 0 and 1 means a
// normal, fully visible limit order.
const icebergFrac = (visible) => {
  const v = +visible
  return v > 0 && v < 1 ? clamp(v, 0.01, 0.5) : undefined
}

// Algo (TWAP / VWAP) order limits
const ALGO_MIN_SEC = 30
const ALGO_MAX_SEC = 4 * 60 * 60
const ALGO_MAX_SLICES = 100
const ALGO_MIN_INTERVAL = 2 // seconds between child orders
const ALGO_MIN_SLICE = 1 // USDT margin per child order
const ALGO_MAX_ACTIVE = 3 // per user, per market

// Spot grid bot limits
const GRID_MIN = 2
const GRID_MAX = 50 // grid steps (so up to 50 resting orders)
const GRID_MAX_BOTS = 5 // per user (one per symbol)
const GRID_MIN_STEP = 0.002 // step / lower ≥ 0.2% so a round trip clears two maker fees
const GRID_MIN_ORDER = 1 // USDT value of one grid order

// Staking accrual: the staked balance compounds at STAKE_APY. accruedQty is the
// current balance (read-only); realize folds the rewards into the stake and
// resets the clock, tracking lifetime `earned` coins.
const accruedStakeQty = (s) => (s && s.qty > 0 ? s.qty * Math.pow(1 + STAKE_APY, (Date.now() - (s.since || Date.now())) / YEAR_MS) : (s ? s.qty || 0 : 0))
const realizeStake = (s) => {
  const nq = accruedStakeQty(s)
  s.earned = r8((s.earned || 0) + (nq - s.qty))
  s.qty = r8(nq)
  s.since = Date.now()
}

// The MarketHub owns the shared wallet (balance + lifetime stats + merged trade
// history) and one Market per tradable symbol. Positions and resting limit
// orders live per-symbol inside each Market's `books`, keyed by account id (lowercased username).
export class MarketHub {
  constructor() {
    this.users = new Map() // id -> { id, name, balance, trades, wins, realized, history, spot }
    this.dirty = new Set() // user ids whose wallet changed and needs persisting
    this.algoUpdates = [] // [{ userId, event? }] produced by the last tick's algo pass
    this.gridUpdates = [] // user ids whose grid bot re-armed orders in the last tick
    // Every symbol runs TWO venues: a futures (perp) market and a spot market,
    // each its own price/book/history. Keyed by vkey(symbol, mode) — the perp key
    // is just the symbol so old saved market rows restore as the futures book.
    this.markets = new Map()
    for (const cfg of MARKETS) {
      for (const kind of ['perp', 'spot']) {
        this.markets.set(this.vkey(cfg.symbol, kind), new Market(
          { ...cfg, kind },
          (uid, s) => this.settle(uid, s),
          (uid, fill) => this.spotFill(uid, fill),
        ))
      }
    }
  }

  vkey(symbol, mode) { return mode === 'spot' ? symbol + ':spot' : symbol }
  market(symbol, mode = 'perp') { return this.markets.get(this.vkey(symbol, mode)) }
  marketByKey(key) { return this.markets.get(key) }
  symbols() { return [...SYMBOLS] } // base symbols
  venueKeys() { return [...this.markets.keys()] }
  hasSymbol(symbol) { return this.markets.has(this.vkey(symbol, 'perp')) }

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
      // spot inventory: coins the user owns outright, keyed by symbol.
      // { [symbol]: { qty, cost } } — cost is the total USDT basis (incl. buy fees).
      spot: a.spot && typeof a.spot === 'object' ? a.spot : {},
      // staking pocket: { [symbol]: { qty, cost, since, earned } } earning STAKE_APY
      staked: a.staked && typeof a.staked === 'object' ? a.staked : {},
      // spot grid bots: [{ id, symbol, lower, upper, grids, invest, usdt, coins, … }]
      grids: Array.isArray(a.grids) ? a.grids : [],
    }
    this.users.set(id, u)
    // restore persisted positions / resting orders into their markets
    for (const [sym, b] of Object.entries(a.books || {})) {
      const m = this.markets.get(sym)
      if (!m || !b) continue
      const pendingOrders = Array.isArray(b.pendingOrders) ? b.pendingOrders : []
      const algos = Array.isArray(b.algos) ? b.algos : []
      if (!b.position && !pendingOrders.length && !algos.length) continue
      m.books.set(id, { position: b.position || null, pendingOrders, algos })
    }
    return u
  }

  // what gets written to the DB: wallet + every open book + recent history
  persistState(id) {
    const u = this.users.get(id)
    if (!u) return null
    return { balance: u.balance, trades: u.trades, wins: u.wins, realized: u.realized, books: this.userBooks(id), history: u.history, spot: u.spot, staked: u.staked, grids: u.grids || [] }
  }

  userBooks(id) {
    const books = {}
    for (const [sym, m] of this.markets) {
      const book = m.books.get(id)
      if (!book) continue
      if (book.position || (book.pendingOrders && book.pendingOrders.length) || (book.algos && book.algos.length)) {
        books[sym] = { position: book.position || null, pendingOrders: book.pendingOrders || [], algos: book.algos || [] }
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

  // Whale/admin power: credit (add) or set a loaded user's free balance. The
  // caller (index.js) is responsible for host auth and for loading an offline
  // account into the hub first. Balance floors at 0.
  fundUser(id, amount, mode = 'add') {
    const u = this.users.get(id)
    if (!u) return null
    u.balance = mode === 'set' ? round(Math.max(0, amount)) : round(Math.max(0, u.balance + amount))
    this.dirty.add(id)
    return u.balance
  }

  // total account equity = free balance + margin + unrealized across ALL perps
  // markets + the mark value of every spot holding
  userEquity(id) {
    const u = this.users.get(id)
    if (!u) return 0
    let eq = u.balance
    for (const m of this.markets.values()) {
      const book = m.books.get(id)
      if (book && book.position) eq += book.position.margin + unrealizedPnl(book.position.side, book.position.entry, m.price, book.position.qty)
    }
    return round(eq + this.userSpotValue(id) + this.userStakedValue(id) + this.userLockedValue(id))
  }

  // Value tied up in RESTING orders (so equity = total assets, unchanged when you
  // place/cancel a limit — the money just moves between available and locked):
  //  · perp limit → reserved margin + fee on the unfilled part
  //  · spot buy limit → reserved USDT on the unfilled part
  //  · spot sell limit → the coins it holds, marked at the spot price
  //  · TWAP/VWAP → the margin + fee still reserved for its unexecuted slices
  userLockedValue(id) {
    let v = 0
    for (const g of this.users.get(id)?.grids || []) {
      const gm = this.market(g.symbol, 'spot')
      v += (g.usdt || 0) + (g.coins || 0) * (gm ? gm.price : 0)
    }
    for (const m of this.markets.values()) {
      const book = m.books.get(id)
      if (!book) continue
      for (const a of book.algos || []) v += a.spot && a.side === 'sell' ? (a.remQty || 0) * m.price : a.reserved || 0
      for (const o of book.pendingOrders || []) {
        const rem = Math.max(0, o.qty - (o.filled || 0))
        if (rem <= 1e-12) continue
        const frac = rem / (o.qty || 1)
        if (o.spot) {
          if (o.side === 'long') v += (o.reservedUsd || 0) * frac
          else v += rem * m.price
        } else {
          v += ((o.margin || 0) + (o.fee || 0)) * frac
        }
      }
    }
    return round(v)
  }
  userUnrealized(id) {
    let pnl = 0
    for (const m of this.markets.values()) {
      const book = m.books.get(id)
      if (book && book.position) pnl += unrealizedPnl(book.position.side, book.position.entry, m.price, book.position.qty)
    }
    return round(pnl + this.userSpotUnrealized(id))
  }

  // mark value (USDT) of all spot coins held
  userSpotValue(id) {
    const u = this.users.get(id)
    if (!u) return 0
    let v = 0
    for (const [sym, h] of Object.entries(u.spot || {})) {
      const m = this.market(sym, 'spot')
      if (m && h && h.qty > 0) v += h.qty * m.price
    }
    return round(v)
  }
  // paper PnL on spot = current mark value - cost basis, summed across holdings
  userSpotUnrealized(id) {
    const u = this.users.get(id)
    if (!u) return 0
    let pnl = 0
    for (const [sym, h] of Object.entries(u.spot || {})) {
      const m = this.market(sym, 'spot')
      if (m && h && h.qty > 0) pnl += h.qty * m.price - h.cost
    }
    return round(pnl)
  }
  // mark value (USDT) of all staked coins (accrued to now), at the spot price
  userStakedValue(id) {
    const u = this.users.get(id)
    if (!u) return 0
    let v = 0
    for (const [sym, s] of Object.entries(u.staked || {})) {
      const m = this.market(sym, 'spot')
      if (m && s && s.qty > 0) v += accruedStakeQty(s) * m.price
    }
    return round(v)
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
      spot: u.spot,
      staked: u.staked,
      grids: (u.grids || []).map(({ flips, ...g }) => g),
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
    // taker fee is charged on notional, on top of the margin
    if (margin + margin * leverage * TAKER_FEE > u.balance) return { ok: false, error: 'Saldo tidak cukup (margin + fee taker)' }
    if (!['long', 'short'].includes(side)) return { ok: false, error: 'Bad side' }
    // validate BEFORE walking: the walk fills other users' limit orders
    const cur = m.books.get(id)
    if (cur?.position && cur.position.side !== side) return { ok: false, error: 'Tutup posisi dulu untuk balik arah' }
    if (cur?.pendingOrders.some((o) => o.side !== side)) return { ok: false, error: 'Cancel limit order sisi sebaliknya dulu' }
    if (cur?.algos?.some((a) => a.side !== side)) return { ok: false, error: 'Cancel TWAP/VWAP sisi sebaliknya dulu' }
    const book = m.book(id)
    // market taker WALKS the book: entry is the size-weighted fill across the
    // resting levels it consumes — other users' limit orders at their price, then
    // bot liquidity (natural slippage), worse than mid
    const qtyMid = qtyFromMargin(margin, leverage, m.price)
    const { price: entry, userQty } = m.walkBook(side, qtyMid, id)
    const addQty = qtyFromMargin(margin, leverage, entry)
    // only the part that hit bot liquidity pushes price; user makers absorbed the rest
    const flow = Math.max(0, addQty - userQty)
    const fee = entry * addQty * TAKER_FEE
    m.feesCollected += fee
    if (book.position) {
      m.dcaInto(book.position, addQty, entry, margin)
      book.position.fees = (book.position.fees || 0) + fee
      u.balance = round(u.balance - margin - fee)
      m.pendingFlow += side === 'long' ? flow : -flow
      this.dirty.add(id)
      return { ok: true, user: u, symbol, added: true, fill: { price: entry, qty: addQty } }
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
    book.position = { side, entry: m.r(entry), leverage, margin, deposit: margin, fees: fee, funding: 0, qty: m.rq(addQty), sl: cleanSl, tp: cleanTp, liq, openedAt: Date.now() }
    u.balance = round(u.balance - margin - fee)
    m.pendingFlow += side === 'long' ? flow : -flow
    this.dirty.add(id)
    return { ok: true, user: u, symbol, fill: { price: entry, qty: addQty } }
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
    const flow = Math.max(0, pos.qty - userQty)
    m.pendingFlow += pos.side === 'long' ? -flow : flow
    // net PnL = price PnL - open/close fees + funding received
    const { credit, net, closeFee, record } = closeOut(pos, exit, 'manual', symbol, (n) => m.r(n))
    m.feesCollected += closeFee
    book.position = null
    // closing by hand also stops any TWAP/VWAP still building this position
    for (const a of [...(book.algos || [])]) this.endAlgo(u, m, book, a, 'stopped')
    m.dropIfEmpty(id)
    this.settle(id, { credit, pnl: net, record })
    return { ok: true, user: u, symbol, event: { type: 'closed', symbol, pnl: record.pnl, fee: record.fee, price: m.r(exit), id: Date.now() } }
  }

  // ── spot (no leverage, no liq, no funding) ────────────────────────────────
  // Spot buy: spend `quote` USDT (taker fee charged on top) to receive coins.
  // It's a market taker order — it WALKS the same book as a perp market order,
  // so it pays slippage and pushes price up, and other users' resting sell
  // limits get filled against it. Coins land in the user's spot inventory.
  spotBuy(id, symbol, { quote, coinCarry }) {
    const u = this.users.get(id)
    const m = this.market(symbol, 'spot')
    if (!u || !m) return { ok: false, error: 'No session' }
    quote = +quote
    if (!quote || quote <= 0) return { ok: false, error: 'Jumlah tidak valid' }
    const fee = quote * TAKER_FEE
    if (quote + fee > u.balance) return { ok: false, error: 'Saldo tidak cukup (jumlah + fee)' }
    const qtyEst = quote / m.price
    const { price: avg, userQty } = m.walkBook('long', qtyEst, id)
    // algo slices pass the fractional coins left over from earlier slices so many
    // tiny buys add up to exactly what one big buy would give (plain buys: unchanged)
    const rawCoins = quote / avg + (coinCarry || 0)
    const coins = coinCarry == null ? m.rq(quote / avg) : Math.floor(rawCoins * 1e6 + 1e-9) / 1e6
    if (coins <= 0) return { ok: false, error: 'Jumlah terlalu kecil' }
    const flow = Math.max(0, coins - userQty) // bot-liquidity part pushes price
    m.feesCollected += fee
    m.pendingFlow += flow
    u.balance = round(u.balance - quote - fee)
    const h = u.spot[symbol] || { qty: 0, cost: 0 }
    h.qty = m.rq(h.qty + coins)
    h.cost = round(h.cost + quote + fee)
    u.spot[symbol] = h
    this.dirty.add(id)
    return { ok: true, user: u, symbol, event: { type: 'spotBuy', symbol, qty: coins, price: m.r(avg), cost: round(quote + fee), carry: coinCarry == null ? 0 : rawCoins - coins, id: Date.now() } }
  }

  // Spot sell: sell `qty` coins (clamped to the holding) back to USDT at market.
  // Walks the book the other way (slippage + pushes price down), pays taker fee,
  // realizes PnL vs the average cost basis, and counts as a closed trade.
  spotSell(id, symbol, { qty }) {
    const u = this.users.get(id)
    const m = this.market(symbol, 'spot')
    if (!u || !m) return { ok: false, error: 'No session' }
    const h = u.spot[symbol]
    if (!h || h.qty <= 0) return { ok: false, error: 'Tidak ada koin untuk dijual' }
    qty = Math.min(+qty, h.qty)
    if (!qty || qty <= 0) return { ok: false, error: 'Jumlah jual tidak valid' }
    const { price: avg, userQty } = m.walkBook('short', qty, id)
    const proceeds = qty * avg
    const fee = proceeds * TAKER_FEE
    const flow = Math.max(0, qty - userQty)
    m.feesCollected += fee
    m.pendingFlow -= flow
    const costPortion = round(h.cost * (qty / h.qty))
    const net = round(proceeds - fee - costPortion)
    u.balance = round(u.balance + proceeds - fee)
    h.qty = m.rq(h.qty - qty)
    h.cost = round(h.cost - costPortion)
    if (h.qty <= 1e-9) delete u.spot[symbol]
    else u.spot[symbol] = h
    // realizing a spot sell counts as a trade, like closing a position
    u.trades += 1
    if (net > 0) u.wins += 1
    u.realized = round(u.realized + net)
    const record = {
      symbol, kind: 'spot', side: 'sell', price: m.r(avg), qty: m.rq(qty),
      cost: costPortion, proceeds: round(proceeds), pnl: net, fee: round(fee),
      reason: 'spot', closedAt: Date.now(),
    }
    u.history = [record, ...u.history].slice(0, 40)
    this.dirty.add(id)
    return { ok: true, user: u, symbol, event: { type: 'spotSell', symbol, qty: m.rq(qty), price: m.r(avg), pnl: net, id: Date.now() } }
  }

  // Place a resting SPOT limit order (accumulation below / distribution above).
  // Buy (side long) reserves USDT off the balance; sell (side short) moves the
  // coins out of the holding into the order. Both rest in the spot book and fill
  // like any limit — delivered via spotFill() when price crosses or a taker hits.
  spotLimit(id, symbol, { side, price, spend, qty, visible }) {
    const u = this.users.get(id)
    const m = this.market(symbol, 'spot')
    if (!u || !m) return { ok: false, error: 'No session' }
    price = +price
    if (!price || price <= 0) return { ok: false, error: 'Harga limit tidak valid' }
    const oid = 's' + Math.random().toString(36).slice(2, 9)
    const visFrac = icebergFrac(visible)
    if (side === 'buy') {
      if (price >= m.price) return { ok: false, error: 'Limit buy harus DI BAWAH harga pasar' }
      spend = +spend
      if (!spend || spend <= 0) return { ok: false, error: 'Jumlah beli tidak valid' }
      const fee = round(spend * MAKER_FEE)
      if (spend + fee > u.balance) return { ok: false, error: 'Saldo tidak cukup (jumlah + fee maker)' }
      u.balance = round(u.balance - spend - fee)
      m.book(id).pendingOrders.push({ id: oid, spot: true, side: 'long', price: m.r(price), qty: m.rq(spend / price), filled: 0, fee, reservedUsd: round(spend + fee), visFrac })
      this.dirty.add(id)
      return { ok: true, user: u, symbol, event: { type: 'spotLimitPlaced', symbol, side: 'buy', price: m.r(price), id: Date.now() } }
    }
    if (side === 'sell') {
      if (price <= m.price) return { ok: false, error: 'Limit sell harus DI ATAS harga pasar' }
      qty = +qty
      const h = u.spot[symbol]
      if (!h || h.qty <= 0) return { ok: false, error: 'Tidak ada koin untuk dijual' }
      if (!qty || qty <= 0) return { ok: false, error: 'Jumlah jual tidak valid' }
      if (qty > h.qty + 1e-9) return { ok: false, error: `Maksimum ${m.rq(h.qty)} ${m.baseAsset}` }
      qty = Math.min(qty, h.qty)
      const costBasis = round(h.cost * (qty / h.qty)) // cost of the coins committed to this order
      h.qty = m.rq(h.qty - qty)
      h.cost = round(h.cost - costBasis)
      if (h.qty <= 1e-9) delete u.spot[symbol]
      else u.spot[symbol] = h
      m.book(id).pendingOrders.push({ id: oid, spot: true, side: 'short', price: m.r(price), qty: m.rq(qty), filled: 0, costBasis, visFrac })
      this.dirty.add(id)
      return { ok: true, user: u, symbol, event: { type: 'spotLimitPlaced', symbol, side: 'sell', price: m.r(price), id: Date.now() } }
    }
    return { ok: false, error: 'Bad side' }
  }

  // A resting spot limit order filled — deliver coins (buy) or proceeds (sell).
  spotFill(uid, { symbol, side, price, qty, order }) {
    const u = this.users.get(uid)
    if (!u) return
    if (order.grid) return this.gridFill(u, { symbol, side, price, qty, order })
    if (side === 'long') {
      const feeShare = (order.fee || 0) * (qty / order.qty)
      const h = u.spot[symbol] || { qty: 0, cost: 0 }
      h.qty = Math.round((h.qty + qty) * 1e6) / 1e6
      h.cost = round(h.cost + qty * price + feeShare)
      u.spot[symbol] = h
    } else {
      const proceeds = qty * price
      const fee = proceeds * MAKER_FEE
      const costPortion = round((order.costBasis || 0) * (qty / order.qty))
      const net = round(proceeds - fee - costPortion)
      u.balance = round(u.balance + proceeds - fee)
      u.trades += 1
      if (net > 0) u.wins += 1
      u.realized = round(u.realized + net)
      u.history = [{ symbol, kind: 'spot', side: 'sell', price, qty: Math.round(qty * 1e6) / 1e6, cost: costPortion, proceeds: round(proceeds), pnl: net, fee: round(fee), reason: 'spotLimit', closedAt: Date.now() }, ...u.history].slice(0, 40)
    }
    this.dirty.add(uid)
  }

  spotCancelLimit(id, symbol, orderId) {
    const u = this.users.get(id)
    const m = this.market(symbol, 'spot')
    if (!u || !m) return { ok: false }
    const book = m.books.get(id)
    if (!book || !book.pendingOrders.length) return { ok: false }
    const keep = []
    let changed = false
    for (const o of book.pendingOrders) {
      if (!o.spot || o.grid || (orderId && o.id !== orderId)) { keep.push(o); continue }
      changed = true
      const rem = Math.max(0, o.qty - o.filled)
      const frac = rem / (o.qty || 1)
      if (o.side === 'long') {
        u.balance = round(u.balance + (o.reservedUsd || 0) * frac)
      } else {
        const h = u.spot[symbol] || { qty: 0, cost: 0 }
        h.qty = m.rq(h.qty + rem)
        h.cost = round(h.cost + (o.costBasis || 0) * frac)
        u.spot[symbol] = h
      }
    }
    if (!changed) return { ok: false }
    book.pendingOrders = keep
    m.dropIfEmpty(id)
    this.dirty.add(id)
    return { ok: true, user: u, symbol }
  }

  spotMoveLimit(id, symbol, orderId, price) {
    const u = this.users.get(id)
    const m = this.market(symbol, 'spot')
    if (!u || !m) return { ok: false }
    const book = m.books.get(id)
    if (!book) return { ok: false }
    const o = book.pendingOrders.find((x) => x.id === orderId && x.spot && !x.grid)
    if (!o) return { ok: false }
    if (o.filled > 1e-9) return { ok: false, error: 'Order kefill sebagian — tidak bisa digeser' }
    price = m.r(+price)
    if (!price || price <= 0) return { ok: false }
    if (o.side === 'long') {
      if (price >= m.price) return { ok: false, error: 'Limit buy harus di bawah market' }
      const spend = (o.reservedUsd || 0) - (o.fee || 0)
      o.price = price
      o.qty = m.rq(spend / price)
    } else {
      if (price <= m.price) return { ok: false, error: 'Limit sell harus di atas market' }
      o.price = price
    }
    this.dirty.add(id)
    return { ok: true, user: u, symbol }
  }

  // ── staking: move spot coins into the staking pocket and back ─────────────
  stake(id, symbol, { qty }) {
    const u = this.users.get(id)
    if (!u) return { ok: false, error: 'No session' }
    const h = u.spot[symbol]
    if (!h || h.qty <= 0) return { ok: false, error: 'Tidak ada koin spot untuk di-stake' }
    qty = Math.min(+qty, h.qty)
    if (!qty || qty <= 0) return { ok: false, error: 'Jumlah stake tidak valid' }
    const costMove = round(h.cost * (qty / h.qty))
    h.qty = r8(h.qty - qty)
    h.cost = round(h.cost - costMove)
    if (h.qty <= 1e-9) delete u.spot[symbol]
    else u.spot[symbol] = h
    const s = u.staked[symbol] || { qty: 0, cost: 0, since: Date.now(), earned: 0 }
    realizeStake(s) // fold in rewards accrued so far before adding more
    s.qty = r8(s.qty + qty)
    s.cost = round(s.cost + costMove)
    u.staked[symbol] = s
    this.dirty.add(id)
    return { ok: true, user: u, symbol, event: { type: 'staked', symbol, qty: r8(qty), action: 'stake', id: Date.now() } }
  }

  unstake(id, symbol, { qty }) {
    const u = this.users.get(id)
    if (!u) return { ok: false, error: 'No session' }
    const s = u.staked[symbol]
    if (!s || s.qty <= 0) return { ok: false, error: 'Tidak ada koin yang di-stake' }
    realizeStake(s) // settle rewards up to now, then withdraw
    qty = Math.min(+qty, s.qty)
    if (!qty || qty <= 0) return { ok: false, error: 'Jumlah unstake tidak valid' }
    const costMove = round(s.cost * (qty / s.qty))
    s.qty = r8(s.qty - qty)
    s.cost = round(s.cost - costMove)
    if (s.qty <= 1e-9) delete u.staked[symbol]
    else u.staked[symbol] = s
    const h = u.spot[symbol] || { qty: 0, cost: 0 }
    h.qty = r8(h.qty + qty)
    h.cost = round(h.cost + costMove)
    u.spot[symbol] = h
    this.dirty.add(id)
    return { ok: true, user: u, symbol, event: { type: 'staked', symbol, qty: r8(qty), action: 'unstake', id: Date.now() } }
  }

  placeLimit(id, symbol, { side, leverage, margin, price, sl, tp, visible }) {
    const u = this.users.get(id)
    const m = this.markets.get(symbol)
    if (!u || !m) return { ok: false, error: 'No session' }
    const book = m.book(id)
    const committed = book.position ? book.position.side : (book.pendingOrders[0] ? book.pendingOrders[0].side : null)
    if (committed && committed !== side) return { ok: false, error: 'Semua order harus sisi yang sama — cancel/tutup dulu untuk balik arah' }
    if (book.algos?.some((a) => a.side !== side)) return { ok: false, error: 'Cancel TWAP/VWAP sisi sebaliknya dulu' }
    leverage = clamp(Math.round(+leverage || 1), 1, 100)
    margin = +margin
    price = +price
    if (!margin || margin <= 0) return { ok: false, error: 'Invalid margin' }
    if (margin + margin * leverage * MAKER_FEE > u.balance) return { ok: false, error: 'Saldo tidak cukup (margin + fee maker)' }
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
    // the maker fee is reserved with the margin and consumed as the order fills
    const fee = round(margin * leverage * MAKER_FEE)
    u.balance = round(u.balance - margin - fee)
    const oid = 'o' + Math.random().toString(36).slice(2, 9)
    book.pendingOrders.push({ id: oid, side, leverage, margin, fee, price: m.r(price), sl: cleanSl, tp: cleanTp, qty: m.rq(qtyFromMargin(margin, leverage, price)), filled: 0, visFrac: icebergFrac(visible) })
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
      refunded += (o.margin + (o.fee || 0)) * Math.max(0, o.qty - o.filled) / (o.qty || 1)
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

  // ── algo orders: TWAP / VWAP (futures only) ───────────────────────────────
  // Both work a large order as a series of small MARKET child orders ("slices")
  // so it doesn't eat the whole book at once:
  //  · TWAP — equal slices at equal time intervals.
  //  · VWAP — same slots, but each slice is sized by how much volume the market
  //    actually traded since the order started (vs. the recent average), so it
  //    trades more when the market is busy and less when it's quiet. The last
  //    slot always completes the order.
  // The full margin + taker fee is reserved up front (it counts as locked equity)
  // and released slice by slice; whatever is left is refunded when the order
  // finishes, is cancelled, or is stopped by the position closing.
  placeAlgo(id, symbol, { algo, side, leverage, margin, duration, slices, sl, tp }) {
    const u = this.users.get(id)
    const m = this.markets.get(symbol)
    if (!u || !m) return { ok: false, error: 'No session' }
    if (!m.isPerp) return { ok: false, error: 'TWAP/VWAP hanya tersedia di Futures' }
    const type = algo === 'twap' || algo === 'vwap' ? algo : null
    if (!type) return { ok: false, error: 'Tipe order tidak dikenal' }
    if (!['long', 'short'].includes(side)) return { ok: false, error: 'Bad side' }
    leverage = clamp(Math.round(+leverage || 1), 1, 100)
    margin = Math.floor((+margin || 0) * 100) / 100
    if (!(margin > 0)) return { ok: false, error: 'Invalid margin' }
    duration = Math.round(+duration)
    if (!(duration >= ALGO_MIN_SEC && duration <= ALGO_MAX_SEC)) return { ok: false, error: `Durasi harus ${ALGO_MIN_SEC} detik – ${ALGO_MAX_SEC / 3600} jam` }
    slices = Math.round(+slices)
    if (!(slices >= 2 && slices <= ALGO_MAX_SLICES)) return { ok: false, error: `Jumlah slice harus 2 – ${ALGO_MAX_SLICES}` }
    if (duration / (slices - 1) < ALGO_MIN_INTERVAL) return { ok: false, error: `Jarak antar slice minimal ${ALGO_MIN_INTERVAL} detik — kurangi slice atau perpanjang durasi` }
    if (margin / slices < ALGO_MIN_SLICE) return { ok: false, error: `Margin per slice minimal $${ALGO_MIN_SLICE} — kurangi slice atau tambah margin` }
    const cur = m.books.get(id)
    if (cur?.position && cur.position.side !== side) return { ok: false, error: 'Tutup posisi dulu untuk balik arah' }
    if (cur?.pendingOrders?.some((o) => o.side !== side)) return { ok: false, error: 'Cancel limit order sisi sebaliknya dulu' }
    if (cur?.algos?.some((a) => a.side !== side)) return { ok: false, error: 'Cancel TWAP/VWAP sisi sebaliknya dulu' }
    if ((cur?.algos?.length || 0) >= ALGO_MAX_ACTIVE) return { ok: false, error: `Maksimal ${ALGO_MAX_ACTIVE} order TWAP/VWAP aktif per market` }
    // reserve margin + the taker fee every slice will pay (fee = notional × rate)
    // (slices are charged against it to the exact sub-cent; the remainder is refunded)
    const reserve = Math.ceil(margin * (1 + leverage * TAKER_FEE) * 100 - 1e-6) / 100
    if (reserve > u.balance) return { ok: false, error: 'Saldo tidak cukup (margin + fee taker)' }
    const now = Date.now()
    const book = m.book(id)
    u.balance = round(u.balance - reserve)
    book.algos.push({
      id: 'a' + Math.random().toString(36).slice(2, 9),
      type, side, leverage, margin,
      sl: sl ? +sl : null, tp: tp ? +tp : null,
      duration, slices,
      reserved: reserve, // margin + fee still held for unexecuted slices
      done: 0, // slots consumed
      filledMargin: 0, filledQty: 0, cost: 0, // cost = Σ fill price × qty → avg fill = cost / filledQty
      mVol: 0, mPV: 0, // market volume / price×volume since start → benchmark VWAP = mPV / mVol
      expVol: m.avgVolPerSec() * duration, // volume the market is expected to trade over the run
      startedAt: now, nextAt: now, endAt: now + duration * 1000,
    })
    this.dirty.add(id)
    return { ok: true, user: u, symbol }
  }

  cancelAlgo(id, symbol, algoId, mode = 'perp') {
    const u = this.users.get(id)
    const m = this.market(symbol, mode === 'spot' ? 'spot' : 'perp')
    if (!u || !m) return { ok: false }
    const book = m.books.get(id)
    const a = book?.algos?.find((x) => x.id === algoId)
    if (!a) return { ok: false }
    const event = this.endAlgo(u, m, book, a, 'cancelled')
    m.dropIfEmpty(id)
    return { ok: true, user: u, symbol, event }
  }

  // Remove an algo order and hand back whatever margin + fee it still holds.
  // Returns the toast event describing how it ended.
  endAlgo(u, m, book, a, status, reason) {
    if (a.reserved > 0) u.balance = round(u.balance + a.reserved)
    a.reserved = 0
    if (a.spot && a.side === 'sell') this.endSpotSell(u, m, a)
    if (a.spot && a.side === 'buy' && a.coinCarry > 1e-9) {
      // hand over the fractional coins the slices carried (already paid for)
      const h = u.spot[m.symbol] || { qty: 0, cost: 0 }
      h.qty = r8(h.qty + a.coinCarry)
      u.spot[m.symbol] = h
      a.coinCarry = 0
    }
    book.algos = (book.algos || []).filter((x) => x.id !== a.id)
    this.dirty.add(u.id)
    return {
      type: 'algo', algo: a.type, status, reason, symbol: m.symbol, side: a.side,
      avg: a.filledQty > 0 ? m.r(a.cost / a.filledQty) : null,
      spot: !!a.spot,
      // futures: USDT margin · spot buy: USDT spent · spot sell: coins sold
      filledMargin: a.spot ? a.filled : round(a.filledMargin), margin: a.spot ? a.total : a.margin,
      id: Date.now() + Math.random(),
    }
  }

  // Execute one child market order of `want` USDT margin out of the reservation.
  // Returns true (filled), false (nothing to do this slot) or an error string.
  algoSlice(u, m, book, a, want) {
    const k = 1 + a.leverage * TAKER_FEE
    let sm = Math.min(want, a.margin - a.filledMargin, (a.reserved + 1e-6) / k)
    sm = Math.floor(sm * 100 + 1e-6) / 100
    if (!(sm >= 0.01)) return false
    // release this slice's margin + fee, then let it fill as a normal market order
    // The user's FREE balance is never touched by a slice — only the reservation
    // shrinks, by exactly what the market order charged (cent-rounded).
    // It is charged the EXACT margin + taker fee (no per-slice cent rounding, so
    // many small slices can't round the fee away); only the final refund rounds.
    const free = u.balance
    u.balance = free + sm * k + 0.01 // lend the slice its funds for the market-order balance check
    const r = this.openPosition(u.id, m.symbol, { side: a.side, leverage: a.leverage, margin: sm, sl: a.sl, tp: a.tp })
    u.balance = free
    if (!r.ok) return r.error || 'Order gagal'
    const spent = clamp(sm + r.fill.price * r.fill.qty * TAKER_FEE, 0, a.reserved)
    a.reserved = Math.max(0, Math.round((a.reserved - spent) * 1e6) / 1e6)
    a.filledMargin = round(a.filledMargin + sm)
    a.filledQty += r.fill.qty
    a.cost += r.fill.price * r.fill.qty
    return true
  }

  // ── spot TWAP / VWAP ──────────────────────────────────────────────────────
  // Same scheduler as the futures algos, on the spot book:
  //  · buy  — spends `spend` USDT over the run. USDT + taker fee are reserved up
  //    front; each slice is a spot market buy charged to the exact amount.
  //  · sell — sells `qty` coins over the run. The coins (and their cost basis)
  //    leave the holding and sit in the order; each slice walks the book and the
  //    proceeds land in the balance. ONE trade record is written when it ends.
  // Anything unexecuted goes back (USDT to the balance, coins to the holding).
  placeSpotAlgo(id, symbol, { algo, side, spend, qty, duration, slices }) {
    const u = this.users.get(id)
    const m = this.market(symbol, 'spot')
    if (!u || !m) return { ok: false, error: 'No session' }
    const type = algo === 'twap' || algo === 'vwap' ? algo : null
    if (!type) return { ok: false, error: 'Tipe order tidak dikenal' }
    if (side !== 'buy' && side !== 'sell') return { ok: false, error: 'Bad side' }
    duration = Math.round(+duration)
    if (!(duration >= ALGO_MIN_SEC && duration <= ALGO_MAX_SEC)) return { ok: false, error: `Durasi harus ${ALGO_MIN_SEC} detik – ${ALGO_MAX_SEC / 3600} jam` }
    slices = Math.round(+slices)
    if (!(slices >= 2 && slices <= ALGO_MAX_SLICES)) return { ok: false, error: `Jumlah slice harus 2 – ${ALGO_MAX_SLICES}` }
    if (duration / (slices - 1) < ALGO_MIN_INTERVAL) return { ok: false, error: `Jarak antar slice minimal ${ALGO_MIN_INTERVAL} detik — kurangi slice atau perpanjang durasi` }
    const cur = m.books.get(id)
    if ((cur?.algos?.length || 0) >= ALGO_MAX_ACTIVE) return { ok: false, error: `Maksimal ${ALGO_MAX_ACTIVE} order TWAP/VWAP aktif per market` }
    const now = Date.now()
    const base = {
      id: 'a' + Math.random().toString(36).slice(2, 9),
      spot: true, type, side, duration, slices,
      done: 0, filled: 0, filledQty: 0, cost: 0, // cost = Σ USDT traded → avg fill = cost / filledQty
      mVol: 0, mPV: 0,
      expVol: m.avgVolPerSec() * duration,
      startedAt: now, nextAt: now, endAt: now + duration * 1000,
    }
    if (side === 'buy') {
      spend = Math.floor((+spend || 0) * 100) / 100
      if (!(spend > 0)) return { ok: false, error: 'Jumlah beli tidak valid' }
      if (spend / slices < ALGO_MIN_SLICE) return { ok: false, error: `Nilai per slice minimal $${ALGO_MIN_SLICE} — kurangi slice atau tambah jumlah` }
      const reserve = Math.ceil(spend * (1 + TAKER_FEE) * 100 - 1e-6) / 100
      if (reserve > u.balance) return { ok: false, error: 'Saldo tidak cukup (jumlah + fee taker)' }
      u.balance = round(u.balance - reserve)
      m.book(id).algos.push({ ...base, total: spend, reserved: reserve })
    } else {
      qty = +qty
      const h = u.spot[symbol]
      if (!h || h.qty <= 0) return { ok: false, error: 'Tidak ada koin untuk dijual' }
      if (!(qty > 0)) return { ok: false, error: 'Jumlah jual tidak valid' }
      if (qty > h.qty + 1e-9) return { ok: false, error: `Maksimum ${m.rq(h.qty)} ${m.baseAsset}` }
      qty = Math.min(Math.floor(Math.min(qty, h.qty) * 1e6 + 1e-6) / 1e6, h.qty)
      if (!(qty > 0)) return { ok: false, error: 'Jumlah jual tidak valid' }
      if ((qty * m.price) / slices < ALGO_MIN_SLICE) return { ok: false, error: `Nilai per slice minimal $${ALGO_MIN_SLICE} — kurangi slice atau tambah jumlah` }
      const costBasis = Math.min(h.cost, round(h.cost * Math.min(1, qty / h.qty))) // cost of the coins committed to this order
      h.qty = r8(h.qty - qty) // keep sub-1e-6 dust instead of rounding it away (or up)
      h.cost = round(h.cost - costBasis)
      if (h.qty <= 1e-9) delete u.spot[symbol]
      else u.spot[symbol] = h
      m.book(id).algos.push({
        ...base, total: qty, reserved: 0,
        remQty: qty, costBasis, // coins (and their cost) still held by the order
        proceeds: 0, fees: 0, costSold: 0, carry: 0, // carry = sub-cent proceeds not yet paid out
      })
    }
    this.dirty.add(id)
    return { ok: true, user: u, symbol }
  }

  // One child order of a spot algo. `want` is USDT (buy) or coins (sell).
  // Returns true (filled), false (nothing this slot) or an error string.
  spotAlgoSlice(u, m, a, want) {
    if (a.side === 'buy') {
      const k = 1 + TAKER_FEE
      let q = Math.min(want, a.total - a.filled, (a.reserved + 1e-6) / k)
      q = Math.floor(q * 100 + 1e-6) / 100
      if (!(q >= 0.01)) return false
      const free = u.balance
      u.balance = free + q * k + 0.01 // lend the slice its funds for the market-buy balance check
      const r = this.spotBuy(u.id, m.symbol, { quote: q, coinCarry: a.coinCarry || 0 })
      u.balance = free
      if (!r.ok) return r.error === 'Jumlah terlalu kecil' ? false : r.error || 'Order gagal'
      a.coinCarry = r.event.carry || 0
      a.reserved = Math.max(0, Math.round((a.reserved - q * k) * 1e6) / 1e6)
      // spotBuy books the cost basis cent-rounded per slice; carry the sub-cent
      // difference so many slices don't drift the holding's cost from what was paid
      a.costCarry = (a.costCarry || 0) + (q * k - r.event.cost)
      const adj = Math.trunc(a.costCarry * 100 + (a.costCarry >= 0 ? 1e-9 : -1e-9)) / 100
      const h = u.spot[m.symbol]
      if (adj && h) { h.cost = round(h.cost + adj); a.costCarry -= adj }
      a.filled = round(a.filled + q)
      a.filledQty += r.event.qty
      a.cost += q
      return true
    }
    let sq = Math.min(want, a.remQty)
    sq = Math.floor(sq * 1e6 + 1e-9) / 1e6
    if (!(sq > 0)) return false
    const cb = a.remQty > 0 ? a.costBasis * (sq / a.remQty) : 0
    const { price: avg, userQty } = m.walkBook('short', sq, u.id)
    const proceeds = sq * avg
    const fee = proceeds * TAKER_FEE
    m.feesCollected += fee
    m.pendingFlow -= Math.max(0, sq - userQty)
    // pay out whole cents now, carry the sub-cent remainder to the next slice
    const due = (a.carry || 0) + proceeds - fee
    const pay = Math.floor(due * 100 + 1e-9) / 100
    u.balance = round(u.balance + pay)
    a.carry = due - pay
    a.remQty = m.rq(a.remQty - sq)
    a.costBasis -= cb
    a.costSold += cb
    a.proceeds += proceeds
    a.fees += fee
    a.filled = m.rq(a.filled + sq)
    a.filledQty += sq
    a.cost += proceeds
    return true
  }

  // settle a spot SELL algo that is ending: leftover coins back to the holding,
  // the sub-cent carry paid out, and the whole run booked as one closed trade
  endSpotSell(u, m, a) {
    const symbol = m.symbol
    if (a.carry > 0) u.balance = round(u.balance + a.carry)
    a.carry = 0
    if (a.remQty > 1e-9) {
      const h = u.spot[symbol] || { qty: 0, cost: 0 }
      h.qty = r8(h.qty + a.remQty)
      h.cost = round(h.cost + Math.max(0, a.costBasis))
      u.spot[symbol] = h
    }
    a.remQty = 0
    a.costBasis = 0
    if (a.filledQty > 0) {
      const net = round(a.proceeds - a.fees - a.costSold)
      u.trades += 1
      if (net > 0) u.wins += 1
      u.realized = round(u.realized + net)
      u.history = [{
        symbol, kind: 'spot', side: 'sell', price: m.r(a.proceeds / a.filledQty), qty: m.rq(a.filledQty),
        cost: round(a.costSold), proceeds: round(a.proceeds), pnl: net, fee: round(a.fees),
        reason: 'spot', closedAt: Date.now(),
      }, ...u.history].slice(0, 40)
    }
  }

  // Runs once per tick, after every market stepped: advance each algo's market
  // benchmark and fire the slices that are due.
  processAlgos(now = Date.now()) {
    const updates = []
    for (const m of this.markets.values()) {
      for (const [uid, book] of m.books) {
        if (!book.algos || !book.algos.length) continue
        const u = this.users.get(uid)
        if (!u) continue
        for (const a of [...book.algos]) {
          if (m.lastVol > 0) { a.mVol += m.lastVol; a.mPV += m.lastVol * m.price }
          if (a.stop) {
            // position was liquidated / hit SL-TP: end quietly (that toast wins)
            this.endAlgo(u, m, book, a, 'stopped', a.stop)
            updates.push({ userId: uid })
            continue
          }
          if (now < a.nextAt) continue
          // size unit: USDT margin (futures), USDT (spot buy) or coins (spot sell)
          const total = a.spot ? a.total : a.margin
          const filled = a.spot ? a.filled : a.filledMargin
          const coinUnit = a.spot && a.side === 'sell'
          const minSlice = coinUnit ? ALGO_MIN_SLICE / (m.price || 1) : ALGO_MIN_SLICE
          const lastSlot = a.slices - a.done <= 1
          let want
          if (lastSlot) want = total - filled
          else if (a.type === 'twap') want = total / a.slices
          else {
            // share of the schedule this slot should have completed, by time…
            const timeFrac = clamp((now - a.startedAt) / (a.duration * 1000) + 1 / a.slices, 0, 1)
            // …and by the volume the market actually traded so far
            const volFrac = a.expVol > 0 ? a.mVol / a.expVol : timeFrac
            const target = clamp(volFrac, 0.5 * timeFrac, Math.min(1, 1.6 * timeFrac))
            want = total * target - filled
            if (want < minSlice) want = 0 // quiet market: sit this slot out
          }
          const res = want > 0 ? (a.spot ? this.spotAlgoSlice(u, m, a, want) : this.algoSlice(u, m, book, a, want)) : false
          a.done += 1
          if (typeof res === 'string') {
            updates.push({ userId: uid, event: this.endAlgo(u, m, book, a, 'failed', res) })
            continue
          }
          const left = (a.spot ? a.total - a.filled : a.margin - a.filledMargin)
          if (a.done >= a.slices || left < (coinUnit ? 1e-6 : 0.01)) {
            updates.push({ userId: uid, event: this.endAlgo(u, m, book, a, 'done') })
            continue
          }
          a.nextAt += (a.duration * 1000) / (a.slices - 1)
          if (a.nextAt <= now) a.nextAt = now + 1000 // behind schedule (server was down): catch up gently
          if (res) this.dirty.add(uid)
          updates.push({ userId: uid })
        }
        m.dropIfEmpty(uid)
      }
    }
    this.algoUpdates = updates
    return updates
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
    // a reset wipes every book — un-deployed TWAP/VWAP reservations are plain
    // cash, so refund them first (only the hub owns balances)
    if (cmd === 'reset') {
      for (const [uid, book] of m.books) {
        const u = this.users.get(uid)
        if (!u) continue
        for (const a of [...(book.algos || [])]) this.endAlgo(u, m, book, a, 'stopped', 'reset')
      }
    }
    // reset wipes / rebase rescales every book in this market — persist that
    if (cmd === 'reset' || cmd === 'rebase') for (const uid of m.books.keys()) this.dirty.add(uid)
    m.mm(cmd, payload)
  }

  // Pay out staking rewards to every staker (called hourly from the tick loop).
  // realizeStake folds the accrued coins into the balance and advances the clock,
  // so this is the concrete hourly credit — it works for offline accounts too.
  // Returns [{ userId, usd }] of who got paid, for notifications.
  settleStaking() {
    const out = []
    for (const u of this.users.values()) {
      let usd = 0
      let any = false
      for (const [sym, s] of Object.entries(u.staked || {})) {
        if (!s || s.qty <= 0) continue
        const before = s.qty
        realizeStake(s)
        const reward = s.qty - before
        if (reward > 1e-12) {
          any = true
          const m = this.market(sym, 'spot')
          if (m) usd += reward * m.price
        }
      }
      if (any) { this.dirty.add(u.id); out.push({ userId: u.id, usd: round(usd) }) }
    }
    return out
  }

  // ── spot grid bot ─────────────────────────────────────────────────────────
  // A grid bot splits a price range [lower, upper] into `grids` equal steps and
  // keeps a ladder of resting spot limit orders on it: buys below the price,
  // sells above. Every time a buy at level i fills it places a sell one level
  // up; every time a sell fills it places a buy one level down — so each round
  // trip banks one grid step (minus maker fees) while price chops in the range.
  //
  // The bot's funds are isolated from the wallet: `invest` USDT leaves the
  // balance and lives in the bot as
  //   usdt / coins              idle inside the bot
  //   usdtLocked / coinsLocked  sitting in its resting buy / sell orders
  // Its orders are ordinary spot limit orders tagged { grid, level }, so they are
  // real book liquidity and fill through the normal matching paths; fills are
  // routed to gridFill() instead of the wallet. Everything counts toward equity.
  // Stopping cancels the ladder and returns USDT to the balance and coins to the
  // spot holding (cost basis = what the bot still owes of the investment).
  gridLevel(g, i) { return g.lower + ((g.upper - g.lower) * i) / g.grids }

  startGrid(id, symbol, { lower, upper, grids, invest }) {
    const u = this.users.get(id)
    const m = this.market(symbol, 'spot')
    if (!u || !m) return { ok: false, error: 'No session' }
    lower = +lower; upper = +upper; invest = Math.floor((+invest || 0) * 100) / 100
    grids = Math.round(+grids)
    if (!(lower > 0) || !(upper > lower) || !Number.isFinite(upper)) return { ok: false, error: 'Range harga tidak valid (lower < upper)' }
    if (!(grids >= GRID_MIN && grids <= GRID_MAX)) return { ok: false, error: `Jumlah grid harus ${GRID_MIN} – ${GRID_MAX}` }
    if (!(invest > 0)) return { ok: false, error: 'Investasi tidak valid' }
    if (invest > u.balance) return { ok: false, error: 'Saldo tidak cukup' }
    u.grids = u.grids || []
    if (u.grids.some((g) => g.symbol === symbol)) return { ok: false, error: `Sudah ada grid bot ${symbol} — stop dulu yang lama` }
    if (u.grids.length >= GRID_MAX_BOTS) return { ok: false, error: `Maksimal ${GRID_MAX_BOTS} grid bot aktif` }
    const P = m.price
    if (!(P > lower && P < upper)) return { ok: false, error: 'Harga pasar harus berada di dalam range grid' }
    const step = (upper - lower) / grids
    // a round trip pays the maker fee twice — the step has to clear that with room to spare
    if (step / lower < GRID_MIN_STEP) return { ok: false, error: `Grid terlalu rapat — jarak antar grid minimal ${GRID_MIN_STEP * 100}% (kurangi grid atau lebarkan range)` }
    const g = {
      id: 'g' + Math.random().toString(36).slice(2, 9),
      symbol, lower: m.r(lower), upper: m.r(upper), grids, invest,
      usdt: invest, coins: 0, usdtLocked: 0, coinsLocked: 0,
      profit: 0, cycles: 0, fees: 0, flips: [],
      startPrice: m.r(P), startedAt: Date.now(),
    }
    const price = (i) => m.r(this.gridLevel(g, i))
    // k = highest level strictly below the market. Buys rest on 0..k; sells on
    // k+2..grids. Level k+1 is left empty — it is where the first flip lands.
    let k = -1
    for (let i = 0; i <= grids; i++) if (price(i) < P) k = i
    if (k < 0 || k >= grids) return { ok: false, error: 'Harga pasar harus berada di dalam range grid' }
    const sells = grids - k - 1
    let buyCost = 0
    for (let i = 0; i <= k; i++) buyCost += price(i) * (1 + MAKER_FEE)
    // coins for the sell ladder are bought at market up front (taker fee + a little slippage room)
    const q = Math.floor((invest / (buyCost + sells * P * (1 + TAKER_FEE) * 1.003)) * 1e6) / 1e6
    if (!(q > 0) || q * price(0) < GRID_MIN_ORDER) return { ok: false, error: `Investasi terlalu kecil — minimal ~$${GRID_MIN_ORDER} per grid` }
    g.qty = q
    const book = m.book(id)
    u.balance = round(u.balance - invest)
    let qs = q
    if (sells > 0) {
      const { price: avg, userQty } = m.walkBook('long', sells * q, id)
      // never spend the USDT the buy ladder needs
      const afford = Math.floor(((g.usdt - buyCost * q) / (sells * avg * (1 + TAKER_FEE))) * 1e6) / 1e6
      qs = Math.max(0, Math.min(q, afford))
      const cost = sells * qs * avg
      const fee = cost * TAKER_FEE
      m.feesCollected += fee
      m.pendingFlow += Math.max(0, sells * qs - userQty)
      g.usdt -= cost + fee
      g.coins += sells * qs
      g.fees += fee
      g.entryAvg = m.r(avg)
    }
    for (let i = 0; i <= k; i++) this.gridPlace(m, book, g, i, 'long', q)
    if (qs > 0) for (let i = k + 2; i <= grids; i++) this.gridPlace(m, book, g, i, 'short', qs)
    u.grids.push(g)
    this.dirty.add(id)
    return { ok: true, user: u, symbol, event: { type: 'grid', status: 'started', symbol, grids, lower: g.lower, upper: g.upper, id: Date.now() } }
  }

  // rest one grid order on the spot book, funded from the bot's idle inventory
  gridPlace(m, book, g, level, side, qty) {
    const price = m.r(this.gridLevel(g, level))
    if (side === 'long') {
      const unit = price * (1 + MAKER_FEE)
      qty = Math.min(qty, Math.floor((g.usdt / unit) * 1e6 + 1e-9) / 1e6)
      if (!(qty > 0)) return false
      const reserved = qty * unit
      g.usdt = Math.max(0, g.usdt - reserved)
      g.usdtLocked += reserved
      book.pendingOrders.push({ id: 'g' + Math.random().toString(36).slice(2, 9), spot: true, grid: g.id, level, side: 'long', price, qty, filled: 0, fee: qty * price * MAKER_FEE, reservedUsd: reserved })
    } else {
      qty = Math.min(qty, Math.floor(g.coins * 1e6 + 1e-9) / 1e6)
      if (!(qty > 0)) return false
      g.coins = Math.max(0, g.coins - qty)
      g.coinsLocked += qty
      book.pendingOrders.push({ id: 'g' + Math.random().toString(36).slice(2, 9), spot: true, grid: g.id, level, side: 'short', price, qty, filled: 0, costBasis: 0 })
    }
    return true
  }

  // a grid order (partly) filled: move the funds inside the bot and, once the
  // order is complete, queue its mirror order for the next tick
  gridFill(u, { symbol, side, price, qty, order }) {
    const g = (u.grids || []).find((x) => x.id === order.grid)
    if (!g) return
    const done = order.qty - order.filled <= 1e-9
    if (side === 'long') {
      const share = (order.reservedUsd || 0) * (qty / order.qty)
      g.usdtLocked = Math.max(0, g.usdtLocked - share)
      g.coins += qty
      g.fees += (order.fee || 0) * (qty / order.qty)
      if (done) g.flips.push({ level: order.level + 1, side: 'short', qty: order.qty })
    } else {
      const proceeds = qty * price
      const fee = proceeds * MAKER_FEE
      g.coinsLocked = Math.max(0, g.coinsLocked - qty)
      g.usdt += proceeds - fee
      g.fees += fee
      if (done) {
        // one completed round trip: bought a level lower, sold here, both as maker
        const buyPx = this.gridLevel(g, order.level - 1)
        g.profit += order.qty * (order.price - buyPx) - order.qty * (order.price + buyPx) * MAKER_FEE
        g.cycles += 1
        g.flips.push({ level: order.level - 1, side: 'long', qty: order.qty })
      }
    }
    this.dirty.add(u.id)
  }

  // Runs once per tick after every market stepped: place the mirror orders for
  // grid fills that completed during the tick. Returns the users to refresh.
  processGrids() {
    const touched = []
    for (const u of this.users.values()) {
      if (!u.grids || !u.grids.length) continue
      let any = false
      for (const g of u.grids) {
        if (!g.flips || !g.flips.length) continue
        const m = this.market(g.symbol, 'spot')
        const flips = g.flips
        g.flips = []
        if (!m) continue
        const book = m.book(u.id)
        for (const f of flips) {
          if (f.level < 0 || f.level > g.grids) continue
          // one order per level: skip if that level is somehow already occupied
          if (book.pendingOrders.some((o) => o.grid === g.id && o.level === f.level)) continue
          this.gridPlace(m, book, g, f.level, f.side, f.qty)
        }
        any = true
      }
      if (any) { this.dirty.add(u.id); touched.push(u.id) }
    }
    this.gridUpdates = touched
    return touched
  }

  stopGrid(id, gridId) {
    const u = this.users.get(id)
    const g = u && (u.grids || []).find((x) => x.id === gridId)
    if (!g) return { ok: false }
    const m = this.market(g.symbol, 'spot')
    const book = m && m.books.get(id)
    if (book) {
      // pull the ladder: unfilled buys hand their USDT back, unfilled sells their coins
      const keep = []
      for (const o of book.pendingOrders) {
        if (o.grid !== g.id) { keep.push(o); continue }
        const rem = Math.max(0, o.qty - (o.filled || 0))
        if (o.side === 'long') g.usdt += (o.reservedUsd || 0) * (rem / (o.qty || 1))
        else g.coins += rem
      }
      book.pendingOrders = keep
      m.dropIfEmpty(id)
    }
    const usdtOut = Math.floor(g.usdt * 100 + 1e-6) / 100
    const coinsOut = Math.floor(g.coins * 1e6 + 1e-9) / 1e6
    u.balance = round(u.balance + usdtOut)
    if (coinsOut > 0) {
      // the coins go to the spot holding carrying whatever the bot has not paid back yet,
      // so selling them later realises the grid's total PnL
      const h = u.spot[g.symbol] || { qty: 0, cost: 0 }
      h.qty = r8(h.qty + coinsOut)
      h.cost = round(h.cost + Math.max(0, g.invest - usdtOut))
      u.spot[g.symbol] = h
    }
    u.grids = u.grids.filter((x) => x.id !== g.id)
    this.dirty.add(id)
    const value = usdtOut + coinsOut * (m ? m.price : 0)
    return {
      ok: true, user: u, symbol: g.symbol,
      event: { type: 'grid', status: 'stopped', symbol: g.symbol, profit: round(g.profit), pnl: round(value - g.invest), cycles: g.cycles, id: Date.now() },
    }
  }

  // does this user have a TWAP/VWAP running anywhere? (drives periodic refreshes)
  hasAlgos(id) {
    for (const m of this.markets.values()) { const b = m.books.get(id); if (b && b.algos && b.algos.length) return true }
    return false
  }

  // ── per-tick advance of every market ──────────────────────────────────────
  tick() {
    // Arbitrage coupling FIRST: pull each symbol's spot & perp toward each other
    // (injects flow both markets consume this same tick), then advance everyone.
    for (const sym of SYMBOLS) this.couple(this.market(sym, 'spot'), this.market(sym, 'perp'))
    const deltas = []
    for (const m of this.markets.values()) deltas.push(m.step())
    this.processAlgos()
    this.processGrids()
    return deltas
  }

  // Tether spot ↔ perp by their basis. The gap is closed a little each tick and
  // the THINNER book moves more: a futures squeeze (deep perp price spikes) drags
  // a thin spot market up hard, while a big spot move also nudges perp back.
  // flow = Δprice × depth, so each market's price moves by ~its share of the gap.
  couple(spot, perp) {
    if (!spot || !perp) return
    const basis = perp.price - spot.price
    if (!basis) return
    const sd = spot.depth(), pd = perp.depth()
    const tot = sd + pd || 1
    const close = BASIS_PULL * basis
    const dSpot = close * (pd / tot) // spot moves toward perp (more when spot is thin)
    const dPerp = -close * (sd / tot) // perp eases toward spot (less when perp is deep)
    spot.pendingFlow += dSpot * sd
    perp.pendingFlow += dPerp * pd
  }

  // ── read helpers (venue = symbol + mode) ──────────────────────────────────
  snapshot(symbol, mode) { const m = this.market(symbol, mode); return m ? m.snapshot() : null }
  crowd(symbol, mode) { const m = this.market(symbol, mode); return m ? m.crowd() : null }
  restingOrders(symbol, mode) { const m = this.market(symbol, mode); return m ? m.restingOrders() : [] }
  bookSnapshot(symbol, mode) { const m = this.market(symbol, mode); return m ? m.bookSnapshot() : null }
  mapData(symbol, mode) { const m = this.market(symbol, mode); return m ? m.mapData() : [] }

  // the markets list / top bar shows the FUTURES price as the headline per symbol,
  // plus the SPOT price so the UI can show the basis / premium between venues
  tickers() {
    return SYMBOLS.map((s) => ({ ...this.market(s, 'perp').ticker(), spot: this.market(s, 'spot').r(this.market(s, 'spot').price) }))
  }
  // lightweight price-only ticks for the live markets list (futures + spot price)
  priceTicks() {
    return SYMBOLS.map((s) => {
      const m = this.market(s, 'perp')
      const sp = this.market(s, 'spot')
      return { symbol: s, price: m.r(m.price), change: Math.round(m.change24h() * 100) / 100, spot: sp.r(sp.price) }
    })
  }

  // top bots across all markets, for the global leaderboard
  botEntries(limit = 40) {
    const all = []
    for (const m of this.markets.values()) if (m.isPerp) all.push(...m.botEntries())
    all.sort((a, b) => b.equity - a.equity)
    return all.slice(0, limit).map((b) => ({ name: b.name, symbol: b.symbol, equity: round(b.equity), pnl: round(b.pnl), roe: round(b.roe), side: b.side, lev: b.lev, bot: true }))
  }
}
