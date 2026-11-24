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
    <div className="rounded-xl bg-panel2/50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-txt">The Crowd</span>
        <span className="font-mono text-xs text-txt">
          {crowd.traders} <span className="text-sub">bots</span>
          {crowd.realTraders > 0 && (
            <>
              {' '}
              <span className="text-sub">·</span> <span className="text-accent">{crowd.realTraders} live</span>
            </>
          )}
        </span>
      </div>

      {/* Long vs Short open interest */}
      <div className="mb-1.5 flex justify-between font-mono text-[11px]">
        <span className="text-up">Long ${compact(crowd.longOI)}</span>
        <span className="text-down">${compact(crowd.shortOI)} Short</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-down">
        <div className="h-full bg-up" style={{ width: `${longPct}%` }} />
      </div>

      {/* Rekt + harvested */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className={`min-w-0 rounded-lg px-2 py-2.5 text-center transition-colors ${flash ? 'bg-down/25' : 'bg-panel2'}`}>
          <div className="text-[11px] text-sub">☠ Rekt</div>
          <div className={`mt-0.5 truncate font-mono text-base font-semibold ${flash ? 'text-down' : 'text-txt'}`}>
            {crowd.liquidatedTotal}
          </div>
        </div>
        <div className="min-w-0 rounded-lg bg-panel2 px-2 py-2.5 text-center">
          <div className="text-[11px] text-sub">Harvested</div>
          <div className="mt-0.5 truncate font-mono text-base font-semibold text-gold">{usd(crowd.harvested, 0)}</div>
        </div>
        <div className="min-w-0 rounded-lg bg-panel2 px-2 py-2.5 text-center">
          <div className="text-[11px] text-sub">Fees</div>
          <div className="mt-0.5 truncate font-mono text-base font-semibold text-gold">${compact(crowd.fees || 0)}</div>
        </div>
      </div>

      {/* Auto-hunt toggle */}
      <button
        onClick={() => mm('auto')}
        className={`mt-3 w-full rounded-full px-3 py-2.5 text-[13px] font-semibold transition ${
          crowd.autoHunt
            ? 'bg-gold text-black hover:brightness-110'
            : 'bg-panel2 text-sub hover:bg-panel3 hover:text-txt'
        }`}
      >
        Auto-Hunt: {crowd.autoHunt ? 'ON — squeezing the crowd' : 'OFF'}
      </button>
      <p className="mt-2 text-center text-[11px] leading-relaxed text-sub">
        When ON, the Whale autonomously pumps/dumps to trap FOMO, then wicks into the crowded side's
        liquidations.
      </p>
    </div>
  )
}
