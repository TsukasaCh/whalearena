import {
  BASE_PERIOD, BASE_VOL, HIST_VOL, BASE_CAP, HIST_HOURS,
  MMR, BOT_TARGET, BOT_MAX, INITIAL_BOTS, DEPTH_REF,
  TAKER_FEE, MAKER_FEE, FUNDING_INTERVAL, FUNDING_BASE, FUNDING_K, FUNDING_CAP, FUNDING_FLOW,
} from './constants.js'

// Round to a market's own precision (BTC → cents, DOGE → 6dp, PEPE → 10dp).
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const nowBucket = () => Math.floor(Date.now() / 1000 / BASE_PERIOD) * BASE_PERIOD

// --- order-flow price-impact model (see the original single-market notes) ---
const AMBIENT_FLOW = 0.28
const MIN_FILL = 4
const FILL_FRAC = 0.4
const DRIFT_FLOW = 7
const NUDGE_FLOW = 8

// Market depth in COIN units of resting liquidity per 1 unit of price change,
// scaled per market so a $0.13 DOGE and a $64k BTC both behave sensibly. The
// factor keeps "1% price move costs ~X of notional" roughly constant.
export const depthFor = (participants) =>
  Math.max(0.05, Math.min(0.8, 0.0018 * participants))

// ── bot order book ───────────────────────────────────────────────────────────
// The visible book is a real, discrete ladder of resting bot limit orders (bids
// below / asks above). Market orders WALK it (consuming levels for slippage), and
// each level replenishes toward its target over a few ticks, so the book fills,
// gets eaten, and refills — a living L2 book rather than a smooth formula.
const BOOK_HALF = 22 // levels maintained per side
const BOOK_SEND = 18 // levels streamed to clients per side
const BOOK_REPLENISH = 0.16 // per-tick fraction a level regrows toward its target
const bookShape = (distPct) => 0.45 + 1.15 * Math.exp(-Math.pow((distPct - 0.0045) / 0.006, 2))
const bookHash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x) }

const liquidationPrice = (side, entry, lev) =>
  side === 'long' ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR)
const qtyFromMargin = (margin, lev, entry) => (entry ? (margin * lev) / entry : 0)
const unrealizedPnl = (side, entry, price, qty) => (side === 'long' ? price - entry : entry - price) * qty
// isolated liq price from the ACTUAL margin (funding moves margin away from the
// nominal entry/leverage formula): equity = margin + pnl hits MMR x notional
const liqFromMargin = (side, entry, margin, qty) => {
  if (!qty) return entry
  const buffer = (margin - MMR * entry * qty) / qty
  return side === 'long' ? entry - buffer : entry + buffer
}
const round2 = (n) => Math.round(n * 100) / 100

// Final wallet settlement of a closed position. `deposit` is the margin the user
// put in, `fees` the fees already paid on the way in, `funding` the net funding
// received (already folded into `margin`). net = what the wallet actually gained.
function closeOut(pos, exit, reason, symbol, rPrice) {
  const liq = reason === 'liq'
  const gross = liq ? -pos.margin : unrealizedPnl(pos.side, pos.entry, exit, pos.qty)
  const closeFee = liq ? 0 : exit * pos.qty * TAKER_FEE
  const credit = liq ? 0 : Math.max(0, pos.margin + gross - closeFee)
  const deposit = pos.deposit ?? pos.margin
  const fees = (pos.fees || 0) + closeFee
  const net = credit - deposit - (pos.fees || 0)
  const record = {
    symbol, side: pos.side, leverage: pos.leverage, entry: pos.entry, exit: rPrice(exit), qty: pos.qty,
    margin: deposit, pnl: round2(net), gross: round2(liq ? -deposit : gross), fee: round2(fees),
    funding: round2(pos.funding || 0), reason, closedAt: Date.now(),
  }
  return { credit, net, closeFee, record }
}

function firstHit(oldP, newP, pos) {
  const lo = Math.min(oldP, newP)
  const hi = Math.max(oldP, newP)
  const up = newP >= oldP
  const inR = (l) => l != null && l >= lo && l <= hi
  const cand = []
  if (inR(pos.tp)) cand.push({ level: 'tp', price: pos.tp })
  if (inR(pos.sl)) cand.push({ level: 'sl', price: pos.sl })
  if (inR(pos.trailLevel)) cand.push({ level: 'trail', price: pos.trailLevel })
  if (inR(pos.liq)) cand.push({ level: 'liq', price: pos.liq })
  if (!cand.length) return null
  cand.sort((a, b) => (up ? a.price - b.price : b.price - a.price))
  return cand[0]
}

function wick(origin, level) {
  const dir = level >= origin ? 1 : -1
  const pierce = level + dir * origin * 0.0015
  const legStep = Math.max(Math.abs(pierce - origin) / 3, origin * 0.005)
  return [{ target: pierce, step: legStep }, { target: origin, step: legStep }]
}

function liquidityPools(entries, price) {
  const bucket = price * 0.003
  const map = new Map()
  for (const e of entries) {
    const key = Math.round(e.liq / bucket)
    let g = map.get(key)
    if (!g) { g = { price: key * bucket, long: 0, short: 0, count: 0 }; map.set(key, g) }
    if (e.side === 'long') g.long += e.notional
    else g.short += e.notional
    g.count++
  }
  return [...map.values()].map((g) => ({ ...g, weight: g.long + g.short, side: g.long >= g.short ? 'long' : 'short' }))
}
function densestPool(pools, price, maxD = 0.06) {
  let best = null
  for (const p of pools) {
    const d = Math.abs(p.price - price) / price
    if (d > maxD || d < 0.0015) continue
    if (!best || p.weight > best.weight) best = p
  }
  return best
}

