import { useState } from 'react'
import { useSim } from '../store/useSimStore'
import LiquidityMap from './LiquidityMap'
import CrowdStats from './CrowdStats'

export default function MarketMakerPanel() {
  const mm = useSim((s) => s.mm)
  const symbol = useSim((s) => s.symbol)
  const adminFund = useSim((s) => s.adminFund)
  const [force, setForce] = useState(0)
  const [target, setTarget] = useState('')
  const [rebaseTo, setRebaseTo] = useState('')
  const [fundName, setFundName] = useState('')
  const [fundAmt, setFundAmt] = useState('')

  const fund = (fundMode) => {
    const name = fundName.trim()
    const amt = Number(fundAmt)
    if (!name || !Number.isFinite(amt)) return
    adminFund(name, amt, fundMode)
    setFundAmt('')
  }

  const rebase = () => {
    const p = Number(rebaseTo)
    if (!(p > 0)) return
    if (!window.confirm(`Rebase ${symbol} ke $${p.toLocaleString('en-US')}?

Seluruh history candle ${symbol} dibuat ulang di level harga ini (spike lama hilang). Posisi & limit order ikut diskalakan — margin dan PnL tidak berubah.`)) return
    mm('rebase', { target: p })
    setRebaseTo('')
  }

  const releaseForce = () => {
    setForce(0)
    mm('force', { v: 0 })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/15 text-base">🐋</span>
          <div className="text-sm font-semibold text-txt">Market Maker</div>
        </div>
        <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[11px] font-semibold text-gold">God Mode</span>
      </div>

      <div className="space-y-3 px-3 pb-4">
        {/* Crowd + auto-hunt */}
        <CrowdStats />

        {/* Presets */}
        <div className="rounded-xl bg-panel2/50 p-3">
          <div className="mb-2.5 text-[13px] font-semibold text-txt">Manipulation Presets</div>
          <div className="grid grid-cols-2 gap-2">
            <Preset onClick={() => mm('pump')} className="bg-up text-white hover:brightness-110">
              Pump
            </Preset>
            <Preset onClick={() => mm('dump')} className="bg-down text-white hover:brightness-110">
              Dump
            </Preset>
            <Preset onClick={() => mm('hunt')} className="col-span-2 bg-gold/15 text-gold hover:bg-gold/25">
              Liquidation Hunt (Wick Spike)
            </Preset>
            <Preset onClick={() => mm('chop')} className="bg-panel2 text-txt hover:bg-panel3">
              Sideways / Chop
            </Preset>
            <Preset onClick={() => mm('calm')} className="bg-panel2 text-sub hover:bg-panel3 hover:text-txt">
              Calm / Reset Flow
            </Preset>
          </div>
        </div>

        {/* Manual joystick */}
        <div className="rounded-xl bg-panel2/50 p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-txt">Manual Force</span>
            <span
              className={`font-mono text-xs font-medium ${
                force > 0 ? 'text-up' : force < 0 ? 'text-down' : 'text-sub'
              }`}
            >
              {force > 0 ? 'Bull' : force < 0 ? 'Bear' : 'Neutral'} {force !== 0 ? `${force}%` : ''}
            </span>
          </div>
          <input
            type="range"
            className="joystick w-full"
            min={-100}
            max={100}
            value={force}
            onChange={(e) => {
              const v = Number(e.target.value)
              setForce(v)
              mm('force', { v: v / 100 })
            }}
            onPointerUp={releaseForce}
            onMouseUp={releaseForce}
            onTouchEnd={releaseForce}
            onBlur={releaseForce}
          />
          <div className="mt-2 flex justify-between text-[11px] text-sub">
            <span>Dump ◀</span>
            <span>release = spring back</span>
            <span>▶ Pump</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => mm('nudge', { dir: -1 })}
              className="rounded-lg bg-down/15 py-2 text-xs font-semibold text-down transition-colors hover:bg-down/25"
            >
              − Nudge
            </button>
            <button
              onClick={() => mm('nudge', { dir: 1 })}
              className="rounded-lg bg-up/15 py-2 text-xs font-semibold text-up transition-colors hover:bg-up/25"
            >
              + Nudge
            </button>
          </div>

          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <div className="field flex-1">
                <span className="shrink-0 text-xs text-sub">$</span>
                <input
                  type="number"
                  value={target}
                  placeholder="drive to price…"
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>
              <button
                onClick={() => {
                  mm('drive', { target: Number(target) })
                  setTarget('')
                }}
                className="btn btn-primary shrink-0"
              >
                Drive
              </button>
            </div>
          </div>
        </div>

        {/* Rebase: re-level the whole chart to a price without a spike candle */}
        <div className="rounded-xl bg-panel2/50 p-3">
          <div className="mb-1 text-[13px] font-semibold text-txt">Rebase Chart</div>
          <div className="mb-3 text-[11px] leading-relaxed text-sub">
            Buat ulang seluruh history {symbol} di level harga baru, misalnya untuk menyamakan dengan harga asli. Tidak meninggalkan candle spike seperti Drive.
          </div>
          <div className="flex items-center gap-2">
            <div className="field flex-1">
              <span className="shrink-0 text-xs text-sub">$</span>
              <input
                type="number"
                value={rebaseTo}
                placeholder="rebase to price…"
                onChange={(e) => setRebaseTo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && rebase()}
              />
            </div>
            <button onClick={rebase} className="btn btn-ghost shrink-0">
              Rebase
            </button>
          </div>
        </div>

        {/* Fund a trader: whale credits / sets any account's balance */}
        <div className="rounded-xl bg-gold/[0.06] p-3">
          <div className="mb-1 text-[13px] font-semibold text-gold">Fund a Trader</div>
          <div className="mb-3 text-[11px] leading-relaxed text-sub">
            Isi / set saldo akun mana pun (online atau offline). Khusus God Mode.
          </div>
          <div className="space-y-2">
            <input
              type="text"
              value={fundName}
              placeholder="username"
              onChange={(e) => setFundName(e.target.value)}
              className="w-full rounded-lg border border-transparent bg-panel2 px-3 py-2 text-sm text-txt outline-none transition-colors placeholder:text-sub/50 hover:border-panel3 focus:border-sub"
            />
            <div className="field">
              <span className="shrink-0 text-xs text-sub">$</span>
              <input
                type="number"
                value={fundAmt}
                placeholder="amount"
                onChange={(e) => setFundAmt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fund('add')}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => fund('add')}
                className="rounded-full bg-gold py-2 text-xs font-semibold text-black transition hover:brightness-110"
              >
                + Add
              </button>
              <button onClick={() => fund('set')} className="btn btn-ghost py-2 text-xs">
                = Set
              </button>
            </div>
          </div>
        </div>

        {/* Liquidity heatmap */}
        <div className="rounded-xl bg-panel2/50 p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-txt">Liquidity Map</span>
            <span className="flex items-center gap-3 text-[11px] text-sub">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-up" />
                long liqs
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-down" />
                short liqs
              </span>
            </span>
          </div>
          <LiquidityMap />
        </div>
      </div>
    </div>
  )
}

function Preset({ onClick, className, children }) {
  return (
    <button onClick={onClick} className={`rounded-lg py-2.5 text-[13px] font-semibold transition ${className}`}>
      {children}
    </button>
  )
}
