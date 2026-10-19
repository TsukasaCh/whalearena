import { useSim } from '../store/useSimStore'
import { usd, fmtPrice, fmtQty, pct, signedUsd } from '../lib/format'
import { Stat } from './ui'

// The user's spot holding in the ACTIVE market: coins owned outright, their
// average cost, current mark value and paper PnL, with quick partial sells.
export default function SpotHolding() {
  const holding = useSim((s) => s.spot[s.symbol])
  const spotPending = useSim((s) => s.spotPending)
  const price = useSim((s) => s.price)
  const dp = useSim((s) => s.dp)
  const baseAsset = useSim((s) => s.baseAsset)
  const spotSell = useSim((s) => s.spotSell)

  // coins committed to resting SELL limits (moved out of the free holding)
  const inOrders = (spotPending || []).reduce((s, o) => (o.side === 'short' ? s + (o.qty - (o.filled || 0)) : s), 0)

  if (!holding || holding.qty <= 0) return null

  const avg = holding.qty ? holding.cost / holding.qty : 0
  const value = holding.qty * price
  const pnl = value - holding.cost
  const roe = holding.cost ? (pnl / holding.cost) * 100 : 0
  const win = pnl >= 0
  const sellPct = (p) => spotSell(Math.floor(holding.qty * p * 1e6) / 1e6)

  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
            SPOT · {baseAsset}
          </span>
          <span className="text-xs text-sub">No liquidation</span>
        </div>
        <button
          onClick={() => spotSell(holding.qty)}
          className="rounded bg-down/15 px-2.5 py-1 text-xs font-semibold text-down hover:bg-down/25"
        >
          Sell all
        </button>
      </div>

      <div className="mb-3 rounded-md bg-panel2/60 p-3 text-center">
        <div className="text-[10px] uppercase tracking-wide text-sub">Unrealized PnL</div>
        <div className={`font-mono text-2xl font-bold ${win ? 'text-up' : 'text-down'}`}>
          {signedUsd(pnl)}
        </div>
        <div className={`font-mono text-sm font-semibold ${win ? 'text-up' : 'text-down'}`}>
          {pct(roe)}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-y-2">
        <Stat label="Free Holdings" value={`${fmtQty(holding.qty)} ${baseAsset}`} />
        <Stat label="Market Value" value={usd(value)} />
        <Stat label="Avg Cost" value={fmtPrice(avg, dp)} valueClass="text-accent" />
        <Stat label="Mark Price" value={fmtPrice(price, dp)} />
      </div>

      {inOrders > 1e-9 && (
        <div className="mb-3 flex items-center justify-between rounded-md bg-panel2/60 px-2 py-1.5 text-[11px]">
          <span className="text-sub">⏳ In sell orders</span>
          <span className="font-mono text-txt">{fmtQty(inOrders)} {baseAsset}</span>
        </div>
      )}

      <div className="flex gap-1">
        {[0.25, 0.5, 1].map((p) => (
          <button
            key={p}
            onClick={() => sellPct(p)}
            className="flex-1 rounded-md bg-panel2 py-1.5 text-xs font-semibold text-txt hover:bg-border"
          >
            Sell {p * 100}%
          </button>
        ))}
      </div>
    </div>
  )
}
