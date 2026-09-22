import { useSim } from '../store/useSimStore'
import { usd, signedUsd } from '../lib/format'
import OrderForm from './OrderForm'
import PositionCard from './PositionCard'
import OrderBook from './OrderBook'

export default function RetailPanel() {
  const equity = useSim((s) => s.equity)
  const history = useSim((s) => s.history)

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-accent/15 text-accent">
            👤
          </span>
          <span className="text-sm font-bold text-txt">Retail Trader</span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-sub">Equity</div>
          <div className="font-mono text-sm font-semibold text-txt">{usd(equity)}</div>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <PositionCard />
        <div className="rounded-lg border border-border bg-panel p-3">
          <OrderBook />
        </div>
        <div className="border-t border-border pt-3">
          <OrderForm />
        </div>

        {/* Trade history */}
        <div className="border-t border-border pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">
            Recent Trades
          </div>
          {history.length === 0 ? (
            <div className="py-2 text-center text-xs text-sub/60">No closed trades yet</div>
          ) : (
            <div className="space-y-1">
              {history.slice(0, 6).map((h, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded bg-panel2/50 px-2 py-1 font-mono text-xs"
                >
                  <span className={h.side === 'long' ? 'text-up' : 'text-down'}>
                    <span className="text-sub">{h.symbol}</span> {h.side === 'long' ? 'L' : 'S'} {h.leverage}x
                  </span>
                  <span className="text-sub">
                    {h.reason === 'liq'
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
