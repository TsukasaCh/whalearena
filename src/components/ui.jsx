// Small shared presentational atoms.

export function Stat({ label, value, className = '', valueClass = '' }) {
  return (
    <div className={className}>
      <div className="text-[10px] uppercase tracking-wide text-sub">{label}</div>
      <div className={`font-mono text-sm ${valueClass}`}>{value}</div>
    </div>
  )
}

export function Section({ title, right, children, className = '' }) {
  return (
    <div className={`rounded-lg border border-border bg-panel ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-sub">{title}</span>
          {right}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  )
}

export function Pill({ active, onClick, children, tone = 'neutral' }) {
  const tones = {
    neutral: active ? 'bg-panel2 text-txt' : 'text-sub hover:text-txt',
    up: active ? 'bg-up/15 text-up' : 'text-sub hover:text-txt',
    down: active ? 'bg-down/15 text-down' : 'text-sub hover:text-txt',
  }
  return (
    <button
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${tones[tone]}`}
    >
      {children}
    </button>
  )
}
