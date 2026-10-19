import { MARKETS, SYMBOLS, INITIAL_BALANCE, TAKER_FEE, MAKER_FEE, BASIS_PULL, STAKE_APY, YEAR_MS } from './constants.js'
import { Market, depthFor, qtyFromMargin, liquidationPrice, unrealizedPnl, closeOut } from './market.js'

export { depthFor }

const round = (n) => Math.round(n * 100) / 100
const r8 = (n) => Math.round(n * 1e8) / 1e8 // coin precision for staking (keep tiny rewards)
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

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
    return { balance: u.balance, trades: u.trades, wins: u.wins, realized: u.realized, books: this.userBooks(id), history: u.history, spot: u.spot, staked: u.staked }
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
  userLockedValue(id) {
    let v = 0
    for (const m of this.markets.values()) {
      const book = m.books.get(id)
      if (!book || !book.pendingOrders) continue
      for (const o of book.pendingOrders) {
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
    book.position = { side, entry: m.r(entry), leverage, margin, deposit: margin, fees: fee, funding: 0, qty: m.rq(addQty), sl: cleanSl, tp: cleanTp, liq, openedAt: Date.now() }
    u.balance = round(u.balance - margin - fee)
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
    const flow = Math.max(0, pos.qty - userQty)
    m.pendingFlow += pos.side === 'long' ? -flow : flow
    // net PnL = price PnL - open/close fees + funding received
    const { credit, net, closeFee, record } = closeOut(pos, exit, 'manual', symbol, (n) => m.r(n))
    m.feesCollected += closeFee
    book.position = null
    m.dropIfEmpty(id)
    this.settle(id, { credit, pnl: net, record })
    return { ok: true, user: u, symbol, event: { type: 'closed', symbol, pnl: record.pnl, fee: record.fee, price: m.r(exit), id: Date.now() } }
  }

  // ── spot (no leverage, no liq, no funding) ────────────────────────────────
  // Spot buy: spend `quote` USDT (taker fee charged on top) to receive coins.
  // It's a market taker order — it WALKS the same book as a perp market order,
  // so it pays slippage and pushes price up, and other users' resting sell
  // limits get filled against it. Coins land in the user's spot inventory.
  spotBuy(id, symbol, { quote }) {
    const u = this.users.get(id)
    const m = this.market(symbol, 'spot')
    if (!u || !m) return { ok: false, error: 'No session' }
    quote = +quote
    if (!quote || quote <= 0) return { ok: false, error: 'Jumlah tidak valid' }
    const fee = quote * TAKER_FEE
    if (quote + fee > u.balance) return { ok: false, error: 'Saldo tidak cukup (jumlah + fee)' }
    const qtyEst = quote / m.price
    const { price: avg, userQty } = m.walkBook('long', qtyEst, id)
    const coins = m.rq(quote / avg)
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
    return { ok: true, user: u, symbol, event: { type: 'spotBuy', symbol, qty: coins, price: m.r(avg), cost: round(quote + fee), id: Date.now() } }
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
  spotLimit(id, symbol, { side, price, spend, qty }) {
    const u = this.users.get(id)
    const m = this.market(symbol, 'spot')
    if (!u || !m) return { ok: false, error: 'No session' }
    price = +price
    if (!price || price <= 0) return { ok: false, error: 'Harga limit tidak valid' }
    const oid = 's' + Math.random().toString(36).slice(2, 9)
    if (side === 'buy') {
      if (price >= m.price) return { ok: false, error: 'Limit buy harus DI BAWAH harga pasar' }
      spend = +spend
      if (!spend || spend <= 0) return { ok: false, error: 'Jumlah beli tidak valid' }
      const fee = round(spend * MAKER_FEE)
      if (spend + fee > u.balance) return { ok: false, error: 'Saldo tidak cukup (jumlah + fee maker)' }
      u.balance = round(u.balance - spend - fee)
      m.book(id).pendingOrders.push({ id: oid, spot: true, side: 'long', price: m.r(price), qty: m.rq(spend / price), filled: 0, fee, reservedUsd: round(spend + fee) })
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
      m.book(id).pendingOrders.push({ id: oid, spot: true, side: 'short', price: m.r(price), qty: m.rq(qty), filled: 0, costBasis })
      this.dirty.add(id)
      return { ok: true, user: u, symbol, event: { type: 'spotLimitPlaced', symbol, side: 'sell', price: m.r(price), id: Date.now() } }
    }
    return { ok: false, error: 'Bad side' }
  }

  // A resting spot limit order filled — deliver coins (buy) or proceeds (sell).
  spotFill(uid, { symbol, side, price, qty, order }) {
    const u = this.users.get(uid)
    if (!u) return
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
      if (!o.spot || (orderId && o.id !== orderId)) { keep.push(o); continue }
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
    const o = book.pendingOrders.find((x) => x.id === orderId && x.spot)
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
    book.pendingOrders.push({ id: oid, side, leverage, margin, fee, price: m.r(price), sl: cleanSl, tp: cleanTp, qty: m.rq(qtyFromMargin(margin, leverage, price)), filled: 0 })
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

  // ── per-tick advance of every market ──────────────────────────────────────
  tick() {
    // Arbitrage coupling FIRST: pull each symbol's spot & perp toward each other
    // (injects flow both markets consume this same tick), then advance everyone.
    for (const sym of SYMBOLS) this.couple(this.market(sym, 'spot'), this.market(sym, 'perp'))
    const deltas = []
    for (const m of this.markets.values()) deltas.push(m.step())
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
