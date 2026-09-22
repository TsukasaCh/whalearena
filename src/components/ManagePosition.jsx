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
    'w-full rounded-md border border-border bg-panel2 px-2 py-1.5 font-mono text-xs outline-none placeholder:text-sub/40'

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-panel2/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sub">Manage Position</div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-0.5 text-[10px] text-sub">Stop Loss</div>
          <input
            type="number"
            value={sl}
            placeholder="—"
            onChange={(e) => setSl(e.target.value)}
            className={`${inputCls} text-down`}
          />
        </div>
        <div>
          <div className="mb-0.5 text-[10px] text-sub">Take Profit</div>
          <input
            type="number"
            value={tp}
            placeholder="—"
            onChange={(e) => setTp(e.target.value)}
            className={`${inputCls} text-up`}
          />
        </div>
      </div>
      <button
        onClick={applyTpSl}
        className="w-full rounded-md bg-panel2 py-1.5 text-xs font-bold text-txt hover:bg-border"
      >
        Update TP / SL
      </button>

      <div className="border-t border-border pt-2">
        <div className="mb-0.5 flex items-center justify-between text-[10px] text-sub">
          <span>Trailing Stop (callback %)</span>
          {position.trail && position.trailLevel && (
            <span className="text-gold">
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
            className={`${inputCls} flex-1 text-gold`}
          />
          <button
            onClick={applyTrail}
            className="rounded-md bg-gold/20 px-3 py-1.5 text-xs font-bold text-gold hover:bg-gold/30"
          >
            Set
          </button>
          {position.trail && (
            <button
              onClick={stopTrail}
              className="rounded-md bg-panel2 px-2 py-1.5 text-xs font-semibold text-sub hover:text-down"
            >
              Off
            </button>
          )}
        </div>
        <div className="mt-1 text-[10px] text-sub/60">
          Stop follows price and triggers on a {trail || '—'}% pullback from the peak.
        </div>
      </div>
    </div>
  )
}
