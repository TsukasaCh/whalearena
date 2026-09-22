import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { MarketHub } from './engine.js'
import { TICK_MS, DEFAULT_SYMBOL } from './constants.js'
import { initStorage } from './storage.js'
import { register, login, hostLogin, verify, getAccount, saveAccount, topTraders } from './auth.js'

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

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)) }
const broadcast = (obj, filter) => {
  const msg = JSON.stringify(obj)
  for (const c of clients) if ((!filter || filter(c)) && c.ws.readyState === 1) c.ws.send(msg)
}

const persist = (uid) => {
  const u = hub.getUser(uid)
  if (u) saveAccount(u.name, { balance: u.balance, trades: u.trades, wins: u.wins, realized: u.realized })
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
  const live = new Map()
  for (const c of clients) {
    if (c.user.role === 'trader') live.set(c.user.name.toLowerCase(), { name: c.user.name, equity: hub.userEquity(c.user.id), pnl: hub.userUnrealized(c.user.id) })
  }
  const seen = new Set()
  const humans = humanRows.map((r) => {
    const key = r.name.toLowerCase()
    seen.add(key)
    const l = live.get(key)
    return { name: r.name, equity: l ? l.equity : r.balance, pnl: l ? l.pnl : 0, online: !!l, bot: false }
  })
  for (const [key, l] of live) if (!seen.has(key)) humans.push({ name: l.name, equity: l.equity, pnl: l.pnl, online: true, bot: false })
  // real users only — the bot crowd populates the market & order book, not the board
  humans.sort((a, b) => b.equity - a.equity)
  return humans.slice(0, 25)
}

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://x')
  const auth = verify(url.searchParams.get('token'))
  if (!auth) { send(ws, { type: 'authFail' }); ws.close(); return }
  const id = Math.random().toString(36).slice(2)
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
        send(ws, { type: 'snap', ...hub.snapshot(sym) })
        for (const c of clients) if (c.user.role === 'trader') send(c.ws, meMsg(c.user.id))
      }
    }
  })

  ws.on('close', () => {
    clients.delete(client)
    if (auth.role === 'trader') { persist(id); hub.removeUser(id) }
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
      for (const c of clients) if (c.user.id === ue.userId) send(c.ws, meMsg(ue.userId, ue.event))
    }
  }
  for (const uid of touched) persist(uid)
  flushDirty()

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

server.listen(PORT, () => {
  console.log(`🐋 Whale Arena server on http://localhost:${PORT}  (ws: /ws)`)
  console.log(`   Storage: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'} · Host code: ${process.env.WHALE_HOST_CODE ? '(from env)' : 'whale-god'}`)
})
