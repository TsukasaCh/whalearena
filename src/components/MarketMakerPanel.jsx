import { useState } from 'react'
import { useSim } from '../store/useSimStore'
import LiquidityMap from './LiquidityMap'
import CrowdStats from './CrowdStats'

export default function MarketMakerPanel() {
  const mm = useSim((s) => s.mm)
  const symbol = useSim((s) => s.symbol)
  const [force, setForce] = useState(0)
  const [target, setTarget] = useState('')
  const [rebaseTo, setRebaseTo] = useState('')

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
      <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-gold/10 to-transparent px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-gold/20 text-gold">🐋</span>
          <div>
            <div className="text-sm font-bold text-txt">Market Maker</div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gold">God Mode</div>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {/* Crowd + auto-hunt */}
        <CrowdStats />

        {/* Presets */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">
            Manipulation Presets
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Preset onClick={() => mm('pump')} className="bg-up/15 text-up hover:bg-up/25">
              🚀 Pump
            </Preset>
            <Preset onClick={() => mm('dump')} className="bg-down/15 text-down hover:bg-down/25">
              🔻 Dump
            </Preset>
            <Preset onClick={() => mm('hunt')} className="col-span-2 bg-gold/15 text-gold hover:bg-gold/25">
              🎯 Liquidation Hunt (Wick Spike)
            </Preset>
            <Preset onClick={() => mm('chop')} className="bg-panel2 text-txt hover:bg-border">
              〰️ Sideways / Chop
            </Preset>
            <Preset onClick={() => mm('calm')} className="bg-panel2 text-sub hover:bg-border">
              ✋ Calm / Reset Flow
            </Preset>
          </div>
        </div>

        {/* Manual joystick */}
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wide text-sub">Manual Force</span>
            <span className="font-mono text-sub">
              {force > 0 ? '🟢 Bull' : force < 0 ? '🔴 Bear' : 'Neutral'} {force !== 0 ? `${force}%` : ''}
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
          <div className="mt-1 flex justify-between text-[10px] text-sub">
            <span>Dump ◀</span>
            <span>release = spring back</span>
            <span>▶ Pump</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => mm('nudge', { dir: -1 })}
              className="rounded bg-down/10 py-1.5 text-xs font-bold text-down hover:bg-down/20"
            >
              − Nudge
            </button>
            <button
              onClick={() => mm('nudge', { dir: 1 })}
              className="rounded bg-up/10 py-1.5 text-xs font-bold text-up hover:bg-up/20"
            >
              + Nudge
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 items-center rounded border border-border bg-panel2 px-2">
              <span className="text-sub">$</span>
              <input
                type="number"
                value={target}
                placeholder="drive to price…"
                onChange={(e) => setTarget(e.target.value)}
                className="w-full bg-transparent px-2 py-1.5 font-mono text-xs text-txt outline-none placeholder:text-sub/40"
              />
            </div>
            <button
              onClick={() => {
                mm('drive', { target: Number(target) })
                setTarget('')
              }}
              className="rounded bg-accent/20 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/30"
            >
              Drive
            </button>
          </div>
        </div>

        {/* Rebase: re-level the whole chart to a price without a spike candle */}
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">📐 Rebase Chart</div>
          <div className="mb-2 text-[10px] leading-snug text-sub">
            Buat ulang seluruh history {symbol} di level harga baru, misalnya untuk menyamakan dengan harga asli. Tidak meninggalkan candle spike seperti Drive.
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center rounded border border-border bg-panel2 px-2">
              <span className="text-sub">$</span>
              <input
                type="number"
                value={rebaseTo}
                placeholder="rebase to price…"
                onChange={(e) => setRebaseTo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && rebase()}
                className="w-full bg-transparent px-2 py-1.5 font-mono text-xs text-txt outline-none placeholder:text-sub/40"
              />
            </div>
            <button onClick={rebase} className="rounded bg-gold/20 px-3 py-1.5 text-xs font-bold text-gold hover:bg-gold/30">
              Rebase
            </button>
          </div>
        </div>

        {/* Liquidity heatmap */}
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-sub">💧 Liquidity Map</span>
            <span className="text-[10px] text-sub">
              <span className="text-up">long liqs</span> · <span className="text-down">short liqs</span>
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
    <button onClick={onClick} className={`rounded-md py-2.5 text-sm font-bold transition-colors ${className}`}>
      {children}
    </button>
  )
}
