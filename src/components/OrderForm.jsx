import { useMemo, useState } from 'react'
import { useSim } from '../store/useSimStore'
import { liquidationPrice, qtyFromMargin, notional, TAKER_FEE, MAKER_FEE } from '../lib/trading'
import { usd, fmt, fmtPrice, fmtQty } from '../lib/format'

export default function OrderForm() {
  const price = useSim((s) => s.price)
  const dp = useSim((s) => s.dp)
  const baseAsset = useSim((s) => s.baseAsset)
  const balance = useSim((s) => s.balance)
  const position = useSim((s) => s.position)
  const pendingOrders = useSim((s) => s.pendingOrders)
  const openPosition = useSim((s) => s.openPosition)
  const placeLimit = useSim((s) => s.placeLimit)

  const leverage = useSim((s) => s.orderDraft.leverage)
  const margin = useSim((s) => s.orderDraft.margin)
  const setOrderDraft = useSim((s) => s.setOrderDraft)
  const setLeverage = (v) => setOrderDraft({ leverage: v })
  const setMargin = (v) => setOrderDraft({ margin: v })

  const [orderType, setOrderType] = useState('market') // 'market' | 'limit'
  const [side, setSide] = useState('long')
  const [limitPrice, setLimitPrice] = useState('')
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [error, setError] = useState('')

  const isLimit = orderType === 'limit'
  const feeRate = isLimit ? MAKER_FEE : TAKER_FEE
  const entry = isLimit && Number(limitPrice) > 0 ? Number(limitPrice) : price

  // the book is one-directional: position + all resting orders share a side
  const committed = position ? position.side : pendingOrders[0]?.side || null
  const sameSide = position && position.side === side // DCA / scale-in into a live position
  const oppSide = committed && committed !== side // blocked (would reverse the book)

  const preview = useMemo(() => {
    const m = Number(margin) || 0
    const addQty = qtyFromMargin(m, leverage, entry)
    if (sameSide) {
      // scale-in → size-weighted average entry + recomputed liq
      const q = position.qty + addQty
      const avg = q ? (position.entry * position.qty + entry * addQty) / q : entry
      const mrg = position.margin + m
      const effLev = mrg ? Math.max(1, Math.min(100, Math.round((q * avg) / mrg))) : leverage
      return { dca: true, avg, qty: q, liq: liquidationPrice({ side, entry: avg, leverage: effLev }), notional: q * avg }
    }
    return { dca: false, avg: entry, qty: addQty, liq: liquidationPrice({ side, entry, leverage }), notional: notional(m, leverage) }
  }, [margin, leverage, side, entry, sameSide, position])

  const submit = () => {
    setError('')
    const m = Number(margin)
    if (!m || m <= 0) return setError('Masukkan margin yang valid.')
    if (m + m * leverage * feeRate > balance) return setError('Saldo tidak cukup (margin + fee).')
    if (isLimit) {
      const lp = Number(limitPrice)
      if (!lp || lp <= 0) return setError('Masukkan harga limit.')
      if (side === 'long' && lp >= price) return setError('Limit buy harus DI BAWAH harga pasar.')
      if (side === 'short' && lp <= price) return setError('Limit sell harus DI ATAS harga pasar.')
      placeLimit({ side, leverage, margin: m, price: lp, sl: sl ? Number(sl) : null, tp: tp ? Number(tp) : null })
    } else {
      openPosition({ side, leverage, margin: m, sl: sl ? Number(sl) : null, tp: tp ? Number(tp) : null })
    }
  }

  // leave room for the fee (charged on notional = margin × leverage)
  const quickPct = (p) => setMargin(Math.floor((balance * p) / (1 + leverage * feeRate)))
  const disabled = oppSide

  return (
    <div className="space-y-3">
      {/* Market / Limit */}
      <div className="flex rounded-md bg-panel2 p-0.5 text-xs">
        {[
          { id: 'market', label: 'Market' },
          { id: 'limit', label: 'Limit' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setOrderType(t.id)}
            className={`flex-1 rounded py-1 font-semibold transition-colors ${
              orderType === t.id ? 'bg-panel text-txt shadow' : 'text-sub hover:text-txt'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Long / Short */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setSide('long')}
          className={`rounded-md py-2 text-sm font-bold transition-colors ${
            side === 'long' ? 'bg-up text-black' : 'bg-panel2 text-sub hover:text-txt'
          }`}
        >
          LONG
        </button>
        <button
          onClick={() => setSide('short')}
          className={`rounded-md py-2 text-sm font-bold transition-colors ${
            side === 'short' ? 'bg-down text-black' : 'bg-panel2 text-sub hover:text-txt'
          }`}
        >
          SHORT
        </button>
      </div>

      {/* Leverage */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-sub">
          <span>Leverage</span>
          <span className="font-mono font-semibold text-gold">{leverage}x</span>
        </div>
        <input
          type="range"
          className="lev w-full"
          min={1}
          max={100}
          step={1}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
        />
        <div className="mt-1 flex justify-between gap-1">
          {[5, 10, 25, 50, 100].map((l) => (
            <button
              key={l}
              onClick={() => setLeverage(l)}
              className={`flex-1 rounded py-0.5 text-[10px] font-semibold ${
                leverage === l ? 'bg-gold/20 text-gold' : 'bg-panel2 text-sub hover:text-txt'
              }`}
            >
              {l}x
            </button>
          ))}
        </div>
      </div>

      {/* Margin */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-sub">
          <span>Margin (Collateral)</span>
          <span className="font-mono">Avail: {usd(balance)}</span>
        </div>
        <div className="flex items-center rounded-md border border-border bg-panel2 px-2">
          <span className="text-sub">$</span>
          <input
            type="number"
            value={margin}
            min={0}
            onChange={(e) => setMargin(e.target.value)}
            className="w-full bg-transparent px-2 py-2 font-mono text-sm text-txt outline-none"
          />
        </div>
        <div className="mt-1 flex justify-between gap-1">
          {[0.25, 0.5, 0.75, 1].map((p) => (
            <button
              key={p}
              onClick={() => quickPct(p)}
              className="flex-1 rounded bg-panel2 py-0.5 text-[10px] font-semibold text-sub hover:text-txt"
            >
              {p * 100}%
            </button>
          ))}
        </div>
      </div>

      {/* Limit price */}
      {isLimit && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-sub">
            <span>Limit Price</span>
            <span className="font-mono">mkt {fmtPrice(price, dp)}</span>
          </div>
          <div className="flex items-center rounded-md border border-border bg-panel2 px-2">
            <span className="text-sub">$</span>
            <input
              type="number"
              value={limitPrice}
              placeholder={side === 'long' ? 'below market' : 'above market'}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="w-full bg-transparent px-2 py-2 font-mono text-sm text-accent outline-none placeholder:text-sub/40"
            />
          </div>
        </div>
      )}

      {/* SL / TP */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs text-sub">Stop Loss</div>
          <input
            type="number"
            value={sl}
            placeholder="—"
            onChange={(e) => setSl(e.target.value)}
            className="w-full rounded-md border border-border bg-panel2 px-2 py-2 font-mono text-sm text-down outline-none placeholder:text-sub/40"
          />
        </div>
        <div>
          <div className="mb-1 text-xs text-sub">Take Profit</div>
          <input
            type="number"
            value={tp}
            placeholder="—"
            onChange={(e) => setTp(e.target.value)}
            className="w-full rounded-md border border-border bg-panel2 px-2 py-2 font-mono text-sm text-up outline-none placeholder:text-sub/40"
          />
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-1 rounded-md bg-panel2/60 p-2 font-mono text-xs">
        {preview.dca && (
          <>
            <Row label="Current Entry" value={fmtPrice(position.entry, dp)} valueClass="text-sub" />
            <Row label="→ New Avg Entry" value={fmtPrice(preview.avg, dp)} valueClass="text-gold font-semibold" />
          </>
        )}
        <Row label={preview.dca ? 'Total Size' : 'Position Size'} value={usd(preview.notional)} />
        <Row label={preview.dca ? 'Total Quantity' : 'Quantity'} value={`${fmtQty(preview.qty)} ${baseAsset}`} />
        <Row
          label={`Fee ${isLimit ? 'maker' : 'taker'} (${fmt(feeRate * 100, 2)}%)`}
          value={usd((Number(margin) || 0) * leverage * feeRate)}
          valueClass="text-sub"
        />
        <Row
          label={preview.dca ? '→ New Liq. Price' : 'Est. Liq. Price'}
          value={fmtPrice(preview.liq, dp)}
          valueClass="text-down font-semibold"
        />
      </div>

      {error && <div className="rounded bg-down/10 px-2 py-1 text-xs text-down">{error}</div>}

      <button
        onClick={submit}
        disabled={disabled}
        className={`w-full rounded-md py-2.5 text-sm font-bold transition-colors ${
          disabled
            ? 'cursor-not-allowed bg-panel2 text-sub'
            : side === 'long'
              ? 'bg-up text-black hover:brightness-110'
              : 'bg-down text-black hover:brightness-110'
        }`}
      >
        {oppSide
          ? `Cancel/tutup ${committed.toUpperCase()} dulu untuk balik arah`
          : isLimit
            ? sameSide
              ? `+ Limit ${side === 'long' ? 'Buy' : 'Sell'} (DCA)`
              : `Place Limit ${side === 'long' ? 'Buy' : 'Sell'}`
            : sameSide
              ? `+ Tambah ${side.toUpperCase()} (DCA)`
              : `Open ${side.toUpperCase()} ${leverage}x`}
      </button>
    </div>
  )
}

function Row({ label, value, valueClass = 'text-txt' }) {
  return (
    <div className="flex justify-between">
      <span className="text-sub">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}
