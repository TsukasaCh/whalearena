import { useEffect, useRef, useState } from 'react'
import { useSim } from '../store/useSimStore'
import { usd, compact } from '../lib/format'

// The crowd (bots + real traders) overview + the autonomous hunt toggle.
export default function CrowdStats() {
  const crowd = useSim((s) => s.crowd)
  const lastLiqEvent = useSim((s) => s.lastLiqEvent)
  const mm = useSim((s) => s.mm)

  const totalOI = crowd.longOI + crowd.shortOI || 1
  const longPct = (crowd.longOI / totalOI) * 100

  // brief flash on the rekt counter when a fresh liquidation lands
  const [flash, setFlash] = useState(false)
  const lastId = useRef(null)
  useEffect(() => {
    if (!lastLiqEvent || lastLiqEvent.id === lastId.current) return
    lastId.current = lastLiqEvent.id
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 500)
    return () => clearTimeout(t)
  }, [lastLiqEvent])

  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-sub">👥 The Crowd</span>
        <span className="font-mono text-xs text-txt">
          {crowd.traders} <span className="text-sub">bots</span>
          {crowd.realTraders > 0 && (
            <>
              {' '}
              · <span className="text-accent">{crowd.realTraders}👤 live</span>
            </>
          )}
        </span>
      </div>

      {/* Long vs Short open interest */}
      <div className="mb-1 flex justify-between font-mono text-[10px]">
        <span className="text-up">Long ${compact(crowd.longOI)}</span>
        <span className="text-down">${compact(crowd.shortOI)} Short</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-down/60">
        <div className="h-full bg-up/70" style={{ width: `${longPct}%` }} />
      </div>

      {/* Rekt + harvested */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className={`rounded-md p-2 text-center transition-colors ${flash ? 'bg-down/25' : 'bg-panel2/60'}`}>
          <div className="text-[10px] uppercase tracking-wide text-sub">☠ Rekt</div>
          <div className={`font-mono text-lg font-bold ${flash ? 'text-down' : 'text-txt'}`}>
            {crowd.liquidatedTotal}
          </div>
        </div>
        <div className="rounded-md bg-panel2/60 p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-sub">💰 Harvested</div>
          <div className="font-mono text-lg font-bold text-gold">{usd(crowd.harvested, 0)}</div>
        </div>
        <div className="rounded-md bg-panel2/60 p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-sub">🧾 Fees</div>
          <div className="font-mono text-lg font-bold text-gold">${compact(crowd.fees || 0)}</div>
        </div>
      </div>

      {/* Auto-hunt toggle */}
      <button
        onClick={() => mm('auto')}
        className={`mt-3 w-full rounded-md py-2.5 text-sm font-bold transition-colors ${
          crowd.autoHunt
            ? 'bg-gold text-black shadow-[0_0_18px_rgba(240,185,11,0.5)]'
            : 'bg-panel2 text-sub hover:text-txt'
        }`}
      >
        🤖 Auto-Hunt: {crowd.autoHunt ? 'ON — squeezing the crowd' : 'OFF'}
      </button>
      <p className="mt-1.5 text-center text-[10px] leading-tight text-sub/70">
        When ON, the Whale autonomously pumps/dumps to trap FOMO, then wicks into the crowded side's
        liquidations.
      </p>
    </div>
  )
}
