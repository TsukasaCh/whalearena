import { useEffect, useState } from 'react'
import { useSim } from '../store/useSimStore'
import { usd, fmtPrice } from '../lib/format'

const clock = (sec) => {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

// Running TWAP / VWAP orders for the active futures market: progress, average
// fill vs. the market's VWAP since the order started, and a cancel button.
export default function AlgoOrders() {
  const algos = useSim((s) => s.algos)
  const dp = useSim((s) => s.dp)
  const cancelAlgo = useSim((s) => s.cancelAlgo)
  const clockOffset = useSim((s) => s.clockOffset)
  const [now, setNow] = useState(() => Date.now())
  const active = algos.length > 0
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  if (!active) return null

  return (
    <div className="rounded-xl bg-panel2/50 p-3">
      <div className="mb-2 text-[13px] font-semibold text-txt">
        Algo orders{algos.length > 1 ? ` · ${algos.length}` : ''}
      </div>
      <div className="divide-y divide-border">
        {algos.map((a) => {
          const long = a.side === 'long'
          const pct = a.margin > 0 ? Math.min(100, (a.filledMargin / a.margin) * 100) : 0
          const avg = a.filledQty > 0 ? a.cost / a.filledQty : null
          const bench = a.mVol > 0 ? a.mPV / a.mVol : null
          // better = bought below / sold above the market's volume-weighted price
          const edge = avg && bench ? ((long ? bench - avg : avg - bench) / bench) * 100 : null
          const left = (a.endAt - (now + clockOffset)) / 1000
          return (
            <div key={a.id} className="space-y-2 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="rounded bg-panel3 px-1.5 py-0.5 text-[11px] font-semibold text-txt">{a.type.toUpperCase()}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${long ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
                    {long ? 'Long' : 'Short'} {a.leverage}x
                  </span>
                  <span className="truncate font-mono text-[11px] text-sub">
                    {left > 0 ? `${clock(left)} left` : 'finishing…'}
                  </span>
                </span>
                <button onClick={() => cancelAlgo(a.id)} className="btn btn-outline btn-sm shrink-0 hover:!border-down hover:text-down">
                  Cancel
                </button>
              </div>

              <div>
                <div className="h-1 overflow-hidden rounded-full bg-panel3">
                  <div className={`h-full rounded-full transition-[width] duration-500 ${long ? 'bg-up' : 'bg-down'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[11px] text-sub">
                  <span>
                    <span className="text-txt">{usd(a.filledMargin)}</span> / {usd(a.margin)} margin
                  </span>
                  <span>
                    slice {Math.min(a.done, a.slices)}/{a.slices}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <div className="text-sub">Avg fill</div>
                  <div className="font-mono text-xs text-txt">{avg ? fmtPrice(avg, dp) : '—'}</div>
                </div>
                <div>
                  <div className="text-sub" title="Harga rata-rata pasar tertimbang volume sejak order dimulai">Market VWAP</div>
                  <div className="font-mono text-xs text-txt">{bench ? fmtPrice(bench, dp) : '—'}</div>
                </div>
                <div className="text-right">
                  <div className="text-sub" title="Selisih avg fill kamu terhadap VWAP pasar (positif = lebih baik)">vs VWAP</div>
                  <div className={`font-mono text-xs ${edge == null ? 'text-txt' : edge >= 0 ? 'text-up' : 'text-down'}`}>
                    {edge == null ? '—' : `${edge >= 0 ? '+' : ''}${edge.toFixed(3)}%`}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
