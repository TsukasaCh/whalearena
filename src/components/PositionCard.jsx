import { useSim } from '../store/useSimStore'
import { unrealizedPnl, roe, distanceToLiq } from '../lib/trading'
import { usd, fmt, fmtPrice, fmtQty, pct, signedUsd } from '../lib/format'
import { Stat } from './ui'
import ManagePosition from './ManagePosition'

function PendingList() {
  const pendingOrders = useSim((s) => s.pendingOrders)
  const dp = useSim((s) => s.dp)
  const cancelLimit = useSim((s) => s.cancelLimit)
  if (!pendingOrders.length) return null
  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent">
          ⏳ Pending Limit{pendingOrders.length > 1 ? `s · ${pendingOrders.length}` : ''}
        </span>
        {pendingOrders.length > 1 && (
          <button
            onClick={() => cancelLimit()}
            className="rounded bg-panel2 px-2 py-0.5 text-[10px] font-semibold text-sub hover:text-down"
          >
            Cancel all
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {pendingOrders.map((o) => {
          const part = o.filled > 0.000001
          return (
            <div key={o.id} className="flex items-center justify-between gap-2 font-mono text-xs">
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                  o.side === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'
                }`}
              >
                {o.side === 'long' ? 'BUY' : 'SELL'} {o.leverage}x
              </span>
              <span className="text-accent">@ {fmtPrice(o.price, dp)}</span>
              <span className="text-[10px] text-sub">
                {usd(o.margin)}
                {part ? ` · ${Math.round((o.filled / o.qty) * 100)}% filled` : ''}
              </span>
              <button
                onClick={() => cancelLimit(o.id)}
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

export default function PositionCard() {
  const position = useSim((s) => s.position)
  const hasPending = useSim((s) => s.pendingOrders.length > 0)
  const price = useSim((s) => s.price)
  const dp = useSim((s) => s.dp)
  const baseAsset = useSim((s) => s.baseAsset)
  const closePosition = useSim((s) => s.closePosition)

  if (!position) {
    return (
      <div className="space-y-3">
        <PendingList />
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border py-8 text-center">
          <span className="text-2xl opacity-40">📈</span>
          <span className="text-sm text-sub">No open position</span>
          <span className="text-xs text-sub/60">
            {hasPending ? 'Limit order(s) resting on the book' : 'Open a Long or Short to start'}
          </span>
        </div>
      </div>
    )
  }

  const isLong = position.side === 'long'
  const pnl = unrealizedPnl({ side: position.side, entry: position.entry, price, qty: position.qty })
  const pnlRoe = roe(pnl, position.margin)
  const win = pnl >= 0
  const dist = distanceToLiq(price, position.liq)
  const danger = dist < 0.02 // within 2% of liquidation
  const warn = dist < 0.06

  // progress bar: how far price has traveled from entry toward liq (0..1)
  const span = Math.abs(position.entry - position.liq) || 1
  const traveled = Math.min(1, Math.max(0, Math.abs(price - position.entry) / span))
  const towardLiq = isLong ? price < position.entry : price > position.entry

  return (
    <div className="space-y-3">
    <PendingList />
    <div
      className={`rounded-lg border bg-panel p-3 ${
        danger ? 'animate-shake border-down shadow-[0_0_20px_rgba(255,82,82,0.35)]' : 'border-border'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold ${
              isLong ? 'bg-up/15 text-up' : 'bg-down/15 text-down'
            }`}
          >
            {isLong ? 'LONG' : 'SHORT'} · {position.leverage}x
          </span>
          <span className="text-xs text-sub">Isolated</span>
        </div>
        <button
          onClick={closePosition}
          className="rounded bg-panel2 px-2.5 py-1 text-xs font-semibold text-txt hover:bg-border"
        >
          Close
        </button>
      </div>

      {/* PnL headline */}
      <div className="mb-3 rounded-md bg-panel2/60 p-3 text-center">
        <div className="text-[10px] uppercase tracking-wide text-sub">Unrealized PnL</div>
        <div className={`font-mono text-2xl font-bold ${win ? 'text-up' : 'text-down'}`}>
          {signedUsd(pnl)}
        </div>
        <div className={`font-mono text-sm font-semibold ${win ? 'text-up' : 'text-down'}`}>
          {pct(pnlRoe)} ROE
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-y-2">
        <Stat label="Entry Price" value={fmtPrice(position.entry, dp)} valueClass="text-accent" />
        <Stat label="Mark Price" value={fmtPrice(price, dp)} />
        <Stat label="Margin" value={usd(position.margin)} />
        <Stat label="Size" value={`${fmtQty(position.qty)} ${baseAsset}`} />
        <Stat label="Fees Paid" value={usd(-(position.fees || 0))} valueClass="text-sub" />
        <Stat
          label="Funding"
          value={signedUsd(position.funding || 0)}
          valueClass={(position.funding || 0) >= 0 ? 'text-up' : 'text-down'}
        />
        <Stat
          label="Take Profit"
          value={position.tp ? fmtPrice(position.tp, dp) : '—'}
          valueClass="text-up"
        />
        <Stat
          label="Stop Loss"
          value={position.sl ? fmtPrice(position.sl, dp) : '—'}
          valueClass="text-down"
        />
      </div>

      {/* Liquidation meter */}
      <div className={`rounded-md p-2 ${danger ? 'bg-down/15' : 'bg-panel2/60'}`}>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className={`font-semibold ${danger ? 'animate-flash text-down' : 'text-sub'}`}>
            {danger ? '☠ LIQUIDATION IMMINENT' : 'Liquidation Price'}
          </span>
          <span className="font-mono font-bold text-down">{fmtPrice(position.liq, dp)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className={`h-full rounded-full transition-all duration-200 ${
              danger ? 'bg-down' : warn ? 'bg-gold' : 'bg-up'
            }`}
            style={{ width: `${(towardLiq ? traveled : 0) * 100}%` }}
          />
        </div>
        <div className="mt-1 text-right font-mono text-[10px] text-sub">
          {fmt(dist * 100)}% away
        </div>
      </div>

      <ManagePosition key={position.openedAt} position={position} />
    </div>
    </div>
  )
}
