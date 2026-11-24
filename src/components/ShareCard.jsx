import { useEffect, useRef, useState } from 'react'
import { fmtPrice, fmt } from '../lib/format'

// A flex-worthy PnL card (OKX / Binance "share position" style) rendered to a
// canvas so it can be downloaded as a PNG or shared straight to social apps.
export default function ShareCard({ share, onClose }) {
  const canvasRef = useRef(null)
  const [url, setUrl] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    draw(canvas, share)
    canvas.toBlob((blob) => { if (blob) setUrl(URL.createObjectURL(blob)) }, 'image/png')
    return () => { if (url) URL.revokeObjectURL(url) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share])

  const filename = `whale-arena-${(share.symbol || 'pnl').toLowerCase()}-${share.roe >= 0 ? 'win' : 'loss'}.png`

  const download = () => {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }
  const shareNative = async () => {
    try {
      const blob = await (await fetch(url)).blob()
      const file = new File([blob], filename, { type: 'image/png' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Whale Arena PnL', text: pnlText(share) })
        return
      }
    } catch (e) { /* fall through to copy */ }
    try { await navigator.clipboard.writeText(pnlText(share)); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { download() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-white/5 bg-panel2 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-base font-semibold text-txt">Share your PnL 🚀</span>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-panel3 text-xs text-sub transition-colors hover:text-txt"
          >
            ✕
          </button>
        </div>
        <div className="overflow-hidden rounded-xl bg-black">
          {url ? (
            <img src={url} alt="PnL card" className="w-full" />
          ) : (
            <div className="aspect-square animate-pulse bg-panel3" />
          )}
        </div>
        <canvas ref={canvasRef} width={1080} height={1080} className="hidden" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={shareNative} className="btn btn-primary py-2.5">
            {copied ? '✓ Copied text' : 'Share'}
          </button>
          <button onClick={download} className="btn bg-panel3 py-2.5 text-txt hover:bg-white/15">
            Download PNG
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] text-sub">Educational simulator — not financial advice.</p>
      </div>
    </div>
  )
}

function pnlText(s) {
  const sign = s.roe >= 0 ? '+' : ''
  const head = s.mode === 'account' ? 'My Whale Arena portfolio' : `${s.symbol} ${s.side ? s.side.toUpperCase() : ''} ${s.leverage ? s.leverage + 'x' : ''}`.trim()
  return `${head} → ${sign}${fmt(s.roe)}% ROE (${sign}$${fmt(Math.abs(s.pnl))}) on Whale Arena 🐋`
}

function draw(canvas, s) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  const win = s.roe >= 0
  const up = '#25a750', down = '#ca3f64', gold = '#f0b90b'
  const accent = win ? up : down

  // background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#000000')
  bg.addColorStop(1, win ? '#0b1f12' : '#220d14')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // subtle glow
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.42, 60, W * 0.5, H * 0.42, W * 0.7)
  glow.addColorStop(0, win ? 'rgba(37,167,80,0.20)' : 'rgba(202,63,100,0.20)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  ctx.textBaseline = 'alphabetic'
  const pad = 90

  // header
  ctx.fillStyle = '#f7f7f7'
  ctx.font = 'bold 52px Inter, sans-serif'
  ctx.fillText('🐋 WHALE', pad, 130)
  ctx.fillStyle = gold
  ctx.fillText(' ARENA', pad + ctx.measureText('🐋 WHALE').width, 130)

  ctx.fillStyle = '#8f8f8f'
  ctx.font = '30px Inter, sans-serif'
  ctx.fillText(s.mode === 'account' ? 'PORTFOLIO PERFORMANCE' : 'PERPETUAL FUTURES', pad, 178)

  // pair + side pill
  if (s.mode !== 'account') {
    ctx.fillStyle = '#f7f7f7'
    ctx.font = 'bold 84px Inter, sans-serif'
    ctx.fillText(`${s.symbol}/USDT`, pad, 320)
    // side pill
    const label = `${s.side ? s.side.toUpperCase() : ''}${s.leverage ? '  ' + s.leverage + 'x' : ''}`
    ctx.font = 'bold 40px Inter, sans-serif'
    const pw = ctx.measureText(label).width + 56
    ctx.fillStyle = win ? 'rgba(37,167,80,0.18)' : 'rgba(202,63,100,0.18)'
    roundRect(ctx, pad, 360, pw, 74, 16)
    ctx.fill()
    ctx.fillStyle = s.side === 'long' ? up : down
    ctx.fillText(label, pad + 28, 412)
  } else {
    ctx.fillStyle = '#f7f7f7'
    ctx.font = 'bold 76px Inter, sans-serif'
    ctx.fillText('Total PnL', pad, 320)
  }

  // ROE headline
  ctx.fillStyle = accent
  ctx.font = 'bold 200px Inter, sans-serif'
  const roeStr = `${win ? '+' : ''}${fmt(s.roe)}%`
  ctx.fillText(roeStr, pad, 640)

  // PnL amount
  ctx.fillStyle = accent
  ctx.font = 'bold 64px Inter, sans-serif'
  ctx.fillText(`${win ? '+' : '-'}$${fmt(Math.abs(s.pnl))}`, pad, 730)

  // detail rows
  ctx.font = '34px Inter, sans-serif'
  let y = 850
  const row = (k, v) => {
    ctx.fillStyle = '#8f8f8f'
    ctx.fillText(k, pad, y)
    ctx.fillStyle = '#f7f7f7'
    ctx.textAlign = 'right'
    ctx.fillText(v, W - pad, y)
    ctx.textAlign = 'left'
    y += 62
  }
  if (s.mode !== 'account') {
    row('Entry Price', fmtPrice(s.entry, s.dp))
    row(s.closed ? 'Exit Price' : 'Mark Price', fmtPrice(s.exit, s.dp))
  } else {
    row('Equity', `$${fmt(s.equity)}`)
    row('Win Rate', s.trades ? `${fmt(s.winRate, 0)}% (${s.wins}/${s.trades})` : '—')
  }

  // footer
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(pad, 1000); ctx.lineTo(W - pad, 1000); ctx.stroke()
  ctx.fillStyle = '#8f8f8f'
  ctx.font = '30px Inter, sans-serif'
  ctx.fillText('Trade the whale. Simulated futures arena.', pad, 1050)
  ctx.fillStyle = gold
  ctx.font = 'bold 30px Inter, sans-serif'
  const d = new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
  ctx.textAlign = 'right'
  ctx.fillText(d, W - pad, 1050)
  ctx.textAlign = 'left'
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