const LEVS = [5, 10, 20, 20, 25, 25, 50, 50, 75, 100]
const ADJ = ['degen', 'moon', 'diamond', 'paper', 'turbo', 'giga', 'based', 'rekt', 'ape', 'chad', 'wagmi', 'hodl', 'yolo', 'fomo', 'liquid', 'laser', 'satoshi', 'pump', 'dump', 'cope']
const NOUN = ['ape', 'boi', 'hands', 'whale', 'king', 'ninja', 'wizard', 'goblin', 'frog', 'bull', 'bear', 'sniper', 'wojak', 'pepe', 'maxi', 'lord', 'beast', 'shark', 'chef', 'anon']
const cap = (s) => s[0].toUpperCase() + s.slice(1)
function nickname() {
  const a = ADJ[(Math.random() * ADJ.length) | 0]
  const n = NOUN[(Math.random() * NOUN.length) | 0]
  const num = Math.random() < 0.6 ? String(((Math.random() * 90) | 0) + 10) : ''
  return a + cap(n) + num
}

export class Market {
  // cfg: { symbol, name, base, price, vol, dp }  — settle(userId, {credit, pnl, record}) lives on the hub
  constructor(cfg, settle) {
    this.symbol = cfg.symbol
    this.name = cfg.name
    this.baseAsset = cfg.base
    this.dp = cfg.dp
    this.volScale = cfg.vol || 1
    this.seedPrice = cfg.price
    this.settle = settle
    this.books = new Map() // userId -> { position, pendingOrders: [] }
    this.makerEvents = [] // limit fills from market orders, flushed with the next tick
    this.feesCollected = 0 // trading fees paid by real users in this market (the house cut)
    this.nextFunding = Math.ceil(Date.now() / 1000 / FUNDING_INTERVAL) * FUNDING_INTERVAL
    this.reset(true)
  }

  // round to this market's price precision
  r(n) { const f = Math.pow(10, this.dp); return Math.round(n * f) / f }
  rq(n) { return Math.round(n * 1e6) / 1e6 } // coin quantity precision

  // fresh 1m + deep history that ENDS exactly on `target` (the live price)
  freshHistory(target) {
    const seed = this.genBaseHistory(BASE_CAP, target)
    const k = target / seed.price
    this.base = seed.base.map((c) => ({ ...c, open: this.r(c.open * k), high: this.r(c.high * k), low: this.r(c.low * k), close: this.r(c.close * k) }))
    this.deep = this.genDeepHistory(HIST_HOURS, this.base[0].open, this.base[0].time)
    this.price = this.r(target)
    this.baseCurrent = { time: seed.nextTime, open: this.price, high: this.price, low: this.price, close: this.price, volume: 0 }
  }

  reset(initial = false) {
    this.freshHistory(this.seedPrice)
    this.momentum = 0
    this.bots = []
    for (let i = 0; i < INITIAL_BOTS; i++) this.bots.push(this.makeBot(this.price, 0.5))
    this.harvested = 0
    this.liquidatedTotal = 0
    this.queue = []
    this.chopTicks = 0
    this.drift = 0
    this.spike = false
    this.pendingFlow = 0
    this.anchor = this.seedPrice
    this.autoHunt = false
    this.autoCd = 0
    if (!initial) {
      for (const [uid, book] of this.books) {
        book.position = null
        book.pendingOrders = []
      }
    }
    this.initBook()
    this.epoch = (this.epoch || 0) + 1
  }

  // ── persistence: price + candle history survive a server restart ──────────
  // Candles are packed as [time, open, high, low, close, volume] to keep it small.
  serialize() {
    const pack = (c) => [c.time, c.open, c.high, c.low, c.close, c.volume]
    return {
      v: 1,
      price: this.price,
      anchor: this.anchor,
      seedPrice: this.seedPrice,
      harvested: this.harvested,
      liquidatedTotal: this.liquidatedTotal,
      feesCollected: this.feesCollected,
      baseCurrent: this.baseCurrent,
      base: this.base.map(pack),
      deep: this.deep.map(pack),
    }
  }

  restore(st) {
    if (!st || st.v !== 1 || !(st.price > 0) || !st.baseCurrent || !Array.isArray(st.base) || !st.base.length) return false
    const unpack = (a) => ({ time: a[0], open: a[1], high: a[2], low: a[3], close: a[4], volume: a[5] })
    this.price = st.price
    this.anchor = st.anchor > 0 ? st.anchor : st.price
    if (st.seedPrice > 0) this.seedPrice = st.seedPrice
    this.harvested = st.harvested || 0
    this.liquidatedTotal = st.liquidatedTotal || 0
    this.feesCollected = st.feesCollected || 0
    this.base = st.base.map(unpack)
    this.deep = Array.isArray(st.deep) ? st.deep.map(unpack) : this.deep
    this.baseCurrent = st.baseCurrent
    // the server was down: close the open bar and bridge the gap up to now with
    // candles that wander but END on the saved price, so open positions resume at
    // exactly the price they left off at (no PnL jump, no retro SL/liq hits)
    const now = nowBucket()
    if (now > this.baseCurrent.time) {
      this.base.push(this.baseCurrent)
      const gap = Math.min((now - this.baseCurrent.time) / BASE_PERIOD - 1, BASE_CAP)
      if (gap > 0) this.base.push(...this.bridge(gap, now - gap * BASE_PERIOD, this.price))
      if (this.base.length > BASE_CAP) this.base = this.base.slice(-BASE_CAP)
      this.baseCurrent = { time: now, open: this.price, high: this.price, low: this.price, close: this.price, volume: 0 }
    }
    // bots + resting ladder are ephemeral — rebuild them around the restored price
    this.bots = []
    for (let i = 0; i < INITIAL_BOTS; i++) this.bots.push(this.makeBot(this.price, 0.5))
    this.initBook()
    this.epoch = (this.epoch || 0) + 1
    return true
  }

