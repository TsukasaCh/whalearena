import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, LineStyle, CrosshairMode } from 'lightweight-charts'
import { useSim, TF, VIEW, BASE_PERIOD } from '../store/useSimStore'
import { buildSeries } from '../lib/candles'
import { fmt, fmtPrice } from '../lib/format'

const UP = '#00E676'
const DOWN = '#FF5252'
const UPV = 'rgba(0,230,118,0.45)'
const DOWNV = 'rgba(255,82,82,0.45)'
const round2 = (n) => Math.round(n * 100) / 100
// simple moving averages over candle closes (Binance's default trio + colors)
const MAS = [
  { n: 7, color: '#F0B90B' },
  { n: 25, color: '#EB40B5' },
  { n: 99, color: '#B385F8' },
]
const smaSeries = (candles, n) => {
  const out = []
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= n) sum -= candles[i - n].close
    if (i >= n - 1) out.push({ time: candles[i].time, value: sum / n })
  }
  return out
}

// next hourly funding: predicted rate (longs pay when positive) + countdown
function FundingBadge() {
  const funding = useSim((s) => s.crowd.funding)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!funding) return null
  const left = Math.max(0, funding.next - Math.floor(now / 1000))
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  const pos = funding.rate >= 0
  return (
    <span className="rounded bg-panel2/90 px-2 py-1 font-mono text-sub" title={pos ? 'Positif: long bayar ke short' : 'Negatif: short bayar ke long'}>
      Funding <span className={pos ? 'text-up' : 'text-down'}>{pos ? '+' : ''}{(funding.rate * 100).toFixed(4)}%</span> · {mm}:{ss}
    </span>
  )
}

