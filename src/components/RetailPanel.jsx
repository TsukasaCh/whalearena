import { useSim } from '../store/useSimStore'
import { usd, signedUsd } from '../lib/format'
import OrderForm from './OrderForm'
import SpotForm from './SpotForm'
import PositionCard from './PositionCard'
import SpotHolding from './SpotHolding'
import SpotPending from './SpotPending'
import Staking from './Staking'
import OrderBook from './OrderBook'
import AlgoOrders from './AlgoOrders'

// One trading surface for a single mode — Spot or Perpetual — kept separate like
// a real exchange. The chart is shared; on wide screens the order book gets its
// own column next to the trade panel (OKX layout), otherwise they stack.
export default function RetailPanel({ mode = 'perp' }) {
  const equity = useSim((s) => s.equity)
  const balance = useSim((s) => s.balance)
  const history = useSim((s) => s.history)
  const isSpot = mode === 'spot'
  const trades = history.filter((h) => (isSpot ? h.kind === 'spot' : h.kind !== 'spot'))

  return (
    <div className="flex flex-col gap-1 lg:h-full lg:overflow-y-auto xl:flex-row xl:overflow-hidden">
      {/* order book column */}
      <div className="order-2 rounded-lg bg-panel p-3 xl:order-1 xl:w-[272px] xl:shrink-0 xl:overflow-y-auto">
        <OrderBook />
      </div>

      {/* trade column */}
      <div className="order-1 rounded-lg bg-panel xl:order-2 xl:min-w-0 xl:flex-1 xl:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-txt">{isSpot ? 'Spot' : 'Perpetual'}</div>
            <div className="text-[11px] text-sub">{isSpot ? 'No leverage' : 'Isolated margin'}</div>
          </div>
          <div className="text-right leading-tight">
            <div className="text-[11px] text-sub" title="Total nilai semua aset: saldo bebas + posisi + order limit + spot + staking">
              Equity · total assets
            </div>
            <div className="font-mono text-sm font-semibold text-txt">{usd(equity)}</div>
            <div className="font-mono text-[11px] text-sub" title="Saldo bebas yang bisa dipakai buka order baru">
              Available {usd(balance)}
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {isSpot ? (
            <>
              <AlgoOrders spot />
              <SpotPending />
              <SpotHolding />
              <Staking />
            </>
          ) : (
            <>
              <AlgoOrders />
              <PositionCard />
            </>
          )}

          <div className="border-t border-border pt-4">{isSpot ? <SpotForm /> : <OrderForm />}</div>

          {/* Trade history (this mode only) */}
          <div className="border-t border-border pt-4">
            <div className="mb-2 text-[13px] font-semibold text-txt">
              Recent {isSpot ? 'spot trades' : 'trades'}
            </div>
            {trades.length === 0 ? (
              <div className="py-3 text-center text-xs text-sub/70">
                No {isSpot ? 'spot ' : ''}closed trades yet
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {trades.slice(0, 6).map((h, i) => {
                  const spot = h.kind === 'spot'
                  return (
                    <div key={i} className="flex items-center justify-between gap-2 py-1.5 font-mono text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium text-txt">{h.symbol}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            spot || h.side !== 'long' ? 'bg-down/15 text-down' : 'bg-up/15 text-up'
                          }`}
                        >
                          {spot ? 'Sell' : `${h.side === 'long' ? 'Long' : 'Short'} ${h.leverage}x`}
                        </span>
                      </span>
                      <span className="text-sub">
                        {spot
                          ? 'spot'
                          : h.reason === 'liq'
                            ? '☠ liq'
                            : h.reason === 'tp'
                              ? 'TP'
                              : h.reason === 'sl'
                                ? 'SL'
                                : h.reason === 'trail'
                                  ? 'TRAIL'
                                  : 'close'}
                      </span>
                      <span className={h.pnl >= 0 ? 'text-up' : 'text-down'}>{signedUsd(h.pnl)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
