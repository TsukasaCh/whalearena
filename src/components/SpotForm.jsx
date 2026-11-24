import { useEffect, useMemo, useState } from 'react'
import { useSim } from '../store/useSimStore'
import { TAKER_FEE, MAKER_FEE } from '../lib/trading'
import { usd, fmt, fmtPrice, fmtQty } from '../lib/format'
import { GridForm } from './GridBot'

// Spot trading. Market orders buy/sell coins outright (no leverage, no liq).
// TWAP / VWAP work a large buy or sell as timed market slices.
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
  const placeSpotAlgo = useSim((s) => s.placeSpotAlgo)

  const spend = useSim((s) => s.spotDraft.spend)
  const sellQty = useSim((s) => s.spotDraft.qty)
  const setSpotDraft = useSim((s) => s.setSpotDraft)
  const setSpend = (v) => setSpotDraft({ spend: v })
  const setSellQty = (v) => setSpotDraft({ qty: v })

  const [orderType, setOrderType] = useState('market') // 'market' | 'limit' | 'iceberg' | 'twap' | 'vwap' | 'grid'
  const [tab, setTab] = useState('buy') // 'buy' | 'sell'
  const [limitPrice, setLimitPrice] = useState('')
  const [error, setError] = useState('')
  // algo orders (TWAP / VWAP): run time in minutes + number of child orders
  const [minutes, setMinutes] = useState(5)
  const [slices, setSlices] = useState(10)
  const [visiblePct, setVisiblePct] = useState(10) // iceberg: % of the order shown on the book

  const isBuy = tab === 'buy'
  const isIceberg = orderType === 'iceberg' // a limit order that shows only part of its size
  const isLimit = orderType === 'limit' || isIceberg
  // limits dropped from the chart follow the Iceberg tab too
  useEffect(() => {
    const vp = Number(visiblePct)
    setSpotDraft({ visible: isIceberg && vp >= 1 && vp <= 50 ? vp / 100 : undefined })
  }, [isIceberg, visiblePct, setSpotDraft])
  const isAlgo = orderType === 'twap' || orderType === 'vwap'
  const durationSec = Math.round((Number(minutes) || 0) * 60)
  const sliceCount = Math.round(Number(slices) || 0)
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
    const vp = Number(visiblePct)
    if (isIceberg && !(vp >= 1 && vp <= 50)) return setError('Porsi terlihat harus 1 – 50%.')
    const visible = isIceberg ? vp / 100 : undefined
    if (isAlgo) {
      if (!(durationSec >= 30 && durationSec <= 14400)) return setError('Durasi harus 0.5 – 240 menit.')
      if (!(sliceCount >= 2 && sliceCount <= 100)) return setError('Jumlah slice harus 2 – 100.')
      if (durationSec / (sliceCount - 1) < 2) return setError('Jarak antar slice minimal 2 detik.')
    }
    if (isBuy) {
      const s = Number(spend)
      if (!s || s <= 0) return setError('Masukkan jumlah USDT.')
      if (s + s * feeRate > balance + 1e-9) return setError('Saldo tidak cukup (jumlah + fee).')
      if (isAlgo) {
        if (s / sliceCount < 1) return setError('Nilai per slice minimal $1.')
        placeSpotAlgo({ algo: orderType, side: 'buy', spend: s, duration: durationSec, slices: sliceCount })
      } else if (isLimit) {
        if (lp >= price) return setError('Limit buy harus DI BAWAH harga pasar.')
        spotLimit({ side: 'buy', price: lp, spend: s, visible })
      } else spotBuy(s)
    } else {
      const q = Number(sellQty)
      if (!q || q <= 0) return setError('Masukkan jumlah koin.')
      if (q > holding.qty + 1e-9) return setError(`Maksimum ${fmtQty(holding.qty)} ${baseAsset}.`)
      if (isAlgo) {
        if ((q * price) / sliceCount < 1) return setError('Nilai per slice minimal $1.')
        placeSpotAlgo({ algo: orderType, side: 'sell', qty: q, duration: durationSec, slices: sliceCount })
      } else if (isLimit) {
        if (lp <= price) return setError('Limit sell harus DI ATAS harga pasar.')
        spotLimit({ side: 'sell', price: lp, qty: q, visible })
      } else spotSell(q)
    }
  }

  // order type switcher (the Grid tab swaps the whole form for the grid bot setup)
  const typeTabs = (
    <div className="seg">
      {[
        { id: 'market', label: 'Market' },
        { id: 'limit', label: 'Limit' },
        { id: 'iceberg', label: 'Iceberg' },
        { id: 'twap', label: 'TWAP' },
        { id: 'vwap', label: 'VWAP' },
        { id: 'grid', label: 'Grid' },
      ].map((t) => (
        <button key={t.id} onClick={() => { setOrderType(t.id); setError('') }} data-active={orderType === t.id} className="!px-0 !text-[11px]">
          {t.label}
        </button>
      ))}
    </div>
  )

  if (orderType === 'grid') {
    return (
      <div className="space-y-3">
        {typeTabs}
        <GridForm />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {typeTabs}

      {/* Buy / Sell */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-panel2 p-0.5">
        <button
          onClick={() => setTab('buy')}
          className={`rounded-md py-2 text-[13px] font-semibold transition-colors ${
            isBuy ? 'bg-up text-white' : 'text-sub hover:text-txt'
          }`}
        >
          BUY {baseAsset}
        </button>
        <button
          onClick={() => setTab('sell')}
          className={`rounded-md py-2 text-[13px] font-semibold transition-colors ${
            !isBuy ? 'bg-down text-white' : 'text-sub hover:text-txt'
          }`}
        >
          SELL {baseAsset}
        </button>
      </div>

      {/* Limit price */}
      {isLimit && (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-sub">
            <span>Limit Price</span>
            <span className="font-mono">mkt {fmtPrice(price, dp)}</span>
          </div>
          <div className="field">
            <span className="shrink-0 text-xs text-sub">$</span>
            <input
              type="number"
              value={limitPrice}
              placeholder={isBuy ? 'below market (accumulate)' : 'above market (distribute)'}
              onChange={(e) => setLimitPrice(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Amount */}
      {isBuy ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-sub">
            <span>{isAlgo ? 'Total spend (USDT)' : 'Spend (USDT)'}</span>
            <span className="font-mono">
              Avail: <span className="text-txt">{usd(balance)}</span>
            </span>
          </div>
          <div className="field">
            <span className="shrink-0 text-xs text-sub">$</span>
            <input
              type="number"
              value={spend}
              min={0}
              placeholder="0.00"
              onChange={(e) => setSpend(e.target.value)}
            />
            <span className="shrink-0 text-xs text-sub">USDT</span>
          </div>
          <div className="mt-2 flex gap-1">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button key={p} onClick={() => setSpendPct(p)} className="chip flex-1">
                {p * 100}%
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-sub">
            <span>{isAlgo ? 'Total amount' : 'Amount'} ({baseAsset})</span>
            <span className="font-mono">
              Held: <span className="text-txt">{fmtQty(holding.qty)}</span>
            </span>
          </div>
          <div className="field">
            <input
              type="number"
              value={sellQty}
              min={0}
              placeholder="0.00"
              onChange={(e) => setSellQty(e.target.value)}
            />
            <span className="shrink-0 text-xs text-sub">{baseAsset}</span>
          </div>
          <div className="mt-2 flex gap-1">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button key={p} onClick={() => setSellPct(p)} className="chip flex-1">
                {p * 100}%
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Iceberg: how much of the order the book gets to see */}
      {isIceberg && (
        <div className="space-y-3">
          <div className="rounded-lg bg-panel2/60 px-3 py-2 text-xs leading-relaxed text-sub">
            <span className="font-semibold text-txt">Iceberg</span> adalah limit order yang hanya menampilkan
            sebagian ukurannya di order book. Begitu bagian itu terisi, bagian berikutnya muncul — sisanya
            tersembunyi dari trader lain.
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-sub">
              <span>Visible size</span>
              <span className="font-mono">
                ≈ {fmtQty((isBuy ? buyPrev.coins : sellPrev.q) * ((Number(visiblePct) || 0) / 100))} {baseAsset} shown
              </span>
            </div>
            <div className="field">
              <input type="number" value={visiblePct} min={1} max={50} step={1} onChange={(e) => setVisiblePct(e.target.value)} />
              <span className="shrink-0 text-xs text-sub">% of order</span>
            </div>
            <div className="mt-2 flex gap-1">
              {[5, 10, 20, 25, 50].map((v) => (
                <button key={v} onClick={() => setVisiblePct(v)} data-active={Number(visiblePct) === v} className="chip flex-1 !px-1">
                  {v}%
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TWAP / VWAP schedule */}
      {isAlgo && (
        <div className="space-y-3">
          <div className="rounded-lg bg-panel2/60 px-3 py-2 text-xs leading-relaxed text-sub">
            {orderType === 'twap' ? (
              <>
                <span className="font-semibold text-txt">TWAP</span> memecah order jadi slice market yang sama besar
                dengan jeda waktu yang sama, supaya tidak memakan order book sekaligus.
              </>
            ) : (
              <>
                <span className="font-semibold text-txt">VWAP</span> memakai jadwal yang sama, tapi ukuran tiap slice
                mengikuti volume pasar: lebih besar saat ramai, lebih kecil saat sepi.
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1.5 text-xs text-sub">Duration</div>
              <div className="field">
                <input type="number" value={minutes} min={0.5} step={0.5} onChange={(e) => setMinutes(e.target.value)} />
                <span className="shrink-0 text-xs text-sub">min</span>
              </div>
              <div className="mt-2 flex gap-1">
                {[1, 5, 15, 60].map((v) => (
                  <button key={v} onClick={() => setMinutes(v)} data-active={Number(minutes) === v} className="chip flex-1 !px-1">
                    {v}m
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs text-sub">Slices</div>
              <div className="field">
                <input type="number" value={slices} min={2} max={100} step={1} onChange={(e) => setSlices(e.target.value)} />
                <span className="shrink-0 text-xs text-sub">orders</span>
              </div>
              <div className="mt-2 flex gap-1">
                {[5, 10, 20, 50].map((v) => (
                  <button key={v} onClick={() => setSlices(v)} data-active={Number(slices) === v} className="chip flex-1 !px-1">
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview */}
      <div className="space-y-1.5 border-t border-border pt-3 text-xs">
        <Row label={isLimit ? 'Limit Price' : 'Market Price'} value={fmtPrice(px, dp)} />
        {isAlgo && sliceCount >= 2 && durationSec > 0 && (
          <>
            <Row
              label={orderType === 'twap' ? 'Per slice' : 'Per slice (avg)'}
              value={`${orderType === 'twap' ? '' : '≈ '}${isBuy ? usd((Number(spend) || 0) / sliceCount) : `${fmtQty(sellPrev.q / sliceCount)} ${baseAsset}`}`}
            />
            <Row label="Interval" value={`every ${fmt(durationSec / (sliceCount - 1), durationSec % (sliceCount - 1) ? 1 : 0)}s`} />
          </>
        )}
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

      {error && <div className="rounded-lg bg-down/10 px-3 py-2 text-xs text-down">{error}</div>}

      <button
        onClick={submit}
        className={`w-full rounded-full py-2.5 text-sm font-semibold text-white transition hover:brightness-110 ${
          isBuy ? 'bg-up' : 'bg-down'
        }`}
      >
        {isAlgo
          ? `Start ${orderType.toUpperCase()} ${isBuy ? 'Buy' : 'Sell'} ${baseAsset}`
          : isLimit
            ? `${isBuy ? 'Buy' : 'Sell'} ${isIceberg ? 'Iceberg' : 'Limit'} ${baseAsset}`
            : `${isBuy ? 'Buy' : 'Sell'} ${baseAsset}`}
      </button>

      <p className="text-center text-[11px] leading-relaxed text-sub/70">
        {isAlgo
          ? `${isBuy ? 'USDT' : 'Koin'} dikunci selama order berjalan; sisanya kembali saat selesai atau di-cancel.`
          : isLimit
          ? `Limit ${isBuy ? 'buy di bawah harga = akumulasi' : 'sell di atas harga = distribusi'}. Bisa juga klik langsung di chart.`
          : `Spot ${symbol}: kamu memiliki koinnya langsung — tanpa leverage & likuidasi.`}
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
