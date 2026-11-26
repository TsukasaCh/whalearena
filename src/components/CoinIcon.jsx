// Coin logos, drawn as small inline SVGs (no image files, no network requests).
// They are simplified renditions meant to make each market recognisable at
// 24–32px; a symbol without an entry falls back to a coloured letter badge.
// To add or replace one, add a `SYMBOL: { bg, art }` entry — `art` is drawn on a
// 32×32 canvas on top of a circle filled with `bg`.

const W = '#fff'

const LOGOS = {
  BTC: {
    bg: '#f7931a',
    art: (
      <g transform="rotate(13 16 16)" fill={W}>
        <rect x="12.6" y="5.6" width="1.9" height="3.6" rx="0.4" />
        <rect x="16.2" y="5.6" width="1.9" height="3.6" rx="0.4" />
        <rect x="12.6" y="22.8" width="1.9" height="3.6" rx="0.4" />
        <rect x="16.2" y="22.8" width="1.9" height="3.6" rx="0.4" />
        <path
          fillRule="evenodd"
          d="M9.6 8.4h8.2c3 0 4.9 1.5 4.9 3.9 0 1.5-.8 2.6-2 3.2 1.7.5 2.8 1.8 2.8 3.7 0 2.7-2.1 4.4-5.4 4.4H9.6v-2.4h1.9V10.800H9.6zm4.900 2.400v3.800h2.700c1.400 0 2.300-.7 2.300-1.900s-.9-1.900-2.300-1.900zm0 6.100v4.300h3.100c1.600 0 2.600-.8 2.600-2.200 0-1.300-1-2.100-2.600-2.100z"
        />
      </g>
    ),
  },
  ETH: {
    bg: '#627eea',
    art: (
      <g fill={W}>
        <path d="M16.5 4v8.87l7.5 3.35z" opacity="0.6" />
        <path d="M16.5 4 9 16.22l7.5-3.35z" />
        <path d="M16.5 21.97V28L24 17.62z" opacity="0.6" />
        <path d="M16.5 28v-6.03L9 17.62z" />
        <path d="m16.5 20.57 7.5-4.35-7.5-3.35z" opacity="0.2" />
        <path d="m9 16.22 7.5 4.35v-7.7z" opacity="0.6" />
      </g>
    ),
  },
  SOL: {
    bg: '#0b0b0f',
    art: (
      <>
        <defs>
          <linearGradient id="coin-sol" x1="8" y1="24" x2="24" y2="8" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9945ff" />
            <stop offset="1" stopColor="#14f195" />
          </linearGradient>
        </defs>
        <g fill="url(#coin-sol)">
          <path d="M11.2 9.5h13.3l-2.700 2.800H8.500z" />
          <path d="M8.500 14.600h13.300l2.700 2.800H11.200z" />
          <path d="M11.2 19.700h13.300l-2.700 2.800H8.500z" />
        </g>
      </>
    ),
  },
  BNB: {
    bg: '#f3ba2f',
    art: (
      <g fill={W}>
        <path d="m16 12.900 3.100 3.100-3.100 3.100-3.100-3.100z" />
        <path d="m16 6.500 5 5-1.900 1.900L16 10.300l-3.100 3.100L11 11.500z" />
        <path d="m16 25.500-5-5 1.900-1.900 3.100 3.100 3.100-3.100 1.900 1.900z" />
        <path d="m8.400 14.100 1.900 1.900-1.900 1.900L6.500 16z" />
        <path d="m23.600 14.100 1.900 1.900-1.900 1.900-1.900-1.900z" />
      </g>
    ),
  },
  XRP: {
    bg: '#23292f',
    art: (
      <g fill={W}>
        <path d="M9 9h2.700l3.200 3.200a1.600 1.600 0 0 0 2.200 0L20.300 9H23l-4.600 4.500a3.500 3.500 0 0 1-4.800 0z" />
        <path d="M9 23h2.700l3.200-3.200a1.600 1.600 0 0 1 2.200 0l3.200 3.200H23l-4.600-4.500a3.500 3.500 0 0 0-4.800 0z" />
      </g>
    ),
  },
  DOGE: {
    bg: '#c2a633',
    art: (
      <g fill={W}>
        <path
          fillRule="evenodd"
          d="M11.200 8.500h5.600c4.400 0 7.200 2.900 7.200 7.500s-2.800 7.500-7.200 7.500h-5.600v-6.300H9.600v-2.400h1.600zm2.900 2.500v3.800h3.500v2.400h-3.500V21h2.500c2.700 0 4.300-1.900 4.300-5s-1.600-5-4.300-5z"
        />
      </g>
    ),
  },
  ADA: {
    bg: '#0033ad',
    art: (
      <g fill={W}>
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <circle key={'i' + a} cx={16 + 4.6 * Math.cos((a * Math.PI) / 180)} cy={16 + 4.6 * Math.sin((a * Math.PI) / 180)} r="1.7" />
        ))}
        {[30, 90, 150, 210, 270, 330].map((a) => (
          <circle key={'o' + a} cx={16 + 9.2 * Math.cos((a * Math.PI) / 180)} cy={16 + 9.2 * Math.sin((a * Math.PI) / 180)} r="1.15" />
        ))}
      </g>
    ),
  },
  AVAX: {
    bg: '#e84142',
    art: (
      <g fill={W}>
        <path d="M14.300 8.600a2 2 0 0 1 3.400 0l2 3.500a2 2 0 0 1 0 2l-4.300 7.400a2 2 0 0 1-1.700 1H9.300a1.500 1.500 0 0 1-1.300-2.200z" />
        <path d="M20.300 17.400a1.600 1.600 0 0 1 2.800 0l1.600 2.800a1.500 1.500 0 0 1-1.300 2.300h-3.400a1.500 1.500 0 0 1-1.300-2.300z" />
      </g>
    ),
  },
  LINK: {
    bg: '#2a5ada',
    art: <path d="m16 7.300 7.500 4.350v8.700L16 24.700l-7.500-4.350v-8.700z" fill="none" stroke={W} strokeWidth="2.900" strokeLinejoin="round" />,
  },
  TRX: {
    bg: '#ef0027',
    art: (
      <g fill="none" stroke={W} strokeWidth="1.700" strokeLinejoin="round" strokeLinecap="round">
        <path d="M7.800 9.200 22.300 12l2.300 2.400-9 11.300z" />
        <path d="M7.800 9.200 16.800 16l5.500-4M16.800 16l-1.200 9.700M16.800 16l7.800-1.600" />
      </g>
    ),
  },
  TON: {
    bg: '#0098ea',
    art: (
      <g fill="none" stroke={W} strokeWidth="2.100" strokeLinejoin="round" strokeLinecap="round">
        <path d="M10.600 10h10.800a1.500 1.500 0 0 1 1.300 2.300L16 24 9.300 12.300A1.500 1.500 0 0 1 10.600 10z" />
        <path d="M16 10v13.500" />
      </g>
    ),
  },
  PEPE: {
    bg: '#3d9b47',
    art: (
      <>
        <ellipse cx="16" cy="19" rx="9.500" ry="7" fill="#57b85f" />
        <circle cx="11.800" cy="12.600" r="3.900" fill="#57b85f" />
        <circle cx="20.200" cy="12.600" r="3.900" fill="#57b85f" />
        <ellipse cx="11.900" cy="12.900" rx="2.700" ry="2.300" fill={W} />
        <ellipse cx="20.300" cy="12.900" rx="2.700" ry="2.300" fill={W} />
        <circle cx="12.700" cy="13.100" r="1.250" fill="#111" />
        <circle cx="21.100" cy="13.100" r="1.250" fill="#111" />
        <path d="M9.500 20.300c2.200 1.900 10.800 1.900 13 0" fill="none" stroke="#c0392b" strokeWidth="2.200" strokeLinecap="round" />
      </>
    ),
  },
  // the game's own token
  RCLD: {
    bg: '#14110a',
    art: (
      <>
        <circle cx="16" cy="16" r="12.600" fill="none" stroke="#f0b90b" strokeWidth="1.600" />
        <path
          fill="#f0b90b"
          fillRule="evenodd"
          d="M11.300 9.300h5.900c2.900 0 4.700 1.600 4.700 4.100 0 1.900-1 3.200-2.700 3.800l3.100 5.500h-3.300l-2.700-5h-2.100v5h-2.900zm2.900 2.400v3.600h2.700c1.300 0 2.100-.7 2.100-1.800s-.8-1.800-2.100-1.800z"
        />
      </>
    ),
  },
}

// Round coin logo for a market symbol.
export default function CoinIcon({ symbol = '', size = 28, className = '' }) {
  const key = String(symbol).toUpperCase()
  const logo = LOGOS[key]
  if (logo) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        className={`shrink-0 ${className}`}
        role="img"
        aria-label={key}
      >
        <circle cx="16" cy="16" r="16" fill={logo.bg} />
        {logo.art}
      </svg>
    )
  }
  // unknown coin → coloured letter badge
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.36), background: `hsl(${h} 55% 42%)` }}
      aria-hidden="true"
    >
      {key.slice(0, key.length > 3 ? 2 : 1)}
    </span>
  )
}
