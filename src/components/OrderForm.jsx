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
  const isLong = side === 'long'

  return (
    <div className="space-y-4 text-xs">
      {/* Long / Short */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-panel2 p-0.5">
        <button
          onClick={() => setSide('long')}
          className={`rounded-md py-2 text-sm font-semibold transition-colors ${
            isLong ? 'bg-up text-white' : 'text-sub hover:text-txt'
          }`}
        >
          Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={`rounded-md py-2 text-sm font-semibold transition-colors ${
            !isLong ? 'bg-down text-white' : 'text-sub hover:text-txt'
          }`}
        >
          Short
        </button>
      </div>

      {/* Market / Limit */}
      <div className="flex items-center gap-4 border-b border-border text-[13px]">
        {[
          { id: 'market', label: 'Market' },
          { id: 'limit', label: 'Limit' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setOrderType(t.id)}
            className={`-mb-px border-b-2 pb-2 font-semibold transition-colors ${
              orderType === t.id ? 'border-txt text-txt' : 'border-transparent text-sub hover:text-txt'
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto pb-2 font-mono text-[11px] text-sub">Avail {usd(balance)}</span>
      </div>

      {/* Leverage */}
      <div>
        <div className="mb-2 flex items-center justify-between text-sub">
          <span>Leverage</span>
          <span className="rounded-md bg-panel2 px-2 py-0.5 font-mono text-[13px] font-semibold text-txt">{leverage}x</span>
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
        <div className="mt-2 flex gap-1">
          {[5, 10, 25, 50, 100].map((l) => (
            <button key={l} onClick={() => setLeverage(l)} data-active={leverage === l} className="chip flex-1">
              {l}x
            </button>
          ))}
        </div>
      </div>

      {/* Limit price */}
      {isLimit && (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-sub">
            <span>Limit price</span>
            <span className="font-mono">Market {fmtPrice(price, dp)}</span>
          </div>
          <div className="field">
            <input
              type="number"
              value={limitPrice}
              placeholder={side === 'long' ? 'below market' : 'above market'}
              onChange={(e) => setLimitPrice(e.target.value)}
            />
            <span className="shrink-0 text-sub">USDT</span>
          </div>
        </div>
      )}

      {/* Margin */}
      <div>
        <div className="mb-1.5 text-sub">Margin (collateral)</div>
        <div className="field">
          <input type="number" value={margin} min={0} onChange={(e) => setMargin(e.target.value)} />
          <span className="shrink-0 text-sub">USDT</span>
        </div>
        <div className="mt-2 flex gap-1">
          {[0.25, 0.5, 0.75, 1].map((p) => (
            <button key={p} onClick={() => quickPct(p)} className="chip flex-1">
              {p * 100}%
            </button>
          ))}
        </div>
      </div>

      {/* SL / TP */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1.5 text-sub">Take profit</div>
          <div className="field">
            <input type="number" value={tp} placeholder="—" onChange={(e) => setTp(e.target.value)} className="!text-up" />
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-sub">Stop loss</div>
          <div className="field">
            <input type="number" value={sl} placeholder="—" onChange={(e) => setSl(e.target.value)} className="!text-down" />
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg bg-down/10 px-3 py-2 text-down">{error}</div>}

      <button
        onClick={submit}
        disabled={disabled}
        className={`w-full rounded-full px-3 py-2.5 text-sm font-semibold transition-[filter,background-color] ${
          disabled
            ? 'cursor-not-allowed bg-panel2 text-sub'
            : isLong
              ? 'bg-up text-white hover:brightness-110'
              : 'bg-down text-white hover:brightness-110'
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

      {/* Preview */}
      <div className="space-y-1.5">
        {preview.dca && (
          <>
            <Row label="Current entry" value={fmtPrice(position.entry, dp)} valueClass="text-sub" />
            <Row label="→ New avg entry" value={fmtPrice(preview.avg, dp)} valueClass="text-gold font-semibold" />
          </>
        )}
        <Row label={preview.dca ? 'Total size' : 'Position size'} value={usd(preview.notional)} />
        <Row label={preview.dca ? 'Total quantity' : 'Quantity'} value={`${fmtQty(preview.qty)} ${baseAsset}`} />
        <Row
          label={`Fee ${isLimit ? 'maker' : 'taker'} (${fmt(feeRate * 100, 2)}%)`}
          value={usd((Number(margin) || 0) * leverage * feeRate)}
        />
        <Row
          label={preview.dca ? '→ New liq. price' : 'Est. liq. price'}
          value={fmtPrice(preview.liq, dp)}
          valueClass="text-down font-semibold"
        />
      </div>
    </div>
  )
}

function Row({ label, value, valueClass = 'text-txt' }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-sub">{label}</span>
      <span className={`font-mono ${valueClass}`}>{value}</span>
    </div>
  )
}
