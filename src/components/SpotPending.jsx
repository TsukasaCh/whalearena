import { useSim } from '../store/useSimStore'
import { usd, fmtPrice, fmtQty } from '../lib/format'

// Resting SPOT limit orders for the active symbol — buy ladders (accumulate)
// and sell ladders (distribute). Side long = buy, short = sell.
export default function SpotPending() {
  const orders = useSim((s) => s.spotPending)
  const dp = useSim((s) => s.dp)
  const baseAsset = useSim((s) => s.baseAsset)
  const cancel = useSim((s) => s.spotCancelLimit)

  if (!orders || orders.length === 0) return null

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent">
          ⏳ Spot Limit{orders.length > 1 ? `s · ${orders.length}` : ''}
        </span>
        {orders.length > 1 && (
          <button
            onClick={() => cancel()}
            className="rounded bg-panel2 px-2 py-0.5 text-[10px] font-semibold text-sub hover:text-down"
          >
            Cancel all
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {orders.map((o) => {
          const buy = o.side === 'long'
          const part = o.filled > 1e-6
          const rem = o.qty - (o.filled || 0)
          return (
            <div key={o.id} className="flex items-center justify-between gap-2 font-mono text-xs">
              <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${buy ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
                {buy ? 'BUY' : 'SELL'}
              </span>
              <span className="text-accent">@ {fmtPrice(o.price, dp)}</span>
              <span className="text-[10px] text-sub">
                {fmtQty(rem)} {baseAsset}
                {buy ? ` · ${usd((o.reservedUsd || 0) * (rem / (o.qty || 1)))}` : ''}
                {part ? ` · ${Math.round((o.filled / o.qty) * 100)}%` : ''}
              </span>
              <button
                onClick={() => cancel(o.id)}
                className="rounded bg-panel2 px-2 py-0.5 text-[10px] font-semibold text-txt hover:text-down"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