  // Re-level the whole market to `target`: fresh candle history (1m + deep) that
  // has always lived around that price and ends exactly on it — no giant spike
  // candle like a Drive leaves behind — with the mean-reversion anchor and seed
  // moved there too so price doesn't drift back. Open positions and resting
  // orders are rescaled by target/old (price ×f, qty ÷f) so every margin,
  // notional and dollar PnL stays exactly what it was.
  rebase(target) {
    target = +target
    if (!(target > 0) || !(this.price > 0)) return false
    const f = target / this.price
    this.freshHistory(target)
    this.seedPrice = this.price
    this.anchor = this.price
    this.momentum = 0
    this.queue = []
    this.chopTicks = 0
    this.drift = 0
    this.spike = false
    this.pendingFlow = 0
    const px = (v) => (v ? this.r(v * f) : v)
    for (const book of this.books.values()) {
      const pos = book.position
      if (pos) {
        pos.entry = px(pos.entry); pos.liq = px(pos.liq); pos.sl = px(pos.sl); pos.tp = px(pos.tp)
        pos.qty = this.rq(pos.qty / f)
        if (pos.trail) { pos.trail.anchor = px(pos.trail.anchor); pos.trailLevel = px(pos.trailLevel) }
      }
      for (const o of book.pendingOrders) {
        o.price = px(o.price); o.sl = px(o.sl); o.tp = px(o.tp)
        o.qty = this.rq(o.qty / f); o.filled = this.rq(o.filled / f)
      }
    }
    this.bots = []
    for (let i = 0; i < INITIAL_BOTS; i++) this.bots.push(this.makeBot(this.price, 0.5))
    this.initBook()
    this.epoch = (this.epoch || 0) + 1
    return true
  }

  // `count` 1m bars from `t0` that start and finish at `price` (random walk with
  // its drift removed — a Brownian bridge), shaped like genBaseHistory's bars.
  bridge(count, t0, price) {
    const hv = HIST_VOL * this.volScale
    const walk = []
    let c = 0
    for (let i = 0; i < count; i++) {
      const sub = []
      for (let k = 0; k < 6; k++) { c += (Math.random() - 0.5) * hv; sub.push(c) }
      walk.push(sub)
    }
    const drift = c / count
    const out = []
    let prev = price
    for (let i = 0; i < count; i++) {
      const pts = walk[i].map((x, k) => price * Math.exp(x - drift * (i + (k + 1) / 6)))
      const open = prev
      const close = pts[pts.length - 1]
      const hi = Math.max(open, ...pts)
      const lo = Math.min(open, ...pts)
      out.push({
        time: t0 + i * BASE_PERIOD,
        open: this.r(open), high: this.r(hi), low: this.r(lo), close: this.r(close),
        volume: Math.round((((hi - lo) / (open || 1)) * 3000 + 6 + Math.random() * 10) * (DEPTH_REF / open) * 100) / 100,
      })
      prev = close
    }
    return out
  }

  // -- funding --------------------------------------------------------------
  // predicted rate for the next settlement, from the crowd's OI imbalance
  fundingRate() {
    let L = 0, S = 0
    for (const e of this.mapEntries()) { if (e.side === 'long') L += e.notional; else S += e.notional }
    const imb = L + S > 0 ? (L - S) / (L + S) : 0
    return Math.round(clamp(FUNDING_BASE + FUNDING_K * imb, -FUNDING_CAP, FUNDING_CAP) * 1e7) / 1e7
  }
  // Settle funding ZERO-SUM between real users, like a real exchange: rate > 0 →
  // longs pay shorts, rate < 0 → shorts pay longs. Only notional that has a real
  // counterparty is charged: pot = |rate| x min(payer notional, receiver notional),
  // collected from payers and paid to receivers pro-rata by notional. No one on
  // the other side → nobody pays. It moves the isolated margin (and liq price).
  applyFunding(userEvents) {
    const rate = this.fundingRate()
    const payerSide = rate >= 0 ? 'long' : 'short'
    const payers = [], receivers = []
    let payN = 0, recN = 0
    for (const [uid, book] of this.books) {
      const pos = book.position
      if (!pos) continue
      const n = pos.qty * this.price
      if (pos.side === payerSide) { payers.push({ uid, pos, n }); payN += n } else { receivers.push({ uid, pos, n }); recN += n }
    }
    const pot = Math.abs(rate) * Math.min(payN, recN)
    if (pot > 0) {
      const settle = (list, total, sign) => {
        for (const { uid, pos, n } of list) {
          const amt = sign * pot * (n / total) // + received, - paid
          pos.margin = round2(pos.margin + amt)
          pos.funding = round2((pos.funding || 0) + amt)
          pos.liq = this.r(liqFromMargin(pos.side, pos.entry, pos.margin, pos.qty))
          userEvents.push({ userId: uid, symbol: this.symbol, event: { type: 'funding', symbol: this.symbol, side: pos.side, amount: round2(amt), rate, id: Date.now() + Math.random() } })
        }
      }
      settle(payers, payN, -1)
      settle(receivers, recN, 1)
    }
    // The settlement minute moves price by the funding VOLUME, not a fixed %:
    // part of the matched notional reacts (more of it the closer the rate is to
    // the cap) and that flow walks the book, so the candle size follows how much
    // money actually changed hands vs the market's depth. No funding paid → no
    // move. Direction: negative → dump, positive → pump. Capped at 3% of price.
    if (pot > 0) {
      const matched = Math.min(payN, recN) / this.price // coins on both sides
      const flow = matched * FUNDING_FLOW * Math.min(1, Math.abs(rate) / FUNDING_CAP)
      const cap = 0.03 * this.price * this.depth()
      this.pendingFlow += (rate >= 0 ? 1 : -1) * Math.min(flow, cap)
    }
  }

