import { scryptSync, randomBytes } from 'crypto'
import { storage } from './storage.js'
import { INITIAL_BALANCE } from './constants.js'

// Gate for the Whale/admin login (/whale-god). Prefer the env var; otherwise
// generate a fresh random code each boot (printed to the server console) so the
// endpoint is never protected by a guessable default like the URL itself.
export const HOST_CODE = process.env.WHALE_HOST_CODE || randomBytes(6).toString('hex')
export const HOST_CODE_FROM_ENV = !!process.env.WHALE_HOST_CODE
const round = (n) => Math.round(n * 100) / 100

const tokens = new Map() // token -> { name, role } (in-memory; reset on restart)
const hash = (pw, salt) => scryptSync(pw, salt, 64).toString('hex')

function issue(name, role) {
  const token = randomBytes(24).toString('hex')
  tokens.set(token, { name, role })
  return { token, user: { name, role } }
}

export async function register(username, password) {
  username = (username || '').trim()
  if (username.length < 3) return { error: 'Username minimal 3 karakter' }
  if (username.length > 16) return { error: 'Username maksimal 16 karakter' }
  if ((password || '').length < 4) return { error: 'Password minimal 4 karakter' }
  const key = username.toLowerCase()
  if (key === 'whale' || (await storage.findUser(key))) return { error: 'Username sudah dipakai' }
  const salt = randomBytes(16).toString('hex')
  await storage.createUser({ nameKey: key, name: username, salt, hash: hash(password, salt), balance: INITIAL_BALANCE })
  return issue(username, 'trader')
}

export async function login(username, password) {
  const key = (username || '').trim().toLowerCase()
  const u = await storage.findUser(key)
  if (!u) return { error: 'Akun tidak ditemukan' }
  if (hash(password, u.salt) !== u.hash) return { error: 'Password salah' }
  return issue(u.name, 'trader')
}

export function hostLogin(code) {
  if ((code || '') !== HOST_CODE) return { error: 'Host code salah' }
  return issue('Whale', 'host')
}

export function verify(token) {
  return tokens.get(token) || null
}

const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback } catch { return fallback } }
const toAccount = (u) => ({
  name: u.name,
  balance: u.balance, trades: u.trades || 0, wins: u.wins || 0, realized: u.realized || 0,
  books: parse(u.books, {}), history: parse(u.history, []),
})

export async function getAccount(name) {
  const u = await storage.findUser((name || '').toLowerCase())
  if (!u) return { balance: INITIAL_BALANCE, trades: 0, wins: 0, realized: 0, books: {}, history: [] }
  return toAccount(u)
}

// every account that still has an open position / resting order — loaded at boot
// so those keep being managed (fills, SL/TP, liquidation) with nobody online
export async function activeAccounts() {
  return (await storage.activeUsers()).map(toAccount)
}

export function saveAccount(name, fields) {
  // fire-and-forget: market state stays authoritative in memory, the DB just
  // durably tracks the wallet. Never let a write error crash a tick.
  return Promise.resolve(storage.saveAccount((name || '').toLowerCase(), fields)).catch((e) =>
    console.warn('saveAccount failed:', e.message)
  )
}

export async function topTraders(limit = 10) {
  const rows = await storage.topTraders(limit)
  return rows.map((u) => ({ name: u.name, balance: u.balance, trades: u.trades || 0, wins: u.wins || 0, realized: u.realized || 0 }))
}