export default function Chart() {
  const wrapRef = useRef(null)
  const legendRef = useRef(null)
  const maLegendRef = useRef(null)
  const seriesRef = useRef(null)
  const volRef = useRef(null)
  const linesRef = useRef([])
  const markersRef = useRef([])
  // click-to-trade: the price level currently under the cursor (OKX-style)
  const [quote, setQuote] = useState(null) // { y, price, side } | null
  const chipOverRef = useRef(false) // cursor is over the quick-trade chip (anti-flicker)

  const symbol = useSim((s) => s.symbol)
  const dp = useSim((s) => s.dp)
  const roundDp = (n) => { const d = useSim.getState().dp || 2; const f = Math.pow(10, d); return Math.round(n * f) / f }

  // act on the hovered price: set SL/TP on a live position, or place a limit entry
  const placeFromChart = () => {
    if (!quote) return
    const s = useSim.getState()
    if (quote.kind === 'sl') s.modifyPosition({ sl: roundDp(quote.price) })
    else if (quote.kind === 'tp') s.modifyPosition({ tp: roundDp(quote.price) })
    else {
      const m = Number(s.orderDraft.margin)
      if (!m || m <= 0) return s.setOrderError('Set margin dulu di panel order.')
      s.placeLimit({ side: quote.side, leverage: s.orderDraft.leverage, margin: m, price: roundDp(quote.price) })
    }
    setQuote(null)
  }

  useEffect(() => {
    const el = wrapRef.current
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e11' },
        textColor: '#848e9c',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(43,49,57,0.35)' },
        horzLines: { color: 'rgba(43,49,57,0.35)' },
      },
      rightPriceScale: { borderColor: '#2b3139', scaleMargins: { top: 0.06, bottom: 0.24 } },
      timeScale: { borderColor: '#2b3139', timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#848e9c', style: LineStyle.Dashed, labelBackgroundColor: '#2b3139' },
        horzLine: { color: '#848e9c', style: LineStyle.Dashed, labelBackgroundColor: '#2b3139' },
      },
      width: el.clientWidth,
      height: el.clientHeight,
    })

    const series = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })
    seriesRef.current = series

    // volume histogram pinned to the bottom (its own overlay scale)
    const vol = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    volRef.current = vol

    // MA lines drawn over the candles (no own price label / crosshair dot)
    const maLines = MAS.map((ma) =>
      chart.addLineSeries({ color: ma.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
    )
    let closes = [] // { time, close } of every displayed candle, for live MA updates

    const view = () => {
      const s = useSim.getState()
      return buildSeries(s.deep, s.base, s.baseCurrent, TF[s.timeframe], BASE_PERIOD)
    }
    // Show the recent VIEW candles, leaving the full ~3 months scrollable to the
    // left. Logical (index-based) range so it's width-independent and survives
    // resizes — it must NOT fitContent(), which would zoom out to the thousands
    // of candles the deep history holds and make each candle a hairline.
    let lastCount = 0
    const setRecentRange = () => {
      const n = lastCount
      if (n > VIEW) chart.timeScale().setVisibleLogicalRange({ from: n - VIEW, to: n + 2 })
      else chart.timeScale().fitContent()
    }
    const setAll = () => {
      const s = useSim.getState()
      // adapt price precision to the active market (BTC→2, DOGE→6, PEPE→10)
      const dp = s.dp || 2
      const priceFormat = { type: 'price', precision: dp, minMove: Math.pow(10, -dp) }
      series.applyOptions({ priceFormat })
      const candles = view()
      lastCount = candles.length
      series.setData(candles)
      closes = candles.map((c) => ({ time: c.time, close: c.close }))
      MAS.forEach((ma, i) => {
        maLines[i].applyOptions({ priceFormat })
        maLines[i].setData(smaSeries(candles, ma.n))
      })
      vol.setData(candles.map((c) => ({ time: c.time, value: c.volume || 0, color: c.close >= c.open ? UPV : DOWNV })))
      setRecentRange()
    }
    setAll()

    // --- OHLC legend (TradingView-style) ---
    let hovering = false
    const renderLegend = (o, h, l, c, v) => {
      const node = legendRef.current
      if (node == null || o == null) return
      const s = useSim.getState()
      const dp = s.dp || 2
      const chg = o ? ((c - o) / o) * 100 : 0
      const col = c >= o ? UP : DOWN
      const k = (t) => `<span style="color:#5b6673">${t}</span>`
      const val = (t) => `<span style="color:#eaecef">${t}</span>`
      node.innerHTML =
        `${k('O')} ${val(fmtPrice(o, dp))}&nbsp;&nbsp;${k('H')} ${val(fmtPrice(h, dp))}&nbsp;&nbsp;` +
        `${k('L')} ${val(fmtPrice(l, dp))}&nbsp;&nbsp;${k('C')} ${val(fmtPrice(c, dp))}&nbsp;&nbsp;` +
        `<span style="color:${col}">${chg >= 0 ? '+' : ''}${fmt(chg)}%</span>&nbsp;&nbsp;` +
        `${k('Vol')} <span style="color:${col}">${fmt(v || 0, 2)}</span> ${k(s.baseAsset || '')}`
    }
    // MA(7) 64,512.30  MA(25) …  — values at the hovered bar, or the latest one
    const renderMA = (values) => {
      const node = maLegendRef.current
      if (node == null) return
      const dp = useSim.getState().dp || 2
      node.innerHTML = MAS.map((ma, i) =>
        `<span style="color:${ma.color}">MA(${ma.n}) ${values[i] != null ? fmtPrice(values[i], dp) : '—'}</span>`
      ).join('&nbsp;&nbsp;')
    }
    const latestMA = () => MAS.map((ma) => {
      if (closes.length < ma.n) return null
      let sum = 0
      for (let i = closes.length - ma.n; i < closes.length; i++) sum += closes[i].close
      return sum / ma.n
    })
    const showLatest = () => {
      const d = useSim.getState().disp
      if (d) renderLegend(d.open, d.high, d.low, d.close, d.volume)
      renderMA(latestMA())
    }
    showLatest()

    chart.subscribeCrosshairMove((param) => {
      const bar = param.time && param.seriesData ? param.seriesData.get(series) : null
      if (bar) {
        hovering = true
        const vd = param.seriesData.get(vol)
        renderLegend(bar.open, bar.high, bar.low, bar.close, vd ? vd.value : 0)
        renderMA(maLines.map((l) => param.seriesData.get(l)?.value))
      } else {
        hovering = false
        showLatest()
      }
      // click-to-trade: derive the price under the cursor. With a live position
      // the chip sets SL/TP (relative to entry); when flat it places a limit entry.
      // While the cursor is over the chip the chart reports no point — keep the
      // quote instead of clearing, otherwise the chip flickers under the mouse.
      if (param.point) {
        const p = series.coordinateToPrice(param.point.y)
        const st = useSim.getState()
        const mkt = st.price
        const pos = st.position
        let q = null
        if (p != null && p > 0 && mkt) {
          if (pos) {
            const long = pos.side === 'long'
            const profitUp = long // profit is up for a long
            const inProfit = profitUp ? p > pos.entry : p < pos.entry
            if (Math.abs(p - pos.entry) / pos.entry > 0.0003)
              q = { y: Math.round(param.point.y), price: p, kind: inProfit ? 'tp' : 'sl' }
          } else if (Math.abs(p - mkt) / mkt > 0.0002) {
            q = { y: Math.round(param.point.y), price: p, kind: 'limit', side: p < mkt ? 'long' : 'short' }
          }
        }
        if (q) setQuote(q)
        else if (!chipOverRef.current) setQuote(null)
      } else if (!chipOverRef.current) setQuote(null)
    })

    // shared registry of DRAGGABLE price lines (limit orders + SL/TP)
    const draggable = new Map() // key -> { line, kind:'limit'|'sl'|'tp', side, price }
    let drag = null // { key, kind, side, price, startPrice } while dragging

    const drawLines = (position) => {
      linesRef.current.forEach((line) => {
        try { series.removePriceLine(line) } catch (e) { /* noop */ }
      })
      linesRef.current = []
      // remove old SL/TP draggables (rebuilt below)
      for (const key of ['__sl', '__tp']) {
        const d = draggable.get(key)
        if (d) { try { series.removePriceLine(d.line) } catch (e) { /* noop */ } draggable.delete(key) }
      }
      if (!position) return
      const addStatic = (price, color, title, style = LineStyle.Solid, width = 1) =>
        linesRef.current.push(series.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }))
      addStatic(position.entry, '#3b82f6', 'ENTRY', LineStyle.Solid, 2)
      if (position.trailLevel) addStatic(position.trailLevel, '#f0b90b', 'TRAIL', LineStyle.Dashed, 1)
      addStatic(position.liq, '#ff1744', 'LIQ', LineStyle.Solid, 2)
      // draggable SL / TP lines — shown once set (create via the hover chip),
      // then drag to fine-tune. Drag onto the wrong side of price clears them.
      if (position.sl && !(drag && drag.key === '__sl'))
        draggable.set('__sl', { kind: 'sl', price: position.sl, line: series.createPriceLine({ price: position.sl, color: DOWN, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'SL ⇕' }) })
      if (position.tp && !(drag && drag.key === '__tp'))
        draggable.set('__tp', { kind: 'tp', price: position.tp, line: series.createPriceLine({ price: position.tp, color: UP, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'TP ⇕' }) })
    }
    drawLines(useSim.getState().position)

    // Resize the canvas to its container. The visible RANGE is owned by
    // setRecentRange()/user scroll and is width-independent, so we must not
    // refit here — a stray fitContent() on the first real width would zoom out
    // to the whole deep history and shrink every candle to a hairline.
    let sized = false
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      chart.applyOptions({ width: w, height: el.clientHeight })
      if (!sized && w > 50) { setRecentRange(); sized = true } // re-anchor once real width exists
    })
    ro.observe(el)

    // live aggregated candle + volume
    const unsubDisp = useSim.subscribe(
      (s) => s.disp,
      (disp) => {
        if (!disp) return
        try {
          series.update(disp)
          vol.update({ time: disp.time, value: disp.volume || 0, color: disp.close >= disp.open ? UPV : DOWNV })
          // roll the live candle into the MA inputs (same bar → replace, new bar → append)
          const last = closes[closes.length - 1]
          if (last && last.time === disp.time) last.close = disp.close
          else closes.push({ time: disp.time, close: disp.close })
          const vals = latestMA()
          vals.forEach((v, i) => { if (v != null) maLines[i].update({ time: disp.time, value: v }) })
          if (!hovering) renderMA(vals)
        } catch (e) {
          /* rebuilt by epoch listener */
        }
        if (!hovering) renderLegend(disp.open, disp.high, disp.low, disp.close, disp.volume)
      }
    )
    const unsubPos = useSim.subscribe((s) => s.position, drawLines)

    // --- resting limit orders: one draggable price line per order -----------
    const lineTitle = (o) =>
      `${o.side === 'long' ? 'LIMIT BUY' : 'LIMIT SELL'}${o.filled > 1e-6 ? ` ${Math.round((o.filled / o.qty) * 100)}%` : ' ⇕'}`
    const drawLimits = (orders) => {
      const list = orders || []
      const ids = new Set(list.map((o) => o.id))
      for (const [key, d] of draggable) {
        if (d.kind !== 'limit') continue
        if (!ids.has(key)) { try { series.removePriceLine(d.line) } catch (e) { /* noop */ } draggable.delete(key) }
      }
      for (const o of list) {
        if (drag && drag.key === o.id) continue // don't fight the user's drag
        const ex = draggable.get(o.id)
        if (ex) { ex.price = o.price; ex.side = o.side; ex.line.applyOptions({ price: o.price, title: lineTitle(o) }) }
        else draggable.set(o.id, { kind: 'limit', side: o.side, price: o.price, line: series.createPriceLine({ price: o.price, color: '#3b82f6', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: lineTitle(o) }) })
      }
    }
    drawLimits(useSim.getState().pendingOrders)
    const unsubLimit = useSim.subscribe((s) => s.pendingOrders, drawLimits)

    // --- drag any draggable line (limit reprice, or set/move SL & TP) --------
    const relY = (e) => e.clientY - el.getBoundingClientRect().top
    const lineAtY = (y) => {
      let hit = null, best = 10
      for (const [key, d] of draggable) {
        if (d.kind === 'limit') {
          const o = useSim.getState().pendingOrders.find((x) => x.id === key)
          if (!o || o.filled > 1e-6) continue // partially filled → locked
        }
        const ly = series.priceToCoordinate(d.price)
        if (ly == null) continue
        const dist = Math.abs(ly - y)
        if (dist < best) { best = dist; hit = { key, ...d } }
      }
      return hit
    }
    const onDown = (e) => {
      const h = lineAtY(relY(e))
      if (!h) return
      drag = { key: h.key, kind: h.kind, side: h.side, price: h.price, startPrice: h.price }
      chart.applyOptions({ handleScroll: false, handleScale: false })
      el.style.cursor = 'ns-resize'
      e.preventDefault()
    }
    const onMove = (e) => {
      if (!drag) {
        el.style.cursor = lineAtY(relY(e)) ? 'ns-resize' : ''
        return
      }
      const p = series.coordinateToPrice(relY(e))
      if (p == null) return
      drag.price = roundDp(p)
      const d = draggable.get(drag.key)
      if (d) d.line.applyOptions({ price: drag.price })
    }
    const onUp = (e) => {
      if (!drag) return
      const d = drag
      drag = null
      chart.applyOptions({ handleScroll: true, handleScale: true })
      el.style.cursor = ''
      const p = series.coordinateToPrice(relY(e))
      const finalPrice = p != null ? roundDp(p) : d.price
      // "did it move" must be scale-aware: 0.0005 is a big drag on a $0.58 coin
      // but noise on BTC. Compare the dp-rounded prices instead of a fixed epsilon.
      const moved = finalPrice != null && finalPrice !== roundDp(d.startPrice)
      if (moved) {
        // The server echoes `me` for both an accepted AND a rejected change, so
        // the optimistic line either confirms or snaps back — no ghost line.
        if (d.kind === 'limit') useSim.getState().moveLimit(d.key, finalPrice)
        else if (d.kind === 'sl') useSim.getState().modifyPosition({ sl: finalPrice })
        else if (d.kind === 'tp') useSim.getState().modifyPosition({ tp: finalPrice })
      } else {
        // no real move → snap the optimistic drag back to the live store state
        drawLines(useSim.getState().position)
        drawLimits(useSim.getState().pendingOrders)
      }
    }
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    const unsubLiq = useSim.subscribe(
      (s) => s.lastLiqEvent,
      (ev) => {
        if (!ev) return
        const arr = markersRef.current
        const last = arr[arr.length - 1]
        if (last && last.time === ev.time) {
          last._c += ev.count
          last.text = '☠' + last._c
        } else {
          arr.push({
            time: ev.time,
            _c: ev.count,
            text: '☠' + ev.count,
            position: ev.side === 'long' ? 'belowBar' : 'aboveBar',
            color: '#ff1744',
            shape: ev.side === 'long' ? 'arrowDown' : 'arrowUp',
          })
          if (arr.length > 40) arr.shift()
        }
        try {
          series.setMarkers(arr)
        } catch (e) {
          /* noop */
        }
      }
    )
    const unsubEpoch = useSim.subscribe(
      (s) => s.epoch,
      () => {
        markersRef.current = []
        try {
          series.setMarkers([])
          setAll()
        } catch (e) {
          /* noop */
        }
        drawLines(useSim.getState().position)
        showLatest()
      }
    )

    return () => {
      ro.disconnect()
      unsubDisp()
      unsubPos()
      unsubLimit()
      unsubLiq()
      unsubEpoch()
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      chart.remove()
    }
  }, [])

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={wrapRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 text-xs">
        <span className="rounded bg-panel2/90 px-2 py-1 font-semibold text-txt">{symbol}/USDT</span>
        <span className="rounded bg-panel2/90 px-2 py-1 text-sub">Perp · Simulated</span>
        <FundingBadge />
      </div>
      <div
        ref={legendRef}
        className="pointer-events-none absolute left-3 top-11 z-10 rounded bg-bg/70 px-2 py-1 font-mono text-[11px] leading-none backdrop-blur-sm"
      />
      <div
        ref={maLegendRef}
        className="pointer-events-none absolute left-3 top-[4.1rem] z-10 rounded bg-bg/70 px-2 py-1 font-mono text-[11px] leading-none backdrop-blur-sm"
      />

      {/* quick action at the hovered price (OKX-style): set SL/TP or place a limit */}
      {quote && (
        <button
          onClick={placeFromChart}
          onMouseEnter={() => { chipOverRef.current = true }}
          onMouseLeave={() => { chipOverRef.current = false }}
          className={`absolute z-20 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded px-2 py-1 font-mono text-[10px] font-bold shadow-lg ring-1 ring-black/20 transition-none hover:brightness-110 ${
            quote.kind === 'tp'
              ? 'bg-up text-black'
              : quote.kind === 'sl'
                ? 'bg-down text-black'
                : quote.side === 'long'
                  ? 'bg-up text-black'
                  : 'bg-down text-black'
          }`}
          style={{ top: `${quote.y}px`, right: '68px' }}
          title="Klik untuk pasang di harga ini"
        >
          {quote.kind === 'tp'
            ? '✓ Set TP'
            : quote.kind === 'sl'
              ? '✕ Set SL'
              : quote.side === 'long'
                ? '▲ Limit Long'
                : '▼ Limit Short'}{' '}
          · {fmtPrice(quote.price, dp)}
        </button>
      )}
    </div>
  )
}
