// Tiny Web Audio helpers. AudioContext is lazily created and resumed on first
// use (browsers require a user gesture — clicking a button counts).
let ctx = null

function ac() {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function beep(freq, start, dur, type = 'sawtooth', vol = 0.22) {
  const c = ac()
  if (!c) return
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.value = freq
  const t = c.currentTime + start
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g)
  g.connect(c.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

// Descending alarm — "you got rekt".
export function playLiquidation() {
  beep(880, 0, 0.16)
  beep(620, 0.12, 0.16)
  beep(440, 0.24, 0.26)
  beep(220, 0.4, 0.4, 'square', 0.18)
}

// Bright two-note chime for a take-profit.
export function playProfit() {
  beep(660, 0, 0.12, 'triangle', 0.18)
  beep(990, 0.1, 0.18, 'triangle', 0.2)
}

// Short dull thud for a stop-loss / manual close.
export function playClose() {
  beep(300, 0, 0.14, 'sine', 0.16)
}
