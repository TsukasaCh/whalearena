import { useEffect, useRef } from 'react'
import { useSim } from '../store/useSimStore'
import { signedUsd, fmtPrice, fmtQty, usd } from '../lib/format'
import { playLiquidation, playProfit, playClose } from '../lib/sound'

const DOT = {
  up: 'bg-up',
  down: 'bg-down',
  accent: 'bg-accent',
  neutral: 'bg-sub',
}

// Floating toast shell: soft dark pill-card with a small status dot.
function Shell({ tone = 'neutral', children }) {
  return (
    <div className="animate-rise fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
      <div className="flex max-w-[92vw] items-center gap-3 rounded-2xl border border-white/5 bg-panel2 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
        {children}
      </div>
    </div>
  )
}

function Body({ title, sub }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] font-semibold text-txt">{title}</div>
      {sub && <div className="mt-0.5 text-[11px] text-sub">{sub}</div>}
    </div>
  )
}

export default function Toast() {
  const toast = useSim((s) => s.toast)
  const symbols = useSim((s) => s.symbols)
  const dismiss = useSim((s) => s.dismissToast)
  const lastId = useRef(null)
  const dp = (toast && symbols.find((x) => x.symbol === toast.symbol)?.dp) ?? 2
  const sym = toast?.symbol ? toast.symbol + ' ' : ''

  useEffect(() => {
    if (!toast || toast.id === lastId.current) return
    lastId.current = toast.id
    if (toast.type === 'liq') playLiquidation()
    else if (toast.type === 'tp' || toast.type === 'limitFill' || toast.type === 'spotLimitFill' || toast.type === 'spotBuy' || toast.type === 'stakeReward') playProfit()
    else if (toast.type !== 'error' && toast.type !== 'funding' && toast.type !== 'notice') playClose()
    const t = setTimeout(dismiss, toast.type === 'liq' ? 3800 : 2600)
    return () => clearTimeout(t)
  }, [toast, dismiss])

  if (!toast) return null

  if (toast.type === 'error') {
    return (
      <Shell tone="down">
        <span className="text-[13px] font-medium text-down">{toast.msg}</span>
      </Shell>
    )
  }

  if (toast.type === 'notice') {
    return (
      <Shell tone="up">
        <span className="text-[13px] font-medium text-txt">{toast.msg}</span>
      </Shell>
    )
  }

  if (toast.type === 'liq') {
    return (
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 animate-flash bg-down/10" />
        <div className="animate-pop pointer-events-auto w-full max-w-xs rounded-2xl border border-white/5 bg-panel2 px-8 py-7 text-center shadow-[0_0_0_1px_rgba(202,63,100,0.6),0_0_60px_rgba(202,63,100,0.45)]">
          <div className="text-4xl">☠️</div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-down">LIQUIDATED!</div>
          <div className="mt-1.5 text-[13px] text-sub">
            {toast.side?.toUpperCase()} position wiped at {fmtPrice(toast.price, dp)}
          </div>
          <div className="mt-3 font-mono text-2xl font-semibold text-down">{signedUsd(toast.pnl)}</div>
          <button
            onClick={dismiss}
            className="mt-5 w-full rounded-full bg-down py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  if (toast.type === 'funding') {
    const got = toast.amount >= 0
    return (
      <Shell tone={got ? 'up' : 'down'}>
        <Body
          title={<>Funding {got ? 'Received' : 'Paid'}</>}
          sub={<>{sym}{toast.side?.toUpperCase()} · rate {(toast.rate * 100).toFixed(4)}%</>}
        />
        <div className={`ml-2 font-mono text-sm font-semibold ${got ? 'text-up' : 'text-down'}`}>{signedUsd(toast.amount)}</div>
      </Shell>
    )
  }

  if (toast.type === 'algo') {
    const name = (toast.algo || '').toUpperCase()
    const done = toast.status === 'done'
    const title =
      done ? `${name} Completed`
        : toast.status === 'cancelled' ? `${name} Cancelled`
          : toast.status === 'failed' ? `${name} Stopped`
            : `${name} Ended`
    return (
      <Shell tone={done ? 'up' : toast.status === 'failed' ? 'down' : 'neutral'}>
        <Body
          title={title}
          sub={
            <>
              {sym}{toast.spot ? 'SPOT ' : ''}{toast.side?.toUpperCase()} ·{' '}
              {toast.spot && toast.side === 'sell'
                ? <>{fmtQty(toast.filledMargin || 0)} / {fmtQty(toast.margin || 0)} sold</>
                : <>{usd(toast.filledMargin || 0)} / {usd(toast.margin || 0)}{toast.spot ? '' : ' margin'}</>}
              {toast.avg ? <> · avg {fmtPrice(toast.avg, dp)}</> : null}
              {toast.status === 'failed' && toast.reason ? <> · {toast.reason}</> : null}
            </>
          }
        />
      </Shell>
    )
  }

  if (toast.type === 'limitFill') {
    return (
      <Shell tone="accent">
        <Body
          title="Limit Order Filled"
          sub={<>{sym}{toast.side?.toUpperCase()} @ {fmtPrice(toast.price, dp)}</>}
        />
      </Shell>
    )
  }

  if (toast.type === 'spotLimitFill') {
    const buy = toast.side === 'long' // spot long = buy, short = sell
    return (
      <Shell tone={buy ? 'up' : 'down'}>
        <Body
          title={<>Spot Limit {buy ? 'Buy' : 'Sell'} Filled{toast.partial ? ' (partial)' : ''}</>}
          sub={<>{sym}@ {fmtPrice(toast.price, dp)}</>}
        />
      </Shell>
    )
  }

  if (toast.type === 'stakeReward') {
    return (
      <Shell tone="up">
        <Body title="Staking Reward" sub="Hourly payout · 7% APY" />
        <div className="ml-2 font-mono text-sm font-semibold text-up">+{usd(toast.amount)}</div>
      </Shell>
    )
  }

  if (toast.type === 'staked') {
    const staking = toast.action === 'stake'
    return (
      <Shell tone="neutral">
        <Body
          title={staking ? 'Staked' : 'Unstaked'}
          sub={<>{sym}{fmtQty(toast.qty)} · {staking ? 'earning 7% APY' : 'back in spot'}</>}
        />
      </Shell>
    )
  }

  if (toast.type === 'spotBuy' || toast.type === 'spotSell') {
    const buy = toast.type === 'spotBuy'
    const win = (toast.pnl ?? 0) >= 0
    return (
      <Shell tone={buy ? 'up' : win ? 'up' : 'down'}>
        <Body
          title={buy ? 'Spot Buy Filled' : 'Spot Sell Filled'}
          sub={<>{sym}{fmtQty(toast.qty)} @ {fmtPrice(toast.price, dp)}</>}
        />
        {buy ? (
          <div className="ml-2 font-mono text-sm font-semibold text-txt">{usd(toast.cost)}</div>
        ) : (
          <div className={`ml-2 font-mono text-sm font-semibold ${win ? 'text-up' : 'text-down'}`}>{signedUsd(toast.pnl)}</div>
        )}
      </Shell>
    )
  }

  const win = toast.pnl >= 0
  const label =
    toast.type === 'tp'
      ? 'Take Profit Hit'
      : toast.type === 'sl'
        ? 'Stop Loss Hit'
        : toast.type === 'trail'
          ? 'Trailing Stop Hit'
          : 'Position Closed'
  return (
    <Shell tone={win ? 'up' : 'down'}>
      <Body title={label} sub={<>{sym}@ {fmtPrice(toast.price, dp)}</>} />
      <div className={`ml-2 font-mono text-sm font-semibold ${win ? 'text-up' : 'text-down'}`}>
        {signedUsd(toast.pnl)}
      </div>
    </Shell>
  )
}
