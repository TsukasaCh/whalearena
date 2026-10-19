import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join, sep as pathSep } from 'path'
import { existsSync } from 'fs'
import { MarketHub } from './engine.js'
import { TICK_MS, DEFAULT_SYMBOL } from './constants.js'
import { initStorage, storage } from './storage.js'
import { register, login, hostLogin, verify, getAccount, activeAccounts, saveAccount, topTraders, HOST_CODE, HOST_CODE_FROM_ENV } from './auth.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 8787

await initStorage()

const app = express()
app.use(express.json())

app.post('/api/register', async (req, res) => res.json(await register(req.body?.username, req.body?.password)))
app.post('/api/login', async (req, res) => res.json(await login(req.body?.username, req.body?.password)))
app.post('/api/host', (req, res) => res.json(hostLogin(req.body?.code)))

const dist = join(__dir, '..', 'dist')
if (existsSync(dist)) {
  // Hashed asset filenames change every build, so cache them hard — but NEVER
  // cache index.html, or a browser keeps loading an old bundle after a rebuild.
  app.use(express.static(dist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
      else if (filePath.includes(`${pathSep}assets${pathSep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    },
  }))
  app.get(/.*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(join(dist, 'index.html'))
  })
}

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: true })

const hub = new MarketHub()
const clients = new Set()
const accountId = (name) => (name || '').toLowerCase()

// resume each market's price + candle history from the last run (before any
// positions are loaded, so they pick up at the price they were left at)
let restored = 0
for (const row of await storage.loadMarkets()) {
  try { if (hub.marketByKey(row.symbol)?.restore(JSON.parse(row.state))) restored++ }
  catch (e) { console.warn(`market ${row.symbol} restore failed:`, e.message) }
}
if (restored) console.log(`Restored ${restored} market(s) from the last run`)

const saveMarket = (venueKey) => {
  const m = hub.marketByKey(venueKey)
  if (!m) return Promise.resolve()
  return Promise.resolve(storage.saveMarket(venueKey, JSON.stringify(m.serialize()))).catch((e) =>
    console.warn(`saveMarket ${venueKey} failed:`, e.message)
  )
}

// bring back every account that had open positions / resting limits when the
// server last stopped, so they keep filling / hitting SL-TP with nobody online
for (const a of await activeAccounts()) hub.addUser(accountId(a.name), a.name, a)

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)) }
const broadcast = (obj, filter) => {
  const msg = JSON.stringify(obj)
  for (const c of clients) if ((!filter || filter(c)) && c.ws.readyState === 1) c.ws.send(msg)
}

const persist = (uid) => {
  const u = hub.getUser(uid)
  return u ? saveAccount(u.name, hub.persistState(uid)) : Promise.resolve()
}
const flushDirty = () => {
  if (!hub.dirty.size) return
  for (const uid of hub.dirty) persist(uid)
  hub.dirty.clear()
}
const meMsg = (uid, event) => ({ type: 'me', ...hub.userState(uid), event })

// ── leaderboard (persisted balances + live equity for the connected) ─────────
let humanRows = []
const refreshHumans = async () => { try { humanRows = await topTraders(60) } catch (e) { /* keep last */ } }
refreshHumans()
setInterval(refreshHumans, 4000)

function buildLeaderboard() {
  const online = new Set()
  for (const c of clients) if (c.user.role === 'trader') online.add(c.user.id)
  // every account loaded in the hub (online or with positions still running offline)
  const live = new Map()
  for (const u of hub.users.values()) live.set(u.id, { name: u.name, equity: hub.userEquity(u.id), pnl: hub.userUnrealized(u.id), online: online.has(u.id) })
  const seen = new Set()
  const humans = humanRows.map((r) => {
    const key = r.name.toLowerCase()
    seen.add(key)
    const l = live.get(key)
    return { name: r.name, equity: l ? l.equity : r.balance, pnl: l ? l.pnl : 0, online: !!l?.online, bot: false }
  })
  for (const [key, l] of live) if (!seen.has(key)) humans.push({ name: l.name, equity: l.equity, pnl: l.pnl, online: l.online, bot: false })
  // real users only — the bot crowd populates the market & order book, not the board
  humans.sort((a, b) => b.equity - a.equity)
  return humans.slice(0, 25)
}

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://x')
  const auth = verify(url.searchParams.get('token'))
  if (!auth) { send(ws, { type: 'authFail' }); ws.close(); return }
  // traders are keyed by account so a refresh / second tab reattaches to the SAME
  // live positions; the host has no wallet, a per-connection id is fine there
  const id = auth.role === 'trader' ? accountId(auth.name) : 'host:' + Math.random().toString(36).slice(2)
  const symbol = DEFAULT_SYMBOL
  const client = { ws, user: { ...auth, id }, symbol, mode: 'perp' }
  clients.add(client)

  if (auth.role === 'trader') hub.addUser(id, auth.name, await getAccount(auth.name))

  send(ws, {
    type: 'welcome',
    user: auth,
    symbol,
    mode: client.mode,
    tickers: hub.tickers(),
    ...hub.snapshot(symbol, client.mode),
    me: auth.role === 'trader' ? hub.userState(id) : null,
    map: auth.role === 'host' ? hub.mapData(symbol, client.mode) : undefined,
    lb: buildLeaderboard(),
  })

  ws.on('message', (raw) => {
    let m
    try { m = JSON.parse(raw) } catch { return }
    const role = auth.role
    const sym = m.symbol || client.symbol

    if (m.type === 'sub') {
      if (!hub.hasSymbol(m.symbol)) return
      client.symbol = m.symbol
      client.mode = m.mode === 'spot' ? 'spot' : 'perp'
      send(ws, { type: 'snap', ...hub.snapshot(m.symbol, client.mode) })
      if (role === 'host') send(ws, { type: 'map', s: m.symbol, md: client.mode, map: hub.mapData(m.symbol, client.mode) })
      return
    }

    if (role === 'trader') {
      if (m.type === 'open') {
        const r = hub.openPosition(id, sym, m)
        if (!r.ok) return send(ws, { type: 'orderError', error: r.error })
        persist(id); send(ws, meMsg(id))
      } else if (m.type === 'close') {
        const r = hub.closePosition(id, sym)
        if (r.ok) { persist(id); send(ws, meMsg(id, r.event)) }
      } else if (m.type === 'spotBuy') {
        const r = hub.spotBuy(id, sym, m)
        if (!r.ok) return send(ws, { type: 'orderError', error: r.error })
        persist(id); send(ws, meMsg(id, r.event))
      } else if (m.type === 'spotSell') {
        const r = hub.spotSell(id, sym, m)
        if (!r.ok) return send(ws, { type: 'orderError', error: r.error })
        persist(id); send(ws, meMsg(id, r.event))
      } else if (m.type === 'spotLimit') {
        const r = hub.spotLimit(id, sym, m)
        if (!r.ok) return send(ws, { type: 'orderError', error: r.error })
        persist(id); send(ws, meMsg(id, r.event))
      } else if (m.type === 'spotCancelLimit') {
        const r = hub.spotCancelLimit(id, sym, m.id)
        if (r.ok) { persist(id); send(ws, meMsg(id)) }
      } else if (m.type === 'spotMoveLimit') {
        const r = hub.spotMoveLimit(id, sym, m.id, m.price)
        if (!r.ok && r.error) send(ws, { type: 'orderError', error: r.error })
        send(ws, meMsg(id))
      } else if (m.type === 'stake') {
        const r = hub.stake(id, sym, m)
        if (!r.ok) return send(ws, { type: 'orderError', error: r.error })
        persist(id); send(ws, meMsg(id, r.event))
      } else if (m.type === 'unstake') {
        const r = hub.unstake(id, sym, m)
        if (!r.ok) return send(ws, { type: 'orderError', error: r.error })
        persist(id); send(ws, meMsg(id, r.event))
      } else if (m.type === 'modify') {
        const r = hub.modify(id, sym, m)
        if (r.ok) send(ws, meMsg(id))
      } else if (m.type === 'limit') {
        const r = hub.placeLimit(id, sym, m)
        if (!r.ok) return send(ws, { type: 'orderError', error: r.error })
        persist(id); send(ws, meMsg(id))
      } else if (m.type === 'cancelLimit') {
        const r = hub.cancelLimit(id, sym, m.id)
        if (r.ok) { persist(id); send(ws, meMsg(id)) }
      } else if (m.type === 'moveLimit') {
        const r = hub.moveLimit(id, sym, m.id, m.price)
        if (!r.ok && r.error) send(ws, { type: 'orderError', error: r.error })
        // echo current state either way so a rejected drag reverts the ghost line
        send(ws, meMsg(id))
      }
    } else if (role === 'host' && m.type === 'adminFund') {
      // Whale power: credit or set ANY account's balance (host-gated only).
      const name = (m.name || '').trim()
      const amt = Number(m.amount)
      const fundMode = m.fundMode === 'set' ? 'set' : 'add'
      if (!name || !Number.isFinite(amt)) return send(ws, { type: 'orderError', error: 'Nama atau jumlah tidak valid' })
      const key = accountId(name)
      ;(async () => {
        const row = await storage.findUser(key)
        if (!row) return send(ws, { type: 'orderError', error: `Akun "${name}" tidak ditemukan` })
        let u = hub.getUser(key)
        if (!u) u = hub.addUser(key, row.name, await getAccount(row.name)) // load offline account
        const balance = hub.fundUser(key, amt, fundMode)
        await persist(key)
        send(ws, { type: 'adminResult', name: row.name, balance, fundMode })
        // push the new wallet to the target if they're online right now
        for (const c of clients) if (c.user.role === 'trader' && c.user.id === key) send(c.ws, meMsg(key))
      })().catch((e) => send(ws, { type: 'orderError', error: 'Gagal: ' + e.message }))
    } else if (role === 'host' && m.type === 'mm') {
      hub.mm(sym, m.cmd, m.payload || {})
      if (m.cmd === 'reset' || m.cmd === 'rebase') {
        // host manipulates the FUTURES venue: its history changed, so perp
        // viewers of this symbol reload it (spot keeps running, coupling re-tethers)
        flushDirty()
        saveMarket(hub.vkey(sym, 'perp'))
        const snap = { type: 'snap', ...hub.snapshot(sym, 'perp') }
        for (const c of clients) {
          if (c.symbol === sym && c.mode === 'perp') send(c.ws, snap)
          if (c.user.role === 'trader') send(c.ws, meMsg(c.user.id))
        }
        broadcast({ type: 'tickers', tickers: hub.tickers() })
      }
    }
  })

  ws.on('close', () => {
    clients.delete(client)
    // positions + resting limits stay live in the hub after disconnect — just checkpoint them
    if (auth.role === 'trader') persist(id)
  })
})

let frame = 0
// staking rewards are credited on the hour, every hour (like a real exchange)
let nextStakePayout = Math.floor(Date.now() / 3600000) * 3600000 + 3600000
setInterval(() => {
  const deltas = hub.tick()
  frame++

  // hourly staking payout → realize rewards into every staker's balance
  if (Date.now() >= nextStakePayout) {
    nextStakePayout = Math.floor(Date.now() / 3600000) * 3600000 + 3600000
    for (const { userId, usd } of hub.settleStaking()) {
      persist(userId)
      for (const c of clients) if (c.user.role === 'trader' && c.user.id === userId) send(c.ws, meMsg(userId, usd > 0 ? { type: 'stakeReward', amount: usd, id: Date.now() + Math.random() } : undefined))
    }
  }
  const byVenue = new Map()
  for (const d of deltas) byVenue.set(hub.vkey(d.symbol, d.mode), d)

  // per-venue market stream → only clients viewing that symbol+mode
  for (const c of clients) {
    const d = byVenue.get(hub.vkey(c.symbol, c.mode))
    if (d) send(c.ws, { type: 'm', s: d.symbol, md: d.mode, p: d.price, bc: d.baseCurrent, f: d.finalized || undefined, liq: d.liqEvent || undefined })
  }

  // wallet events (fills / liquidations / SL-TP) → push fresh user state + toast
  const touched = new Set()
  for (const d of deltas) {
    for (const ue of d.userEvents) {
      touched.add(ue.userId)
      for (const c of clients) if (c.user.role === 'trader' && c.user.id === ue.userId) send(c.ws, meMsg(ue.userId, ue.event))
    }
  }
  for (const uid of touched) persist(uid)
  flushDirty()
  // periodic checkpoint of open books (trailing-stop anchors move without events)
  if (frame % 40 === 0) for (const uid of hub.activeUserIds()) persist(uid)
  // market state: one venue every 5s (round-robin) so a big write never stalls a tick
  if (frame % 20 === 0) { const keys = hub.venueKeys(); saveMarket(keys[(frame / 20) % keys.length]) }

  // lightweight all-symbol price ticks for the markets list / top bar
  if (frame % 2 === 0) broadcast({ type: 'ticks', ticks: hub.priceTicks() })
  // per-venue crowd + resting book for the viewer's market
  if (frame % 2 === 0) {
    for (const c of clients) {
      send(c.ws, { type: 'c', s: c.symbol, md: c.mode, crowd: hub.crowd(c.symbol, c.mode), resting: hub.restingOrders(c.symbol, c.mode), book: hub.bookSnapshot(c.symbol, c.mode) })
      if (c.user.role === 'host') send(c.ws, { type: 'map', s: c.symbol, md: c.mode, map: hub.mapData(c.symbol, c.mode) })
    }
  }
  if (frame % 4 === 0) broadcast({ type: 'lb', lb: buildLeaderboard() })
  // refresh full tickers (names + sparklines) occasionally
  if (frame % 40 === 0) broadcast({ type: 'tickers', tickers: hub.tickers() })
}, TICK_MS)

// graceful stop (Ctrl+C / docker stop): checkpoint every market + open book first
let stopping = false
const shutdown = async (sig) => {
  if (stopping) return
  stopping = true
  console.log(`${sig} — saving market state…`)
  try {
    await Promise.all([
      ...hub.venueKeys().map(saveMarket),
      ...[...hub.users.keys()].map((uid) => persist(uid)),
    ])
    await storage.close()
  } catch (e) { console.warn('shutdown save failed:', e.message) }
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

server.listen(PORT, () => {
  console.log(`🐋 Whale Arena server on http://localhost:${PORT}  (ws: /ws)`)
  console.log(`   Storage: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'} · Host code: ${HOST_CODE_FROM_ENV ? '(from env)' : `${HOST_CODE}  (random — set WHALE_HOST_CODE to pin it)`}`)
})
