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
    <div className="rounded-xl bg-panel2/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-txt">
          Pending Limit{pendingOrders.length > 1 ? `s · ${pendingOrders.length}` : ''}
        </span>
        {pendingOrders.length > 1 && (
          <button
            onClick={() => cancelLimit()}
            className="rounded-full bg-panel2 px-2.5 py-1 text-[11px] font-medium text-sub transition-colors hover:bg-panel3 hover:text-down"
          >
            Cancel all
          </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {pendingOrders.map((o) => {
          const part = o.filled > 0.000001
          return (
            <div key={o.id} className="flex items-center gap-2 py-2 text-xs first:pt-0 last:pb-0">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                  o.side === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'
                }`}
              >
                {o.side === 'long' ? 'BUY' : 'SELL'} {o.leverage}x
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[13px] font-medium text-txt">@ {fmtPrice(o.price, dp)}</div>
                <div className="truncate font-mono text-[11px] text-sub">
                  {usd(o.margin)}
                  {part ? ` · ${Math.round((o.filled / o.qty) * 100)}% filled` : ''}
                </div>
              </div>
              <button
                onClick={() => cancelLimit(o.id)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel2 text-[11px] text-sub transition-colors hover:bg-panel3 hover:text-down"
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
        <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-panel2/40 px-4 py-10 text-center">
          <span className="text-[13px] font-medium text-txt">No open position</span>
          <span className="text-xs text-sub">
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
      className={`rounded-xl bg-panel2/50 p-3 ${
        danger ? 'animate-shake shadow-[0_0_0_1px_rgba(202,63,100,0.7),0_0_24px_rgba(202,63,100,0.35)]' : ''
      }`}
    >
      {/* Header: side badge · leverage · margin mode · close */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
              isLong ? 'bg-up/15 text-up' : 'bg-down/15 text-down'
            }`}
          >
            {isLong ? 'LONG' : 'SHORT'} · {position.leverage}x
          </span>
          <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] font-medium text-sub">Isolated</span>
        </div>
        <button onClick={closePosition} className="btn btn-ghost btn-sm shrink-0">
          Close
        </button>
      </div>

      {/* PnL headline */}
      <div className="mt-4">
        <div className="text-xs text-sub">Unrealized PnL</div>
        <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2">
          <span className={`font-mono text-2xl font-semibold leading-tight ${win ? 'text-up' : 'text-down'}`}>
            {signedUsd(pnl)}
          </span>
          <span className={`font-mono text-[13px] font-medium ${win ? 'text-up' : 'text-down'}`}>
            {pct(pnlRoe)} ROE
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3">
        <Stat label="Entry Price" value={fmtPrice(position.entry, dp)} valueClass="text-txt" />
        <Stat label="Mark Price" value={fmtPrice(price, dp)} valueClass="text-txt" />
        <Stat label="Margin" value={usd(position.margin)} valueClass="text-txt" />
        <Stat label="Size" value={`${fmtQty(position.qty)} ${baseAsset}`} valueClass="text-txt" />
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
      <div className={`mt-3 ${danger ? 'rounded-lg bg-down/10 p-3' : 'border-t border-border pt-3'}`}>
        <div className="flex items-center justify-between text-xs">
          <span className={danger ? 'animate-flash font-semibold text-down' : 'text-sub'}>
            {danger ? '☠ LIQUIDATION IMMINENT' : 'Liquidation Price'}
          </span>
          <span className="shrink-0 font-mono text-[13px] font-medium text-down">{fmtPrice(position.liq, dp)}</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel3">
          <div
            className={`h-full rounded-full transition-all duration-200 ${
              danger ? 'bg-down' : warn ? 'bg-gold' : 'bg-up'
            }`}
            style={{ width: `${(towardLiq ? traveled : 0) * 100}%` }}
          />
        </div>
        <div className="mt-1.5 text-right font-mono text-[11px] text-sub">
          {fmt(dist * 100)}% away
        </div>
      </div>

      <ManagePosition key={position.openedAt} position={position} />
    </div>
    </div>
  )
}
