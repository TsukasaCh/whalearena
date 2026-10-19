import { useMemo, useState } from 'react'
import { useSim } from '../store/useSimStore'
import { TAKER_FEE, MAKER_FEE } from '../lib/trading'
import { usd, fmt, fmtPrice, fmtQty } from '../lib/format'

// Spot trading. Market orders buy/sell coins outright (no leverage, no liq).
// Limit orders rest in the spot book: buy BELOW market to accumulate, sell ABOVE
// market to distribute. The buy/sell size is shared with the chart via spotDraft,
// so you can drop ladder orders straight onto the chart.
export default function SpotForm() {
  const price = useSim((s) => s.price)
  const dp = useSim((s) => s.dp)
  const baseAsset = useSim((s) => s.baseAsset)
  const symbol = useSim((s) => s.symbol)
  const balance = useSim((s) => s.balance)
  const holding = useSim((s) => s.spot[s.symbol]) || { qty: 0, cost: 0 }
  const spotBuy = useSim((s) => s.spotBuy)
  const spotSell = useSim((s) => s.spotSell)
  const spotLimit = useSim((s) => s.spotLimit)

  const spend = useSim((s) => s.spotDraft.spend)
  const sellQty = useSim((s) => s.spotDraft.qty)
  const setSpotDraft = useSim((s) => s.setSpotDraft)
  const setSpend = (v) => setSpotDraft({ spend: v })
  const setSellQty = (v) => setSpotDraft({ qty: v })

  const [orderType, setOrderType] = useState('market') // 'market' | 'limit'
  const [tab, setTab] = useState('buy') // 'buy' | 'sell'
  const [limitPrice, setLimitPrice] = useState('')
  const [error, setError] = useState('')

  const isBuy = tab === 'buy'
  const isLimit = orderType === 'limit'
  const feeRate = isLimit ? MAKER_FEE : TAKER_FEE
  const avg = holding.qty ? holding.cost / holding.qty : 0
  const px = isLimit && Number(limitPrice) > 0 ? Number(limitPrice) : price
  const maxSpend = balance / (1 + feeRate) // leave room for the fee

  const buyPrev = useMemo(() => {
    const s = Number(spend) || 0
    const fee = s * feeRate
    return { coins: px ? s / px : 0, fee, total: s + fee }
  }, [spend, px, feeRate])

  const sellPrev = useMemo(() => {
    const q = Math.min(Number(sellQty) || 0, holding.qty)
    const proceeds = q * px
    const fee = proceeds * feeRate
    return { q, proceeds, fee, receive: proceeds - fee, pnl: (px - avg) * q - fee }
  }, [sellQty, px, holding.qty, avg, feeRate])

  const setSpendPct = (p) => setSpend(Math.max(0, Math.floor(maxSpend * p * 100) / 100))
  const setSellPct = (p) => setSellQty(Math.max(0, Math.floor(holding.qty * p * 1e6) / 1e6))

  const submit = () => {
    setError('')
    const lp = Number(limitPrice)
    if (isLimit && (!lp || lp <= 0)) return setError('Masukkan harga limit.')
    if (isBuy) {
      const s = Number(spend)
      if (!s || s <= 0) return setError('Masukkan jumlah USDT.')
      if (s + s * feeRate > balance + 1e-9) return setError('Saldo tidak cukup (jumlah + fee).')
      if (isLimit) {
        if (lp >= price) return setError('Limit buy harus DI BAWAH harga pasar.')
        spotLimit({ side: 'buy', price: lp, spend: s })
      } else spotBuy(s)
    } else {
      const q = Number(sellQty)
      if (!q || q <= 0) return setError('Masukkan jumlah koin.')
      if (q > holding.qty + 1e-9) return setError(`Maksimum ${fmtQty(holding.qty)} ${baseAsset}.`)
      if (isLimit) {
        if (lp <= price) return setError('Limit sell harus DI ATAS harga pasar.')
        spotLimit({ side: 'sell', price: lp, qty: q })
      } else spotSell(q)
    }
  }

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

      {/* Buy / Sell */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setTab('buy')}
          className={`rounded-md py-2 text-sm font-bold transition-colors ${
            isBuy ? 'bg-up text-black' : 'bg-panel2 text-sub hover:text-txt'
          }`}
        >
          BUY {baseAsset}
        </button>
        <button
          onClick={() => setTab('sell')}
          className={`rounded-md py-2 text-sm font-bold transition-colors ${
            !isBuy ? 'bg-down text-black' : 'bg-panel2 text-sub hover:text-txt'
          }`}
        >
          SELL {baseAsset}
        </button>
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
              placeholder={isBuy ? 'below market (accumulate)' : 'above market (distribute)'}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="w-full bg-transparent px-2 py-2 font-mono text-sm text-accent outline-none placeholder:text-sub/40"
            />
          </div>
        </div>
      )}

      {/* Amount */}
      {isBuy ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-sub">
            <span>Spend (USDT)</span>
            <span className="font-mono">Avail: {usd(balance)}</span>
          </div>
          <div className="flex items-center rounded-md border border-border bg-panel2 px-2">
            <span className="text-sub">$</span>
            <input
              type="number"
              value={spend}
              min={0}
              placeholder="0.00"
              onChange={(e) => setSpend(e.target.value)}
              className="w-full bg-transparent px-2 py-2 font-mono text-sm text-txt outline-none placeholder:text-sub/40"
            />
          </div>
          <div className="mt-1 flex justify-between gap-1">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button key={p} onClick={() => setSpendPct(p)} className="flex-1 rounded bg-panel2 py-0.5 text-[10px] font-semibold text-sub hover:text-txt">
                {p * 100}%
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-sub">
            <span>Amount ({baseAsset})</span>
            <span className="font-mono">Held: {fmtQty(holding.qty)}</span>
          </div>
          <div className="flex items-center rounded-md border border-border bg-panel2 px-2">
            <input
              type="number"
              value={sellQty}
              min={0}
              placeholder="0.00"
              onChange={(e) => setSellQty(e.target.value)}
              className="w-full bg-transparent px-2 py-2 font-mono text-sm text-txt outline-none placeholder:text-sub/40"
            />
            <span className="text-xs text-sub">{baseAsset}</span>
          </div>
          <div className="mt-1 flex justify-between gap-1">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button key={p} onClick={() => setSellPct(p)} className="flex-1 rounded bg-panel2 py-0.5 text-[10px] font-semibold text-sub hover:text-txt">
                {p * 100}%
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Preview */}
      <div className="space-y-1 rounded-md bg-panel2/60 p-2 font-mono text-xs">
        <Row label={isLimit ? 'Limit Price' : 'Market Price'} value={fmtPrice(px, dp)} valueClass={isLimit ? 'text-accent' : 'text-txt'} />
        {isBuy ? (
          <>
            <Row label="You receive (est.)" value={`${fmtQty(buyPrev.coins)} ${baseAsset}`} valueClass="text-up font-semibold" />
            <Row label={`Fee ${isLimit ? 'maker' : 'taker'} (${fmt(feeRate * 100, 2)}%)`} value={usd(buyPrev.fee)} valueClass="text-sub" />
            <Row label="Total cost" value={usd(buyPrev.total)} />
          </>
        ) : (
          <>
            <Row label="You receive (est.)" value={usd(sellPrev.receive)} valueClass="text-txt font-semibold" />
            <Row label={`Fee ${isLimit ? 'maker' : 'taker'} (${fmt(feeRate * 100, 2)}%)`} value={usd(sellPrev.fee)} valueClass="text-sub" />
            {holding.qty > 0 && (
              <Row label="Est. PnL" value={(sellPrev.pnl >= 0 ? '+' : '') + usd(sellPrev.pnl)} valueClass={sellPrev.pnl >= 0 ? 'text-up font-semibold' : 'text-down font-semibold'} />
            )}
          </>
        )}
      </div>

      {error && <div className="rounded bg-down/10 px-2 py-1 text-xs text-down">{error}</div>}

      <button
        onClick={submit}
        className={`w-full rounded-md py-2.5 text-sm font-bold transition-colors ${
          isBuy ? 'bg-up text-black hover:brightness-110' : 'bg-down text-black hover:brightness-110'
        }`}
      >
        {isLimit
          ? `${isBuy ? 'Buy' : 'Sell'} Limit ${baseAsset}`
          : `${isBuy ? 'Buy' : 'Sell'} ${baseAsset}`}
      </button>

      <p className="text-center text-[10px] text-sub/60">
        {isLimit
          ? `Limit ${isBuy ? 'buy di bawah harga = akumulasi' : 'sell di atas harga = distribusi'}. Bisa juga klik langsung di chart.`
          : `Spot ${symbol}: kamu memiliki koinnya langsung — tanpa leverage & likuidasi.`}
      </p>
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
