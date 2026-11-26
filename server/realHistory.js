// Real market history for the charts.
//
// At boot the server downloads recent candles for every listed coin from
// Binance's public market-data API (no key, no account, nothing about our users
// is sent) and keeps them in memory. Market.freshHistory() then uses their SHAPE
// — rescaled so the last close equals the game's own price — instead of
// generated candles, so the 3-month chart shows the coin's real moves.
//
// It is best effort: a coin that Binance doesn't list (or stopped trading), a
// blocked network or a timeout simply leaves that market on generated history.
// Set REAL_HISTORY=0 to skip the download entirely.
import { BASE_CAP, HIST_HOURS } from './constants.js'

const API = process.env.REAL_HISTORY_API || 'https://data-api.binance.vision/api/v3/klines'
const ENABLED = process.env.REAL_HISTORY !== '0'
const PAGE = 1000 // klines per request (API maximum)
const STALE_MS = 2 * 60 * 60 * 1000 // newest candle older than this → pair is not trading any more
const REQ_TIMEOUT = 8000
const TOTAL_TIMEOUT = 60000
const PARALLEL = 6

let reached = false // did ANY request get an HTTP answer during this load?
const cache = new Map() // symbol -> { m1: [bar], h1: [bar] }  bar = { t (sec), o, h, l, c, v }

export const getReal = (symbol) => cache.get(symbol) || null
export const realSymbols = () => [...cache.keys()]

const toBar = (k) => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })
const sane = (b) => b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0 && Number.isFinite(b.o + b.h + b.l + b.c + b.v)

async function page(pair, interval, endTime, deadline) {
  const left = deadline - Date.now()
  if (left <= 0) throw new Error('timeout')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), Math.min(REQ_TIMEOUT, left))
  try {
    const url = `${API}?symbol=${pair}&interval=${interval}&limit=${PAGE}${endTime ? `&endTime=${endTime}` : ''}`
    const res = await fetch(url, { signal: ctl.signal })
    reached = true
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const rows = await res.json()
    if (!Array.isArray(rows)) throw new Error('unexpected response')
    return rows.map(toBar).filter(sane)
  } finally {
    clearTimeout(timer)
  }
}

// newest `count` closed candles, oldest first (pages backwards from now)
async function series(pair, interval, count, deadline) {
  let out = []
  let end = 0
  while (out.length < count) {
    const rows = await page(pair, interval, end, deadline)
    if (!rows.length) break
    out = rows.concat(out)
    end = rows[0].t * 1000 - 1
    if (rows.length < PAGE) break // reached the start of the pair's history
  }
  // drop duplicates / out-of-order rows defensively, then the still-forming last candle
  const seen = new Set()
  out = out.filter((b) => (seen.has(b.t) ? false : seen.add(b.t))).sort((a, b) => a.t - b.t)
  out.pop()
  return out.slice(-count)
}

async function loadOne(symbol, deadline) {
  const pair = `${symbol}USDT`
  const m1 = await series(pair, '1m', BASE_CAP, deadline)
  if (m1.length < 720) throw new Error('not enough 1m history')
  if (Date.now() - m1[m1.length - 1].t * 1000 > STALE_MS) throw new Error('pair is no longer trading')
  // hourly candles for the months BEFORE the 1m window (plus slack for the overlap)
  const h1 = await series(pair, '1h', HIST_HOURS + Math.ceil(BASE_CAP / 60) + 24, deadline)
  cache.set(symbol, { m1, h1 })
}

// Download history for `symbols`. Never throws; resolves with what it managed.
export async function loadRealHistory(symbols) {
  if (!ENABLED) return { loaded: [], skipped: symbols.map((s) => [s, 'disabled']) }
  const deadline = Date.now() + TOTAL_TIMEOUT
  const queue = [...symbols]
  const loaded = []
  const skipped = []
  reached = false
  let dead = false // the host never answered: don't make the boot wait for every coin
  const worker = async () => {
    for (;;) {
      const sym = queue.shift()
      if (!sym) return
      if (dead) { skipped.push([sym, 'data source unreachable']); continue }
      try { await loadOne(sym, deadline); loaded.push(sym) }
      catch (e) {
        skipped.push([sym, e.name === 'AbortError' ? 'timeout' : e.message])
        if (!reached) dead = true
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  return { loaded, skipped }
}