  book(userId) {
    let b = this.books.get(userId)
    if (!b) { b = { position: null, pendingOrders: [] }; this.books.set(userId, b) }
    return b
  }
  dropIfEmpty(userId) {
    const b = this.books.get(userId)
    if (b && !b.position && (!b.pendingOrders || !b.pendingOrders.length)) this.books.delete(userId)
  }

  makeBot(price, pLong) {
    const side = Math.random() < pLong ? 'long' : 'short'
    const leverage = LEVS[(Math.random() * LEVS.length) | 0]
    const margin = Math.round(Math.random() ** 2 * 450 + 50)
    const entry = price
    const qty = qtyFromMargin(margin, leverage, entry)
    const liq = this.r(liquidationPrice(side, entry, leverage))
    let sl = null
    if (Math.random() < 0.3) {
      const d = Math.random() * 0.02 + 0.005
      sl = this.r(side === 'long' ? entry * (1 - d) : entry * (1 + d))
    }
    return { id: 'b' + Math.random().toString(36).slice(2, 9), name: nickname(), side, leverage, margin, entry: this.r(entry), qty, liq, sl }
  }

  genBaseHistory(count, start) {
    const base = []
    let price = start
    let anchor = start
    let t = nowBucket() - count * BASE_PERIOD
    const hv = HIST_VOL * this.volScale
    for (let i = 0; i < count; i++) {
      anchor = anchor * (1 + (Math.random() - 0.5) * 0.0012)
      const open = price
      let c = open, hi = open, lo = open
      for (let s = 0; s < 6; s++) {
        const revert = ((anchor - c) / anchor) * 0.02
        c = c * (1 + (Math.random() - 0.5) * hv + revert)
        if (c > hi) hi = c
        if (c < lo) lo = c
      }
      const range = (hi - lo) / (open || 1)
      base.push({
        time: t,
        open: this.r(open),
        high: this.r(hi),
        low: this.r(lo),
        close: this.r(c),
        volume: Math.round((range * 3000 + 6 + Math.random() * 10) * (DEPTH_REF / open) * 100) / 100,
      })
      price = c
      t += BASE_PERIOD
    }
    return { base, price: this.r(price), nextTime: t }
  }

  // ~3 months of hourly bars, random-walked then rescaled so the final close
  // lands exactly on the live base's first open (seamless stitch, no price jump).
  genDeepHistory(hours, endPrice, base0Time) {
    const endHour = Math.floor(base0Time / 3600) * 3600
    const startHour = endHour - hours * 3600
    const hv = HIST_VOL * this.volScale * 3.2 // hour bars travel further than 1m bars
    const raw = []
    let price = endPrice
    let anchor = endPrice
    for (let i = 0; i < hours; i++) {
      anchor = anchor * (1 + (Math.random() - 0.5) * 0.006)
      const open = price
      let c = open, hi = open, lo = open
      for (let s = 0; s < 5; s++) {
        const revert = ((anchor - c) / anchor) * 0.03
        c = c * (1 + (Math.random() - 0.5) * hv + revert)
        if (c > hi) hi = c
        if (c < lo) lo = c
      }
      raw.push({ open, high: hi, low: lo, close: c, range: (hi - lo) / (open || 1) })
      price = c
    }
    // rescale so the last close equals endPrice → contiguous with live base
    const ratio = raw.length ? endPrice / raw[raw.length - 1].close : 1
    const out = []
    let t = startHour
    for (const b of raw) {
      out.push({
        time: t,
        open: this.r(b.open * ratio),
        high: this.r(b.high * ratio),
        low: this.r(b.low * ratio),
        close: this.r(b.close * ratio),
        volume: Math.round((b.range * 3000 + 6 + Math.random() * 10) * 60 * (DEPTH_REF / (b.open * ratio))),
      })
      t += 3600
    }
    return out
  }

  // price factor: coin-flow constants and depth are BTC-tuned, so scale them by
  // (DEPTH_REF / price) to keep percentage price-impact consistent across markets.
  pf() { return DEPTH_REF / (this.price || DEPTH_REF) }

  depth() {
    let realActive = 0
    for (const b of this.books.values()) if (b.position) realActive++
    const participants = this.bots.length + realActive * 4
    const f = this.pf()
    return depthFor(participants) * f * f // coin depth per $1 (∝ 1/price²)
  }

  // Average execution price for a MARKET order of `qty` coins. It walks the book,
  // so the taker pays slippage: with a locally-linear book the average fill sits
  // half the price-impact away from mid. Tiny orders barely move; a whale-sized
  // notional visibly drags its own entry. Δimpact = qty / depth, slip = impact/2.
  execPrice(side, qty) {
    const rho = this.depth()
    const slip = rho > 0 ? Math.abs(qty) / rho / 2 : 0
    const p = side === 'long' ? this.price + slip : this.price - slip
    return this.r(clamp(p, this.price * 0.5, this.price * 2))
  }

