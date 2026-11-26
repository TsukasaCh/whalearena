// Small shared presentational atoms (OKX-style: borderless near-black panels,
// sentence-case grey captions, pill tabs).

export function Stat({ label, value, className = '', valueClass = '' }) {
  return (
    <div className={className}>
      <div className="text-[11px] text-sub">{label}</div>
      <div className={`font-mono text-[13px] font-medium ${valueClass}`}>{value}</div>
    </div>
  )
}

export function Section({ title, right, children, className = '' }) {
  return (
    <div className={`rounded-xl bg-panel2/50 ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-3 pt-3">
          <span className="text-[13px] font-semibold text-txt">{title}</span>
          {right}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  )
}

export function Pill({ active, onClick, children, tone = 'neutral' }) {
  const tones = {
    neutral: active ? 'bg-panel3 text-txt' : 'text-sub hover:text-txt',
    up: active ? 'bg-up/15 text-up' : 'text-sub hover:text-txt',
    down: active ? 'bg-down/15 text-down' : 'text-sub hover:text-txt',
  }
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

// Coin logos live in their own file; re-exported here so existing imports keep working.
export { default as CoinIcon } from './CoinIcon'
