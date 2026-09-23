import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
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
  app.use(express.static(dist))
  app.get(/.*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
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
  try { if (hub.market(row.symbol)?.restore(JSON.parse(row.state))) restored++ }
  catch (e) { console.warn(`market ${row.symbol} restore failed:`, e.message) }
}
if (restored) console.log(`Restored ${restored} market(s) from the last run`)

const saveMarket = (symbol) => {
  const m = hub.market(symbol)
  if (!m) return Promise.resolve()
  return Promise.resolve(storage.saveMarket(symbol, JSON.stringify(m.serialize()))).catch((e) =>
    console.warn(`saveMarket ${symbol} failed:`, e.message)
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
  const client = { ws, user: { ...auth, id }, symbol }
  clients.add(client)

  if (auth.role === 'trader') hub.addUser(id, auth.name, await getAccount(auth.name))

  send(ws, {
    type: 'welcome',
    user: auth,
    symbol,
    tickers: hub.tickers(),
    ...hub.snapshot(symbol),
    me: auth.role === 'trader' ? hub.userState(id) : null,
    map: auth.role === 'host' ? hub.mapData(symbol) : undefined,
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
      send(ws, { type: 'snap', ...hub.snapshot(m.symbol) })
      if (role === 'host') send(ws, { type: 'map', s: m.symbol, map: hub.mapData(m.symbol) })
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
    } else if (role === 'host' && m.type === 'mm') {
      hub.mm(sym, m.cmd, m.payload || {})
      if (m.cmd === 'reset') {
        flushDirty()
        saveMarket(sym)
        send(ws, { type: 'snap', ...hub.snapshot(sym) })
        for (const c of clients) if (c.user.role === 'trader') send(c.ws, meMsg(c.user.id))
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
setInterval(() => {
  const deltas = hub.tick()
  frame++
  const bySym = new Map()
  for (const d of deltas) bySym.set(d.symbol, d)

  // per-symbol market stream → only clients viewing that symbol
  for (const c of clients) {
    const d = bySym.get(c.symbol)
    if (d) send(c.ws, { type: 'm', s: d.symbol, p: d.price, bc: d.baseCurrent, f: d.finalized || undefined, liq: d.liqEvent || undefined })
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
  // market state: one symbol every 5s (round-robin) so a big write never stalls a tick
  if (frame % 20 === 0) { const syms = hub.symbols(); saveMarket(syms[(frame / 20) % syms.length]) }

  // lightweight all-symbol price ticks for the markets list / top bar
  if (frame % 2 === 0) broadcast({ type: 'ticks', ticks: hub.priceTicks() })
  // per-symbol crowd + resting book for the viewer's market
  if (frame % 2 === 0) {
    for (const c of clients) {
      send(c.ws, { type: 'c', s: c.symbol, crowd: hub.crowd(c.symbol), resting: hub.restingOrders(c.symbol), book: hub.bookSnapshot(c.symbol) })
      if (c.user.role === 'host') send(c.ws, { type: 'map', s: c.symbol, map: hub.mapData(c.symbol) })
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
      ...hub.symbols().map(saveMarket),
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
