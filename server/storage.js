// Persistence adapter. Uses PostgreSQL when DATABASE_URL is set (the docker
// compose path — a real DB running in a container, no manual setup), and falls
// back to an embedded SQLite file otherwise so `npm run dev`/`server` work with
// zero configuration. Both backends expose the same async interface.
import { INITIAL_BALANCE } from './constants.js'

const round = (n) => Math.round(n * 100) / 100
const USE_PG = !!process.env.DATABASE_URL

let backend

async function makeSqlite() {
  const { default: Database } = await import('better-sqlite3')
  const { readFileSync, existsSync, renameSync } = await import('fs')
  const { fileURLToPath } = await import('url')
  const { dirname, join } = await import('path')
  const __dir = dirname(fileURLToPath(import.meta.url))
  const DB_FILE = process.env.WHALE_DB || join(__dir, 'whale.db')
  const db = new Database(DB_FILE)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      name_key   TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      salt       TEXT NOT NULL,
      hash       TEXT NOT NULL,
      balance    REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name)
  const addCol = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`) }
  addCol('trades', 'trades INTEGER NOT NULL DEFAULT 0')
  addCol('wins', 'wins INTEGER NOT NULL DEFAULT 0')
  addCol('realized', 'realized REAL NOT NULL DEFAULT 0')

  // one-time migration from the legacy JSON store, if present
  const JSON_FILE = join(__dir, 'data.json')
  if (existsSync(JSON_FILE)) {
    try {
      const old = JSON.parse(readFileSync(JSON_FILE, 'utf8'))
      const ins = db.prepare('INSERT OR IGNORE INTO users (name_key,name,salt,hash,balance,created_at) VALUES (?,?,?,?,?,?)')
      const tx = db.transaction((users) => {
        let n = 0
        for (const [key, u] of Object.entries(users || {})) { ins.run(key, u.name, u.salt, u.hash, u.balance ?? INITIAL_BALANCE, Date.now()); n++ }
        return n
      })
      const n = tx(old.users)
      renameSync(JSON_FILE, JSON_FILE + '.migrated')
      console.log(`Migrated ${n} account(s) from data.json → SQLite (whale.db)`)
    } catch (e) { console.warn('data.json migration skipped:', e.message) }
  }

  const qGet = db.prepare('SELECT * FROM users WHERE name_key = ?')
  const qInsert = db.prepare('INSERT INTO users (name_key,name,salt,hash,balance,created_at) VALUES (?,?,?,?,?,?)')
  const qSave = db.prepare('UPDATE users SET balance=?, trades=?, wins=?, realized=? WHERE name_key=?')
  const qTop = db.prepare('SELECT name, balance, trades, wins, realized FROM users ORDER BY balance DESC LIMIT ?')

  return {
    kind: 'sqlite',
    async findUser(key) { return qGet.get(key) || null },
    async createUser({ nameKey, name, salt, hash, balance }) { qInsert.run(nameKey, name, salt, hash, balance, Date.now()) },
    async saveAccount(key, { balance, trades, wins, realized }) { qSave.run(round(balance), trades | 0, wins | 0, round(realized), key) },
    async topTraders(limit) { return qTop.all(limit) },
  }
}

async function makePostgres() {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 })
  // simple retry so the app can start alongside a still-booting DB container
  for (let attempt = 1; ; attempt++) {
    try { await pool.query('SELECT 1'); break }
    catch (e) {
      if (attempt >= 30) throw e
      console.log(`Waiting for Postgres… (${attempt})`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      name_key   TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      salt       TEXT NOT NULL,
      hash       TEXT NOT NULL,
      balance    DOUBLE PRECISION NOT NULL DEFAULT ${INITIAL_BALANCE},
      trades     INTEGER NOT NULL DEFAULT 0,
      wins       INTEGER NOT NULL DEFAULT 0,
      realized   DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );
  `)
  console.log('Connected to PostgreSQL')
  return {
    kind: 'postgres',
    async findUser(key) {
      const { rows } = await pool.query('SELECT * FROM users WHERE name_key = $1', [key])
      return rows[0] || null
    },
    async createUser({ nameKey, name, salt, hash, balance }) {
      await pool.query('INSERT INTO users (name_key,name,salt,hash,balance,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [nameKey, name, salt, hash, balance, Date.now()])
    },
    async saveAccount(key, { balance, trades, wins, realized }) {
      await pool.query('UPDATE users SET balance=$1, trades=$2, wins=$3, realized=$4 WHERE name_key=$5', [round(balance), trades | 0, wins | 0, round(realized), key])
    },
    async topTraders(limit) {
      const { rows } = await pool.query('SELECT name, balance, trades, wins, realized FROM users ORDER BY balance DESC LIMIT $1', [limit])
      return rows
    },
  }
}

export async function initStorage() {
  backend = USE_PG ? await makePostgres() : await makeSqlite()
  return backend
}
export const storage = {
  findUser: (key) => backend.findUser(key),
  createUser: (u) => backend.createUser(u),
  saveAccount: (key, f) => backend.saveAccount(key, f),
  topTraders: (n) => backend.topTraders(n),
  get kind() { return backend?.kind },
}
