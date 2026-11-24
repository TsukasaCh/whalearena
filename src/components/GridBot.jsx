import { useEffect, useMemo, useRef, useState } from 'react'
import { useSim } from '../store/useSimStore'
import { TAKER_FEE, MAKER_FEE } from '../lib/trading'
import { usd, fmt, fmtPrice, fmtQty, pct, signedUsd } from '../lib/format'

// limits — mirror of the GRID_* constants in server/engine.js
const GRID_MIN = 2
const GRID_MAX = 50
const GRID_MIN_STEP = 0.002
const GRID_MIN_ORDER = 1

const roundDp = (n, dp) => { const f = Math.pow(10, dp); return Math.round(n * f) / f }

// total value of a bot at `price`: idle + resting USDT, idle + resting coins
export const gridValue = (g, price) => (g.usdt || 0) + (g.usdtLocked || 0) + ((g.coins || 0) + (g.coinsLocked || 0)) * (price || 0)

// Start form for a spot grid bot (shown as the "Grid" tab of the spot order form).
export function GridForm() {
  const price = useSim((s) => s.price)
  const dp = useSim((s) => s.dp)
  const symbol = useSim((s) => s.symbol)
  const baseAsset = useSim((s) => s.baseAsset)
  const balance = useSim((s) => s.balance)
  const running = useSim((s) => s.grids.some((g) => g.symbol === s.symbol))
  const startGrid = useSim((s) => s.startGrid)

  const [lower, setLower] = useState('')
  const [upper, setUpper] = useState('')
  const [grids, setGrids] = useState(10)
  const [invest, setInvest] = useState(500)
  const [error, setError] = useState('')

  const setRange = (p) => {
    if (!price) return
    setLower(roundDp(price * (1 - p), dp))
    setUpper(roundDp(price * (1 + p), dp))
  }
  // a sensible default range around the current price — seeded ONCE per market,
  // so clearing the fields to type a new range never gets them refilled
  const seeded = useRef(null)
  useEffect(() => {
    setLower(''); setUpper(''); setError('')
    seeded.current = null
  }, [symbol])
  useEffect(() => {
    if (!price || seeded.current === symbol) return
    seeded.current = symbol
    setRange(0.03)
  }, [price, symbol]) // eslint-disable-line react-hooks/exhaustive-deps

  const lo = Number(lower), hi = Number(upper), n = Math.round(Number(grids) || 0), inv = Number(invest) || 0
  const plan = useMemo(() => {
    if (!(lo > 0) || !(hi > lo) || !(n >= GRID_MIN) || n > GRID_MAX || !price) return null
    const step = (hi - lo) / n
    const level = (i) => roundDp(lo + ((hi - lo) * i) / n, dp) // tick-rounded, exactly like the server
    let k = -1
    for (let i = 0; i <= n; i++) if (level(i) < price) k = i
    const inRange = price > lo && price < hi && k >= 0 && k < n
    const sells = Math.max(0, n - k - 1)
    let buyCost = 0
    for (let i = 0; i <= k; i++) buyCost += level(i) * (1 + MAKER_FEE)
    const qty = inRange ? Math.floor((inv / (buyCost + sells * price * (1 + TAKER_FEE) * 1.003)) * 1e6) / 1e6 : 0
    // net profit of one round trip as a % of the money in it, at the cheapest and dearest grid
    const net = (buy) => ((step - (2 * buy + step) * MAKER_FEE) / buy) * 100
    return { step, k, inRange, buys: k + 1, sells, qty, pctLo: net(hi - step), pctHi: net(lo) }
  }, [lo, hi, n, inv, price, dp])

  const submit = () => {
    setError('')
    if (running) return setError(`Sudah ada grid bot ${symbol} — stop dulu yang lama.`)
    if (!(lo > 0) || !(hi > lo)) return setError('Isi range harga: lower harus di bawah upper.')
    if (!(n >= GRID_MIN && n <= GRID_MAX)) return setError(`Jumlah grid harus ${GRID_MIN} – ${GRID_MAX}.`)
    if (!plan?.inRange) return setError('Harga pasar harus berada di dalam range grid.')
    if (plan.step / lo < GRID_MIN_STEP) return setError(`Grid terlalu rapat — jarak antar grid minimal ${GRID_MIN_STEP * 100}%.`)
    if (!(inv > 0)) return setError('Masukkan jumlah investasi.')
    if (inv > balance + 1e-9) return setError('Saldo tidak cukup.')
    if (!(plan.qty > 0) || plan.qty * lo < GRID_MIN_ORDER) return setError(`Investasi terlalu kecil — minimal ~$${GRID_MIN_ORDER} per grid.`)
    startGrid({ lower: lo, upper: hi, grids: n, invest: inv })
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg bg-panel2/60 px-3 py-2 leading-relaxed text-sub">
        <span className="font-semibold text-txt">Grid bot</span> memasang tangga order beli di bawah harga dan jual
        di atasnya. Tiap order yang terisi otomatis dibalik satu tingkat, jadi bot mengambil untung dari harga yang
        naik-turun di dalam range.
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-sub">
          <span>Price range</span>
          <span className="font-mono">Market {fmtPrice(price, dp)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="field">
            <input type="number" value={lower} placeholder="Lower" onChange={(e) => setLower(e.target.value)} />
          </div>
          <div className="field">
            <input type="number" value={upper} placeholder="Upper" onChange={(e) => setUpper(e.target.value)} />
          </div>
        </div>
        <div className="mt-2 flex gap-1">
          {[0.01, 0.03, 0.05, 0.1].map((p) => (
            <button key={p} onClick={() => setRange(p)} className="chip flex-1 !px-1">
              ±{p * 100}%
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1.5 text-sub">Grids</div>
          <div className="field">
            <input type="number" value={grids} min={GRID_MIN} max={GRID_MAX} step={1} onChange={(e) => setGrids(e.target.value)} />
          </div>
          <div className="mt-2 flex gap-1">
            {[5, 10, 20, 30].map((v) => (
              <button key={v} onClick={() => setGrids(v)} data-active={Number(grids) === v} className="chip flex-1 !px-1">
                {v}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-sub">
            <span>Investment</span>
          </div>
          <div className="field">
            <input type="number" value={invest} min={0} onChange={(e) => setInvest(e.target.value)} />
            <span className="shrink-0 text-sub">USDT</span>
          </div>
          <div className="mt-2 flex gap-1">
            {[0.25, 0.5, 1].map((p) => (
              <button key={p} onClick={() => setInvest(Math.floor(balance * p * 100) / 100)} className="chip flex-1 !px-1">
                {p * 100}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-border pt-3">
        <Row label="Available" value={usd(balance)} />
        <Row label="Grid step" value={plan ? fmtPrice(plan.step, dp) : '—'} />
        <Row
          label="Profit per grid (after fees)"
          value={plan ? `${fmt(plan.pctLo, 2)}% – ${fmt(plan.pctHi, 2)}%` : '—'}
          valueClass={plan && plan.pctLo > 0 ? 'text-up' : 'text-down'}
        />
        <Row label="Size per grid" value={plan?.qty > 0 ? `${fmtQty(plan.qty)} ${baseAsset}` : '—'} />
        <Row label="Starting orders" value={plan?.inRange ? `${plan.buys} buy · ${plan.sells} sell` : '—'} />
      </div>

      {error && <div className="rounded-lg bg-down/10 px-3 py-2 text-down">{error}</div>}

      <button
        onClick={submit}
        disabled={running}
        className={`w-full rounded-full py-2.5 text-sm font-semibold transition ${
          running ? 'cursor-not-allowed bg-panel2 text-sub' : 'btn-primary'
        }`}
      >
        {running ? `Grid bot ${symbol} sedang berjalan` : `Start grid ${baseAsset}`}
      </button>

      <p className="text-center text-[11px] leading-relaxed text-sub/70">
        Dana bot terpisah dari saldo. Kalau harga keluar dari range, bot diam memegang koin (di bawah) atau USDT (di
        atas) sampai harga kembali atau bot dihentikan.
      </p>
    </div>
  )
}

function Row({ label, value, valueClass = 'text-txt' }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sub">{label}</span>
      <span className={`font-mono ${valueClass}`}>{value}</span>
    </div>
  )
}

// Running grid bot(s) for the active symbol: value, PnL split into banked grid
// profit and floating PnL, and a stop button.
export default function GridBots() {
  const grids = useSim((s) => s.grids)
  const symbol = useSim((s) => s.symbol)
  const price = useSim((s) => s.price)
  const mode = useSim((s) => s.mode)
  const spotPx = useSim((s) => s.symbols.find((x) => x.symbol === s.symbol)?.spot)
  const dp = useSim((s) => s.dp)
  const orders = useSim((s) => s.spotPending)
  const stopGrid = useSim((s) => s.stopGrid)
  const mine = grids.filter((g) => g.symbol === symbol)
  if (!mine.length) return null
  const px = mode === 'spot' ? price : spotPx ?? price

  return (
    <div className="rounded-xl bg-panel2/50 p-3">
      {mine.map((g) => {
        const value = gridValue(g, px)
        const total = value - g.invest
        const floating = total - (g.profit || 0)
        const mineOrders = orders.filter((o) => o.grid === g.id)
        const buys = mineOrders.filter((o) => o.side === 'long').length
        const out = px < g.lower ? 'below' : px > g.upper ? 'above' : null
        return (
          <div key={g.id} className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="text-[13px] font-semibold text-txt">Grid bot</span>
                <span className="rounded bg-panel3 px-1.5 py-0.5 text-[11px] font-semibold text-txt">{g.grids} grids</span>
                {out && (
                  <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[11px] font-semibold text-gold" title="Harga di luar range — bot menunggu">
                    {out === 'below' ? 'Below range' : 'Above range'}
                  </span>
                )}
              </span>
              <button
                onClick={() => stopGrid(g.id)}
                title="Batalkan semua order grid dan kembalikan USDT ke saldo serta koin ke holding spot"
                className="btn btn-outline btn-sm shrink-0 hover:!border-down hover:text-down"
              >
                Stop
              </button>
            </div>

            <div className="font-mono text-[11px] text-sub">
              {fmtPrice(g.lower, dp)} – {fmtPrice(g.upper, dp)} · {buys} buy / {mineOrders.length - buys} sell resting
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-2.5 text-[11px]">
              <div>
                <div className="text-sub">Total PnL</div>
                <div className={`font-mono text-sm font-semibold ${total >= 0 ? 'text-up' : 'text-down'}`}>
                  {signedUsd(total)} <span className="text-[11px] font-normal">({pct((total / g.invest) * 100)})</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sub">Value / Invested</div>
                <div className="font-mono text-xs text-txt">{usd(value)} / {usd(g.invest, 0)}</div>
              </div>
              <div>
                <div className="text-sub" title="Untung yang sudah terkunci dari siklus beli-jual yang selesai">Grid profit</div>
                <div className="font-mono text-xs text-up">{signedUsd(g.profit || 0)}</div>
              </div>
              <div className="text-right">
                <div className="text-sub" title="Naik-turun nilai koin yang masih dipegang bot">Floating PnL · Cycles</div>
                <div className="font-mono text-xs">
                  <span className={floating >= 0 ? 'text-up' : 'text-down'}>{signedUsd(floating)}</span>
                  <span className="text-sub"> · {g.cycles || 0}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