  // ── bot order book ─────────────────────────────────────────────────────────
  // price granularity of the book — a "nice" tick ≈ 0.015% of price, so the
  // touch spread is consistent across a $64k BTC and a $0.0000092 PEPE.
  bookTick() {
    const p = this.price > 0 ? this.price : this.seedPrice
    const raw = p * 0.00015
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    const norm = raw / mag // 1..10
    const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10
    return Number((nice * mag).toPrecision(2)) // clean decimal, no float noise
  }
  // target resting size at a level: a smooth depth hump + stable walls (~10% of
  // levels), calibrated to `rho` so walking the book ≈ the intended slippage.
  levelTarget(price, rho, tick, key) {
    const distPct = Math.abs(price - this.price) / this.price
    const base = rho * bookShape(distPct) * tick
    const h = bookHash(key)
    const wall = h > 0.9 ? rho * tick * (6 + ((h - 0.9) / 0.1) * 30) : 0
    return Math.max(base + wall, rho * tick * 0.04)
  }
  initBook() {
    this.asks = new Map() // priceKey -> { price, qty }
    this.bids = new Map()
    for (let i = 0; i < 8; i++) this.updateBook() // warm up toward target depth
  }
  // maintain the ladder each tick: regrow toward target, drop stale/wrong-side levels
  updateBook() {
    const tick = this.bookTick()
    const rho = this.depth()
    const maxDist = this.price * 0.04
    const grow = (map, isAsk) => {
      const bestKey = isAsk ? Math.ceil(this.price / tick) : Math.floor(this.price / tick)
      for (let k = 0; k < BOOK_HALF; k++) {
        const key = isAsk ? bestKey + k : bestKey - k
        const price = this.r(key * tick)
        if (Math.abs(price - this.price) > maxDist) break
        if (isAsk ? price <= this.price : price >= this.price) continue
        const target = this.levelTarget(price, rho, tick, key)
        let lvl = map.get(key)
        if (!lvl) lvl = { price, qty: target * 0.4 }
        lvl.price = price
        lvl.qty += (target - lvl.qty) * BOOK_REPLENISH
        map.set(key, lvl)
      }
      for (const [key, lvl] of map) {
        if (Math.abs(lvl.price - this.price) > maxDist * 1.25 || (isAsk ? lvl.price <= this.price : lvl.price >= this.price)) map.delete(key)
      }
    }
    grow(this.asks, true)
    grow(this.bids, false)
  }
  // a market order walks the book: consume levels from the touch outward, return
  // the size-weighted average fill price, and leave the eaten levels thin (they
  // refill over the next ticks). Overflow past the book extrapolates via depth.
  // Real users' resting limit orders on the opposite side are part of the book:
  // the taker trades against them at THEIR price (the maker gets filled right
  // away), ahead of bot liquidity at the same price. `takerId` is skipped so a
  // user never trades with their own order.
  // Returns { price, userQty } — userQty is the part matched against real makers.
  walkBook(side, qty, takerId) {
    if (!qty || qty <= 0) return { price: this.price, userQty: 0 }
    const isBuy = side === 'long'
    const map = isBuy ? this.asks : this.bids
    const levels = [...map.values()].map((lvl) => ({ price: lvl.price, bot: lvl }))
    const makerSide = isBuy ? 'short' : 'long'
    for (const [uid, book] of this.books) {
      if (uid === takerId) continue
      for (const o of book.pendingOrders) {
        if (o.side === makerSide && o.qty - o.filled > 1e-9) levels.push({ price: o.price, uid, book, o })
      }
    }
    levels.sort((a, b) => (isBuy ? a.price - b.price : b.price - a.price) || (a.bot ? 1 : 0) - (b.bot ? 1 : 0))
    let remaining = qty, cost = 0, filled = 0, worst = this.price, userQty = 0
    for (const lvl of levels) {
      if (remaining <= 1e-12) break
      let take
      if (lvl.bot) {
        take = Math.min(remaining, lvl.bot.qty)
        if (take <= 0) continue
        lvl.bot.qty -= take
      } else {
        take = this.fillLimitOrder(lvl.uid, lvl.book, lvl.o, remaining, this.makerEvents)
        if (take <= 0) continue
        userQty += take
      }
      cost += take * lvl.price; filled += take; remaining -= take; worst = lvl.price
    }
    if (remaining > 1e-9) {
      const rho = this.depth()
      const extra = rho > 0 ? remaining / rho : 0
      const ovp = isBuy ? worst + extra : worst - extra
      cost += remaining * (worst + ovp) / 2; filled += remaining; worst = ovp
    }
    const avg = filled > 0 ? cost / filled : this.price
    return { price: this.r(clamp(avg, this.price * 0.5, this.price * 2)), userQty }
  }
  // compact top-of-book for the client (real bot liquidity, per level)
  bookSnapshot() {
    const top = (map, isAsk) => [...map.values()]
      .sort((a, b) => (isAsk ? a.price - b.price : b.price - a.price))
      .slice(0, BOOK_SEND)
      .map((l) => ({ p: l.price, q: Math.max(0, Math.round(l.qty * 1e6) / 1e6) }))
    return { tick: this.bookTick(), asks: top(this.asks, true), bids: top(this.bids, false) }
  }

  botEntries() {
    return this.bots.map((b) => {
      const pnl = unrealizedPnl(b.side, b.entry, this.price, b.qty)
      return {
        name: b.name, symbol: this.symbol,
        equity: Math.max(0, b.margin + pnl),
        pnl, roe: (pnl / b.margin) * 100,
        side: b.side, lev: b.leverage, bot: true,
      }
    })
  }

  mapEntries() {
    const arr = this.bots.map((b) => ({ liq: b.liq, side: b.side, notional: b.margin * b.leverage }))
    for (const b of this.books.values()) {
      if (b.position) arr.push({ liq: b.position.liq, side: b.position.side, notional: b.position.margin * b.position.leverage, real: true })
    }
    return arr
  }

