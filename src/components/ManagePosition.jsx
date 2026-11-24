import { useState } from 'react'
import { useSim } from '../store/useSimStore'
import { fmt, fmtPrice } from '../lib/format'

// Edit SL/TP and the trailing stop on an already-open position.
export default function ManagePosition({ position }) {
  const modify = useSim((s) => s.modifyPosition)
  const dp = useSim((s) => s.dp)
  const [sl, setSl] = useState(position.sl ? String(position.sl) : '')
  const [tp, setTp] = useState(position.tp ? String(position.tp) : '')
  const [trail, setTrail] = useState(position.trail ? String(Math.round(position.trail.pct * 1000) / 10) : '')

  const applyTpSl = () => modify({ sl: sl ? Number(sl) : null, tp: tp ? Number(tp) : null })
  const applyTrail = () => modify({ trailPct: trail ? Number(trail) : 0 })
  const stopTrail = () => {
    setTrail('')
    modify({ trailPct: 0 })
  }

  const inputCls =
    'w-full rounded-lg border border-transparent bg-panel2 px-3 py-2 font-mono text-sm outline-none placeholder:text-sub/50 hover:border-panel3 focus:border-sub'

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="text-[13px] font-semibold text-txt">Manage Position</div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs text-sub">Stop Loss</div>
          <input
            type="number"
            value={sl}
            placeholder="—"
            onChange={(e) => setSl(e.target.value)}
            className={`${inputCls} text-down`}
          />
        </div>
        <div>
          <div className="mb-1 text-xs text-sub">Take Profit</div>
          <input
            type="number"
            value={tp}
            placeholder="—"
            onChange={(e) => setTp(e.target.value)}
            className={`${inputCls} text-up`}
          />
        </div>
      </div>
      <button onClick={applyTpSl} className="btn btn-ghost w-full py-2 text-[13px]">
        Update TP / SL
      </button>

      <div className="border-t border-border pt-3">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-sub">
          <span>Trailing Stop (callback %)</span>
          {position.trail && position.trailLevel && (
            <span className="shrink-0 font-mono text-[11px] text-gold">
              @ {fmtPrice(position.trailLevel, dp)} · {fmt(position.trail.pct * 100, 2)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            value={trail}
            placeholder="e.g. 1.0"
            onChange={(e) => setTrail(e.target.value)}
            className={`${inputCls} min-w-0 flex-1 text-gold`}
          />
          <button onClick={applyTrail} className="btn btn-ghost shrink-0 text-[13px]">
            Set
          </button>
          {position.trail && (
            <button
              onClick={stopTrail}
              className="btn btn-outline shrink-0 text-[13px] text-sub hover:text-down"
            >
              Off
            </button>
          )}
        </div>
        <div className="mt-1.5 text-[11px] leading-relaxed text-sub">
          Stop follows price and triggers on a {trail || '—'}% pullback from the peak.
        </div>
      </div>
    </div>
  )
}
