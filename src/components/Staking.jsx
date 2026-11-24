import { useEffect, useState } from 'react'
import { useSim, STAKE_APY, accruedStake } from '../store/useSimStore'
import { usd, fmtQty } from '../lib/format'

// Staking pocket for the active coin: move free spot coins in to earn 7% APY
// (compounds live), pull them back to spot to trade. Rewards are paid in-kind.
export default function Staking() {
  const baseAsset = useSim((s) => s.baseAsset)
  const price = useSim((s) => s.price) // spot price (active venue is spot here)
  const free = (useSim((s) => s.spot[s.symbol]) || { qty: 0 }).qty || 0
  const staked = useSim((s) => s.staked[s.symbol])
  const doStake = useSim((s) => s.stake)
  const doUnstake = useSim((s) => s.unstake)

  const [amt, setAmt] = useState('')
  const [unamt, setUnamt] = useState('')
  const [, force] = useState(0) // 1s ticker so the accrued balance grows live
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const liveQty = accruedStake(staked)
  const earned = staked ? (staked.earned || 0) + (liveQty - staked.qty) : 0
  const value = liveQty * price
  const perDay = (value * STAKE_APY) / 365

  const stake = () => { const q = Number(amt); if (q > 0) { doStake(q); setAmt('') } }
  const unstake = () => { const q = Number(unamt); if (q > 0) { doUnstake(q); setUnamt('') } }

  if (free <= 0 && !(staked && staked.qty > 0)) {
    return (
      <div className="rounded-xl bg-panel2/50 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-txt">Staking</span>
          <span className="rounded bg-up/15 px-1.5 py-0.5 text-[11px] font-semibold text-up">{(STAKE_APY * 100).toFixed(0)}% APY</span>
        </div>
        <div className="mt-1.5 text-xs leading-relaxed text-sub">Beli {baseAsset} spot dulu, lalu stake di sini untuk dapat yield.</div>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-panel2/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-txt">Staking</span>
        <span className="rounded bg-up/15 px-1.5 py-0.5 text-[11px] font-semibold text-up">{(STAKE_APY * 100).toFixed(0)}% APY</span>
      </div>

      {staked && staked.qty > 0 && (
        <div className="mt-3 border-b border-border pb-3">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-sub">Staked</div>
              <div className="font-mono text-lg font-semibold text-txt tabular-nums">{fmtQty(liveQty)} <span className="text-xs font-normal text-sub">{baseAsset}</span></div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[11px] text-sub">Value</div>
              <div className="font-mono text-[13px] font-medium text-txt">{usd(value)}</div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-xs">
            <span className="text-sub">Rewards earned</span>
            <span className="font-mono text-up tabular-nums">+{fmtQty(earned)} {baseAsset}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-sub/70">
            <span className="font-mono">≈ {usd(perDay)}/day</span>
            <span>in-kind</span>
          </div>

          {/* Unstake back to spot */}
          <div className="mt-3 flex items-center gap-2">
            <div className="field min-w-0 flex-1 bg-panel">
              <input
                type="number"
                value={unamt}
                placeholder="amount"
                onChange={(e) => setUnamt(e.target.value)}
              />
              <button onClick={() => setUnamt(String(Math.floor(liveQty * 1e8) / 1e8))} className="shrink-0 text-[11px] font-semibold text-accent hover:brightness-125">MAX</button>
            </div>
            <button onClick={unstake} className="btn btn-ghost shrink-0 bg-panel3/70 px-3.5 text-xs">
              Unstake →
            </button>
          </div>
        </div>
      )}

      {/* Stake from free spot */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-xs text-sub">
          <span>Stake from spot</span>
          <span className="font-mono">Free: <span className="text-txt">{fmtQty(free)} {baseAsset}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <div className="field min-w-0 flex-1 bg-panel">
            <input
              type="number"
              value={amt}
              placeholder="amount"
              onChange={(e) => setAmt(e.target.value)}
            />
            <button onClick={() => setAmt(String(Math.floor(free * 1e8) / 1e8))} className="shrink-0 text-[11px] font-semibold text-accent hover:brightness-125">MAX</button>
          </div>
          <button onClick={stake} disabled={free <= 0} className="btn btn-primary shrink-0 px-4 text-xs">
            Stake
          </button>
        </div>
      </div>
    </div>
  )
}