  dcaInto(pos, addQty, addEntry, addMargin) {
    pos.deposit = round2((pos.deposit ?? pos.margin) + addMargin)
    const nq = pos.qty + addQty
    pos.entry = this.r((pos.entry * pos.qty + addEntry * addQty) / nq)
    pos.qty = this.rq(nq)
    pos.margin = Math.round((pos.margin + addMargin) * 100) / 100
    pos.leverage = clamp(Math.round((pos.qty * pos.entry) / pos.margin), 1, 100)
    pos.liq = this.r(liquidationPrice(pos.side, pos.entry, pos.leverage))
  }

  restingOrders() {
    const out = []
    for (const b of this.books.values()) {
      for (const o of b.pendingOrders) {
        const rem = o.qty - o.filled
        if (rem > 1e-9) out.push({ p: this.r(o.price), s: o.side === 'long' ? 1 : 0, q: this.rq(rem) })
      }
    }
    return out
  }

  // fills (part of) a resting user limit order; returns the qty actually filled
  fillLimitOrder(uid, book, o, df, userEvents) {
    df = Math.min(df, o.qty - o.filled)
    if (df <= 1e-12) return 0
    const entry = o.price
    const marginShare = o.margin * (df / o.qty)
    const feeShare = (o.fee || 0) * (df / o.qty) // maker fee, reserved when the order was placed
    if (!book.position) {
      book.position = {
        side: o.side, entry: this.r(entry), leverage: o.leverage,
        margin: round2(marginShare), deposit: round2(marginShare), fees: feeShare, funding: 0,
        qty: this.rq(df), sl: o.sl, tp: o.tp,
        liq: this.r(liquidationPrice(o.side, entry, o.leverage)), openedAt: Date.now(),
      }
    } else if (book.position.side === o.side) {
      this.dcaInto(book.position, df, entry, marginShare)
      book.position.fees = (book.position.fees || 0) + feeShare
    } else {
      return 0
    }
    this.feesCollected += feeShare
    o.filled += df
    const done = o.qty - o.filled <= 1e-9
    if (done) book.pendingOrders = book.pendingOrders.filter((x) => x.id !== o.id)
    userEvents.push({ userId: uid, symbol: this.symbol, event: { type: 'limitFill', symbol: this.symbol, side: o.side, price: entry, partial: !done, id: Date.now() + Math.random() } })
    return df
  }

  mm(cmd, payload = {}) {
    const p = this.price
    switch (cmd) {
      case 'pump':
        this.pendingFlow += 0.04 * p * this.depth(); this.chopTicks = 0; this.drift = 0; break
      case 'dump':
        this.pendingFlow -= 0.04 * p * this.depth(); this.chopTicks = 0; this.drift = 0; break
      case 'chop':
        this.chopTicks = 90; this.queue = []; this.drift = 0; this.spike = false; break
      case 'calm':
        this.queue = []; this.chopTicks = 0; this.drift = 0; this.spike = false; this.pendingFlow = 0; break
      case 'hunt': {
        const pools = liquidityPools(this.mapEntries(), p)
        const best = densestPool(pools, p, 0.08)
        const level = best ? best.price : p * (Math.random() < 0.5 ? 0.975 : 1.025)
        this.queue = wick(p, level); this.spike = true; this.chopTicks = 0; this.drift = 0; break
      }
      case 'force':
        this.drift = clamp(+payload.v || 0, -1, 1) * 0.006; break
      case 'nudge':
        this.pendingFlow += (payload.dir > 0 ? 1 : -1) * NUDGE_FLOW * this.pf(); break
      case 'drive':
        if (payload.target > 0) { this.pendingFlow += (+payload.target - p) * this.depth(); this.drift = 0; this.chopTicks = 0 }
        break
      case 'auto':
        this.autoHunt = !this.autoHunt; this.autoCd = 12; break
      case 'reset':
        this.reset(false); break
      case 'rebase':
        this.rebase(payload.target); break
    }
  }

