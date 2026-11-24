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
  const inOrders = (spotPending || []).reduce((s, o) => (o.side === 'short' && !o.grid ? s + (o.qty - (o.filled || 0)) : s), 0) // a grid bot's sells are its own coins

  if (!holding || holding.qty <= 0) return null

  const avg = holding.qty ? holding.cost / holding.qty : 0
  const value = holding.qty * price
  const pnl = value - holding.cost
  const roe = holding.cost ? (pnl / holding.cost) * 100 : 0
  const win = pnl >= 0
  const sellPct = (p) => spotSell(Math.floor(holding.qty * p * 1e6) / 1e6)

  return (
    <div className="rounded-xl bg-panel2/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-semibold text-txt">SPOT · {baseAsset}</span>
          <span className="rounded bg-panel3 px-1.5 py-0.5 text-[11px] font-medium text-sub">
            No liquidation
          </span>
        </div>
        <button
          onClick={() => spotSell(holding.qty)}
          className="shrink-0 rounded-full bg-down/15 px-3 py-1 text-xs font-semibold text-down transition-colors hover:bg-down/25"
        >
          Sell all
        </button>
      </div>

      <div className="mt-3">
        <div className="text-[11px] text-sub">Unrealized PnL</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className={`font-mono text-2xl font-semibold ${win ? 'text-up' : 'text-down'}`}>
            {signedUsd(pnl)}
          </span>
          <span className={`font-mono text-[13px] font-medium ${win ? 'text-up' : 'text-down'}`}>
            {pct(roe)}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border pt-3">
        <Stat label="Free Holdings" value={`${fmtQty(holding.qty)} ${baseAsset}`} />
        <Stat label="Market Value" value={usd(value)} />
        <Stat label="Avg Cost" value={fmtPrice(avg, dp)} />
        <Stat label="Mark Price" value={fmtPrice(price, dp)} />
      </div>

      {inOrders > 1e-9 && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
          <span className="text-sub">In sell orders</span>
          <span className="font-mono text-txt">{fmtQty(inOrders)} {baseAsset}</span>
        </div>
      )}

      <div className="mt-3 flex gap-1.5">
        {[0.25, 0.5, 1].map((p) => (
          <button
            key={p}
            onClick={() => sellPct(p)}
            className="flex-1 rounded-lg bg-panel3/70 py-1.5 text-xs font-medium text-txt transition-colors hover:bg-panel3"
          >
            Sell {p * 100}%
          </button>
        ))}
      </div>
    </div>
  )
}
