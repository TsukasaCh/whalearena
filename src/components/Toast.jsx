import { useEffect, useRef } from 'react'
import { useSim } from '../store/useSimStore'
import { signedUsd, fmtPrice } from '../lib/format'
import { playLiquidation, playProfit, playClose } from '../lib/sound'

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
    else if (toast.type === 'tp' || toast.type === 'limitFill') playProfit()
    else if (toast.type !== 'error') playClose()
    const t = setTimeout(dismiss, toast.type === 'liq' ? 3800 : 2600)
    return () => clearTimeout(t)
  }, [toast, dismiss])

  if (!toast) return null

  if (toast.type === 'error') {
    return (
      <div className="animate-rise fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-lg border border-down/40 bg-panel px-4 py-2.5 shadow-lg">
          <span className="text-lg">⚠️</span>
          <span className="text-xs font-semibold text-down">{toast.msg}</span>
        </div>
      </div>
    )
  }

  if (toast.type === 'liq') {
    return (
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 animate-flash bg-down/10" />
        <div className="animate-pop pointer-events-auto rounded-2xl border-2 border-down bg-panel/95 px-10 py-6 text-center shadow-[0_0_60px_rgba(255,82,82,0.5)]">
          <div className="text-5xl">☠️</div>
          <div className="mt-1 text-3xl font-extrabold tracking-tight text-down">LIQUIDATED!</div>
          <div className="mt-1 text-sm text-sub">
            {toast.side?.toUpperCase()} position wiped at {fmtPrice(toast.price, dp)}
          </div>
          <div className="mt-2 font-mono text-lg font-bold text-down">{signedUsd(toast.pnl)}</div>
          <button
            onClick={dismiss}
            className="mt-3 rounded-md bg-down px-4 py-1.5 text-xs font-bold text-black hover:brightness-110"
          >
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  if (toast.type === 'limitFill') {
    return (
      <div className="animate-rise fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-panel px-4 py-2.5 shadow-lg">
          <span className="text-lg">🎯</span>
          <div>
            <div className="text-xs font-semibold text-txt">Limit Order Filled</div>
            <div className="text-[10px] text-sub">
              {sym}{toast.side?.toUpperCase()} @ {fmtPrice(toast.price, dp)}
            </div>
          </div>
        </div>
      </div>
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
    <div className="animate-rise fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div
        className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 shadow-lg ${
          win ? 'border-up/40 bg-panel' : 'border-down/40 bg-panel'
        }`}
      >
        <span className="text-lg">{win ? '✅' : '🔻'}</span>
        <div>
          <div className="text-xs font-semibold text-txt">{label}</div>
          <div className="text-[10px] text-sub">{sym}@ {fmtPrice(toast.price, dp)}</div>
        </div>
        <div className={`font-mono text-sm font-bold ${win ? 'text-up' : 'text-down'}`}>
          {signedUsd(toast.pnl)}
        </div>
      </div>
    </div>
  )
}
