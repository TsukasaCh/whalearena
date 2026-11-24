import { useSim } from '../store/useSimStore'
import { usd, fmtPrice, fmtQty } from '../lib/format'

// Resting SPOT limit orders for the active symbol — buy ladders (accumulate)
// and sell ladders (distribute). Side long = buy, short = sell.
export default function SpotPending() {
  const all = useSim((s) => s.spotPending)
  const orders = all.filter((o) => !o.grid) // grid-bot orders live in the Grid bot card
  const dp = useSim((s) => s.dp)
  const baseAsset = useSim((s) => s.baseAsset)
  const cancel = useSim((s) => s.spotCancelLimit)

  if (!orders || orders.length === 0) return null

  return (
    <div className="rounded-xl bg-panel2/50 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-txt">
          Spot Limit{orders.length > 1 ? `s · ${orders.length}` : ''}
        </span>
        {orders.length > 1 && (
          <button
            onClick={() => cancel()}
            className="rounded-full bg-panel3/70 px-2.5 py-1 text-[11px] font-medium text-sub transition-colors hover:bg-panel3 hover:text-down"
          >
            Cancel all
          </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {orders.map((o) => {
          const buy = o.side === 'long'
          const part = o.filled > 1e-6
          const rem = o.qty - (o.filled || 0)
          return (
            <div key={o.id} className="flex items-center gap-2 py-2 text-xs last:pb-0">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${buy ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
                {buy ? 'BUY' : 'SELL'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[13px] font-medium text-txt">
                  @ {fmtPrice(o.price, dp)}
                  {o.visFrac > 0 && (
                  <span className="ml-1.5 rounded bg-panel3 px-1 py-px text-[10px] font-semibold text-sub" title="Iceberg: hanya sebagian ukuran yang terlihat di order book">
                    Iceberg {Math.round(o.visFrac * 100)}%
                  </span>
                )}
                </div>
                <div className="truncate font-mono text-[11px] text-sub">
                  {fmtQty(rem)} {baseAsset}
                  {buy ? ` · ${usd((o.reservedUsd || 0) * (rem / (o.qty || 1)))}` : ''}
                  {part ? ` · ${Math.round((o.filled / o.qty) * 100)}%` : ''}
                </div>
              </div>
              <button
                onClick={() => cancel(o.id)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel3/70 text-[11px] text-sub transition-colors hover:bg-panel3 hover:text-down"
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