  // Advance one tick for THIS market; resolve its books + bots.
  step() {
    const prev = this.price
    let queue = this.queue
    let chopTicks = this.chopTicks
    let spike = this.spike
    const rho = this.depth()
    const pf = this.pf() // scales BTC-tuned coin-flow constants to this market

    let dPrice = 0
    let flowVol = 0

    const cap = Math.max(MIN_FILL * pf, Math.abs(this.pendingFlow) * FILL_FRAC)
    const exec = clamp(this.pendingFlow, -cap, cap)
    this.pendingFlow = Math.round((this.pendingFlow - exec) * 1e6) / 1e6
    dPrice += exec / rho
    flowVol += Math.abs(exec)

    if (queue.length) {
      const cur = prev + dPrice
      const seg = queue[0]
      const dir = Math.sign(seg.target - cur) || 1
      const dist = Math.abs(seg.target - cur)
      let stepD
      if (dist <= seg.step) { stepD = seg.target - cur; queue = queue.slice(1) }
      else stepD = dir * seg.step
      dPrice += stepD
      flowVol += Math.abs(stepD) * rho
    } else if (chopTicks > 0) {
      const f = (Math.random() * 2 - 1) * AMBIENT_FLOW * 2.2 * pf
      dPrice += f / rho; flowVol += Math.abs(f); chopTicks -= 1
    } else {
      const f = ((Math.random() * 2 - 1) * AMBIENT_FLOW + (this.drift / 0.006) * DRIFT_FLOW) * pf
      dPrice += f / rho; flowVol += Math.abs(f)
    }
    if (queue.length === 0) spike = false

    dPrice += (this.anchor - prev) * 0.0006
    let newPrice = clamp(this.r(prev + dPrice), this.anchor * 0.5, this.anchor * 2)
    this.anchor = clamp(this.anchor * (1 + (Math.random() - 0.5) * 0.0004) + (newPrice - this.anchor) * 0.0003, this.seedPrice * 0.4, this.seedPrice * 2.4)
    this.momentum = this.momentum * 0.94 + (newPrice / prev - 1) * 0.06

    // real resting limit orders act as support/resistance and fill over ticks
    const limitFills = []
    {
      const desired = newPrice
      const down = desired < prev
      const up = desired > prev
      if (down || up) {
        const walls = []
        for (const [uid, book] of this.books) {
          for (const o of book.pendingOrders) {
            if (o.qty - o.filled <= 1e-9) continue
            if (down && o.side === 'long' && o.price <= prev && o.price >= desired) walls.push({ uid, book, o, P: o.price })
            else if (up && o.side === 'short' && o.price >= prev && o.price <= desired) walls.push({ uid, book, o, P: o.price })
          }
        }
        walls.sort((a, b) => (down ? b.P - a.P : a.P - b.P))
        let cur = desired
        for (const w of walls) {
          const remaining = w.o.qty - w.o.filled
          const beyond = (down ? w.P - cur : cur - w.P) * rho
          if (beyond <= 1e-12) continue
          if (remaining >= beyond) {
            limitFills.push({ uid: w.uid, book: w.book, o: w.o, df: beyond })
            flowVol += beyond
            cur = w.P
            break
          }
          limitFills.push({ uid: w.uid, book: w.book, o: w.o, df: remaining })
          flowVol += remaining
          const leftover = beyond - remaining
          cur = down ? w.P - leftover / rho : w.P + leftover / rho
        }
        newPrice = this.r(clamp(cur, this.anchor * 0.5, this.anchor * 2))
      }
    }

    // Marketable sweep: the wall pass above only fills on an ACTIVE single-tick
    // cross. A fast move / whale wick can leave price on the fillable side of a
    // resting order without such a cross — a buy limit stranded ABOVE the market
    // (or a sell BELOW it). Those are immediately executable, so fill them here so
    // an order can never sit, unfilled, on the wrong side of price.
    {
      const touched = new Set(limitFills.map((f) => f.o.id))
      const eps = newPrice * 1e-9 // ignore exact-at-price pins (support/resistance)
      for (const [uid, book] of this.books) {
        for (const o of book.pendingOrders) {
          if (o.qty - o.filled <= 1e-9 || touched.has(o.id)) continue
          const marketable = o.side === 'long' ? o.price > newPrice + eps : o.price < newPrice - eps
          if (marketable) limitFills.push({ uid, book, o, df: o.qty - o.filled })
        }
      }
    }

    let baseCurrent = {
      ...this.baseCurrent,
      close: newPrice,
      high: Math.max(this.baseCurrent.high, newPrice),
      low: Math.min(this.baseCurrent.low, newPrice),
      volume: Math.round(((this.baseCurrent.volume || 0) + flowVol) * 100) / 100,
    }
    let finalized = null
    const bucket = nowBucket()
    if (bucket > baseCurrent.time) {
      finalized = baseCurrent
      this.base.push(baseCurrent)
      if (this.base.length > BASE_CAP) this.base = this.base.slice(-BASE_CAP)
      baseCurrent = { time: bucket, open: newPrice, high: newPrice, low: newPrice, close: newPrice, volume: 0 }
    }
    this.baseCurrent = baseCurrent

    // resolve real traders' positions in this market
    // maker fills that happened between ticks (market orders hitting user limits)
    const userEvents = this.makerEvents
    this.makerEvents = []
    if (Date.now() / 1000 >= this.nextFunding) {
      this.applyFunding(userEvents)
      this.nextFunding = (Math.floor(Date.now() / 1000 / FUNDING_INTERVAL) + 1) * FUNDING_INTERVAL
    }
    let liqLong = 0
    let liqShort = 0
    for (const [uid, book] of this.books) {
      const pos = book.position
      if (!pos) continue
      if (pos.trail) {
        if (pos.side === 'long') {
          if (newPrice > pos.trail.anchor) pos.trail.anchor = newPrice
          pos.trailLevel = this.r(pos.trail.anchor * (1 - pos.trail.pct))
        } else {
          if (newPrice < pos.trail.anchor) pos.trail.anchor = newPrice
          pos.trailLevel = this.r(pos.trail.anchor * (1 + pos.trail.pct))
        }
      }
      let hit = firstHit(prev, newPrice, pos)
      // already through liq without a crossing this tick (funding just moved it)
      if (!hit && (pos.side === 'long' ? newPrice <= pos.liq : newPrice >= pos.liq)) hit = { level: 'liq', price: newPrice }
      if (!hit) continue
      const exit = hit.price
      const { credit, net, closeFee, record } = closeOut(pos, exit, hit.level, this.symbol, (n) => this.r(n))
      if (hit.level === 'liq') { this.harvested += pos.margin; this.liquidatedTotal += 1 }
      this.feesCollected += closeFee
      this.pendingFlow += pos.side === 'long' ? -pos.qty : pos.qty
      this.settle(uid, { credit, pnl: net, record })
      userEvents.push({ userId: uid, symbol: this.symbol, event: { type: hit.level, symbol: this.symbol, side: pos.side, pnl: record.pnl, fee: record.fee, price: this.r(exit), id: Date.now() + Math.random() } })
      book.position = null
      this.dropIfEmpty(uid)
    }

    for (const { uid, book, o, df } of limitFills) this.fillLimitOrder(uid, book, o, df, userEvents)

    // resolve bots
    const survivors = []
    for (const b of this.bots) {
      const hit = firstHit(prev, newPrice, b)
      if (!hit) { survivors.push(b); continue }
      this.pendingFlow += b.side === 'long' ? -b.qty : b.qty
      if (hit.level === 'sl') continue
      this.harvested += b.margin
      this.liquidatedTotal += 1
      if (b.side === 'long') liqLong += 1
      else liqShort += 1
    }
    this.bots = survivors

    let realLiqs = 0
    for (const ue of userEvents) if (ue.event.type === 'liq') { realLiqs++; if (ue.event.side === 'long') liqLong++; else liqShort++ }
    const liqCount = liqLong + liqShort
    let liqEvent = null
    if (liqCount > 0) liqEvent = { id: Date.now() + Math.random(), count: liqCount, side: liqLong >= liqShort ? 'long' : 'short' }

    const pLong = clamp(0.5 + this.momentum * 50, 0.12, 0.88)
    if (this.bots.length > BOT_TARGET * 0.5 && Math.random() < 0.08) {
      const idx = (Math.random() * this.bots.length) | 0
      const b = this.bots[idx]
      if (unrealizedPnl(b.side, b.entry, newPrice, b.qty) > b.margin * 0.6) this.bots.splice(idx, 1)
    }
    let spawn = 0
    if (this.bots.length < BOT_TARGET * 0.5) spawn = 5
    else if (this.bots.length < BOT_TARGET && Math.random() < 0.75) spawn = 1 + ((Math.random() * 3) | 0)
    for (let i = 0; i < spawn && this.bots.length < BOT_MAX; i++) this.bots.push(this.makeBot(newPrice, pLong))

    if (this.autoHunt && queue.length === 0 && chopTicks === 0 && !spike) {
      this.autoCd -= 1
      if (this.autoCd <= 0) {
        const entries = this.mapEntries()
        const longOI = entries.reduce((s, e) => s + (e.side === 'long' ? e.notional : 0), 0)
        const shortOI = entries.reduce((s, e) => s + (e.side === 'short' ? e.notional : 0), 0)
        const ratio = longOI / (shortOI || 1)
        const roll = Math.random()
        if (ratio > 1.35 || ratio < 0.74 || roll < 0.55) {
          const best = densestPool(liquidityPools(entries, newPrice), newPrice, 0.06)
          const level = best ? best.price : newPrice * (ratio >= 1 ? 0.975 : 1.025)
          queue = wick(newPrice, level); spike = true
        } else if (roll < 0.78) {
          queue = [{ target: this.r(newPrice * 1.025), step: newPrice * 0.006 }]
        } else {
          queue = [{ target: this.r(newPrice * 0.975), step: newPrice * 0.006 }]
        }
        this.autoCd = 24 + ((Math.random() * 30) | 0)
      }
    } else if (this.autoHunt && this.autoCd < 8) {
      this.autoCd = 8 + ((Math.random() * 20) | 0)
    }

    this.price = newPrice
    this.queue = queue
    this.chopTicks = chopTicks
    this.spike = spike
    this.updateBook() // regrow / recenter the resting bot ladder around the new price

    return { symbol: this.symbol, price: newPrice, baseCurrent: this.baseCurrent, finalized, liqEvent, userEvents }
  }

