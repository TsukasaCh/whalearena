import { useSim } from '../store/useSimStore'
import { usd, signedUsd } from '../lib/format'
import OrderForm from './OrderForm'
import SpotForm from './SpotForm'
import PositionCard from './PositionCard'
import SpotHolding from './SpotHolding'
import SpotPending from './SpotPending'
import Staking from './Staking'
import OrderBook from './OrderBook'

// One trading surface for a single mode — Spot or Perpetual — kept separate like
// a real exchange. The chart/order book is shared; this panel swaps the position
// card, the order form and the trade history for the active mode.
export default function RetailPanel({ mode = 'perp' }) {
  const equity = useSim((s) => s.equity)
  const history = useSim((s) => s.history)
  const isSpot = mode === 'spot'
  const trades = history.filter((h) => (isSpot ? h.kind === 'spot' : h.kind !== 'spot'))

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-accent/15 text-accent">
            {isSpot ? '💰' : '⚡'}
          </span>
          <span className="text-sm font-bold text-txt">{isSpot ? 'Spot' : 'Perpetual'}</span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-sub">Equity</div>
          <div className="font-mono text-sm font-semibold text-txt">{usd(equity)}</div>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {isSpot ? (
          <>
            <SpotPending />
            <SpotHolding />
            <Staking />
          </>
        ) : (
          <PositionCard />
        )}
        <div className="rounded-lg border border-border bg-panel p-3">
          <OrderBook />
        </div>
        <div className="border-t border-border pt-3">
          {isSpot ? <SpotForm /> : <OrderForm />}
        </div>

        {/* Trade history (this mode only) */}
        <div className="border-t border-border pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">
            Recent {isSpot ? 'Spot Trades' : 'Trades'}
          </div>
          {trades.length === 0 ? (
            <div className="py-2 text-center text-xs text-sub/60">
              No {isSpot ? 'spot ' : ''}closed trades yet
            </div>
          ) : (
            <div className="space-y-1">
              {trades.slice(0, 6).map((h, i) => {
                const spot = h.kind === 'spot'
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded bg-panel2/50 px-2 py-1 font-mono text-xs"
                  >
                    <span className={spot ? 'text-down' : h.side === 'long' ? 'text-up' : 'text-down'}>
                      <span className="text-sub">{h.symbol}</span>{' '}
                      {spot ? 'SELL' : `${h.side === 'long' ? 'L' : 'S'} ${h.leverage}x`}
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
  )
}
