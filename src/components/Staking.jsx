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
      <div className="rounded-lg border border-border bg-panel p-3 text-center">
        <div className="text-xs font-semibold text-txt">🔒 Staking · <span className="text-up">{(STAKE_APY * 100).toFixed(0)}% APY</span></div>
        <div className="mt-1 text-[11px] text-sub/70">Beli {baseAsset} spot dulu, lalu stake di sini untuk dapat yield.</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-sub">🔒 Staking</span>
        <span className="rounded bg-up/15 px-2 py-0.5 text-[11px] font-bold text-up">{(STAKE_APY * 100).toFixed(0)}% APY</span>
      </div>

      {staked && staked.qty > 0 && (
        <div className="mb-3 rounded-md bg-panel2/60 p-2.5">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-sub">Staked</div>
              <div className="font-mono text-lg font-bold text-txt tabular-nums">{fmtQty(liveQty)} <span className="text-xs text-sub">{baseAsset}</span></div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-sub">Value</div>
              <div className="font-mono text-sm font-semibold text-txt">{usd(value)}</div>
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <span className="text-sub">Rewards earned</span>
            <span className="font-mono text-up tabular-nums">+{fmtQty(earned)} {baseAsset}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-sub/70">
            <span>≈ {usd(perDay)}/day</span>
            <span>in-kind</span>
          </div>

          {/* Unstake back to spot */}
          <div className="mt-2 flex items-center gap-1.5">
            <div className="flex flex-1 items-center rounded border border-border bg-panel2 px-2">
              <input
                type="number"
                value={unamt}
                placeholder="amount"
                onChange={(e) => setUnamt(e.target.value)}
                className="w-full bg-transparent px-1 py-1.5 font-mono text-xs text-txt outline-none placeholder:text-sub/40"
              />
              <button onClick={() => setUnamt(String(Math.floor(liveQty * 1e8) / 1e8))} className="text-[10px] font-semibold text-accent">MAX</button>
            </div>
            <button onClick={unstake} className="rounded bg-panel2 px-3 py-1.5 text-xs font-bold text-txt hover:bg-border">
              Unstake →
            </button>
          </div>
        </div>
      )}

      {/* Stake from free spot */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-sub">
          <span>Stake from spot</span>
          <span className="font-mono">Free: {fmtQty(free)} {baseAsset}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex flex-1 items-center rounded border border-border bg-panel2 px-2">
            <input
              type="number"
              value={amt}
              placeholder="amount"
              onChange={(e) => setAmt(e.target.value)}
              className="w-full bg-transparent px-1 py-1.5 font-mono text-xs text-txt outline-none placeholder:text-sub/40"
            />
            <button onClick={() => setAmt(String(Math.floor(free * 1e8) / 1e8))} className="text-[10px] font-semibold text-accent">MAX</button>
          </div>
          <button onClick={stake} disabled={free <= 0} className={`rounded px-3 py-1.5 text-xs font-bold ${free <= 0 ? 'cursor-not-allowed bg-panel2 text-sub' : 'bg-up/15 text-up hover:bg-up/25'}`}>
            Stake
          </button>
        </div>
      </div>
    </div>
  )
}