  crowd() {
    const entries = this.mapEntries()
    let longOI = 0, shortOI = 0
    for (const e of entries) { if (e.side === 'long') longOI += e.notional; else shortOI += e.notional }
    let realTraders = 0
    for (const b of this.books.values()) if (b.position) realTraders++
    return {
      symbol: this.symbol,
      traders: this.bots.length,
      realTraders,
      longOI: Math.round(longOI),
      shortOI: Math.round(shortOI),
      harvested: Math.round(this.harvested),
      liquidatedTotal: this.liquidatedTotal,
      autoHunt: this.autoHunt,
      fees: Math.round(this.feesCollected),
      funding: { rate: this.fundingRate(), next: this.nextFunding },
    }
  }

  mapData() {
    return this.mapEntries().map((e) => ({ l: this.r(e.liq), s: e.side === 'long' ? 1 : 0, n: Math.round(e.notional), r: e.real ? 1 : 0 }))
  }

  // 24h change from the live base (~1440 1m bars ago), falling back to deep history
  change24h() {
    const ref = this.base.length ? this.base[Math.max(0, this.base.length - 1440)].open : this.price
    return ref ? ((this.price - ref) / ref) * 100 : 0
  }

  // compact ticker for the markets list / top bar
  ticker() {
    return {
      symbol: this.symbol, name: this.name, base: this.baseAsset, dp: this.dp,
      price: this.r(this.price), change: Math.round(this.change24h() * 100) / 100,
      spark: this.spark(),
    }
  }

  // ~24 points sampled from the last day of hourly-ish data for a sparkline
  spark() {
    const src = this.base
    if (!src.length) return []
    const n = 24
    const span = Math.min(src.length, 1440)
    const start = src.length - span
    const step = Math.max(1, Math.floor(span / n))
    const out = []
    for (let i = start; i < src.length; i += step) out.push(this.r(src[i].close))
    return out.slice(-n)
  }

  snapshot() {
    return {
      symbol: this.symbol,
      base: this.base,
      deep: this.deep,
      baseCurrent: this.baseCurrent,
      price: this.price,
      dp: this.dp,
      baseAsset: this.baseAsset,
      epoch: this.epoch,
      crowd: this.crowd(),
      resting: this.restingOrders(),
      book: this.bookSnapshot(),
    }
  }
}

export { qtyFromMargin, liquidationPrice, unrealizedPnl, closeOut }
