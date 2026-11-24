import { navigate, ROUTES } from '../router'

// Public marketing page at "/". The only login it points to is the trader
// login (/play). The whale/god console lives at a separate, unlinked endpoint.
export default function Landing({ session }) {
  const isTrader = session?.user?.role === 'trader'
  const isHost = session?.user?.role === 'host'
  const go = () => navigate(isHost ? ROUTES.whale : ROUTES.trader)

  return (
    <div className="min-h-full overflow-y-auto bg-bg text-txt">
      {/* nav */}
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">🐋</span>
            <span className="text-[15px] font-bold tracking-tight">
              Whale <span className="text-gold">Arena</span>
            </span>
          </div>
          <div className="flex items-center gap-5">
            <a
              href="#cara-main"
              className="hidden text-[13px] font-medium text-sub transition-colors hover:text-txt sm:block"
            >
              Cara main
            </a>
            <button onClick={go} className="btn btn-primary px-5 py-1.5 text-[13px]">
              {isTrader ? 'Lanjut Main' : isHost ? 'Buka Console' : 'Login Trader'}
            </button>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-4xl px-5 pb-16 pt-20 text-center sm:px-8 sm:pb-24 sm:pt-28">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-panel2 px-3 py-1 text-xs font-medium text-sub">
          <span className="h-1.5 w-1.5 animate-flash rounded-full bg-up" />
          Live multiplayer market
        </div>
        <h1 className="text-4xl font-bold leading-[1.08] tracking-tight text-txt sm:text-6xl">
          Trade the perp.
          <br />
          <span className="text-gold">Survive the Whale.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-sub sm:text-lg">
          Satu pasar, satu harga, real-time. Buka posisi Long/Short dengan leverage
          sementara sang <b className="font-semibold text-txt">Whale</b> melukis candle untuk menyapu
          stop-loss &amp; likuidasi setiap trader.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button onClick={go} className="btn btn-primary w-full px-7 py-3 text-base sm:w-auto">
            {isTrader ? 'Lanjut Main →' : 'Main Sekarang →'}
          </button>
          <a href="#cara-main" className="btn btn-outline w-full px-7 py-3 text-base sm:w-auto">
            Cara main
          </a>
        </div>
        <p className="mt-5 text-xs text-sub">Gratis · tanpa uang sungguhan · main bareng teman</p>
      </section>

      {/* features */}
      <section className="mx-auto max-w-6xl px-5 pb-8 sm:px-8">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={<IconChart />} title="Leverage trading">
            Market &amp; limit order, SL/TP yang bisa diedit, plus trailing stop — persis
            seperti exchange futures beneran.
          </Feature>
          <Feature icon={<IconPulse />} title="Satu pasar real-time">
            Semua yang terhubung melihat chart yang sama. Saat harga bergerak, chart semua
            orang ikut bergerak seketika.
          </Feature>
          <Feature icon={<IconRank />} title="Leaderboard hidup">
            Peringkat equity real-time yang mencampur pemain asli dengan seluruh crowd bot —
            lengkap dengan PnL tiap detik.
          </Feature>
          <Feature icon="🐋" title="God Mode (Whale)">
            Host memompa, membuang, dan berburu wick untuk memanen margin trader. Likuidasi
            kamu jadi target di peta miliknya.
          </Feature>
        </div>
      </section>

      {/* how it works */}
      <section id="cara-main" className="mx-auto max-w-6xl scroll-mt-14 px-5 py-16 sm:px-8 sm:py-24">
        <h2 className="mb-10 text-center text-3xl font-bold tracking-tight text-txt sm:text-4xl">
          Cara main
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Step n="1" title="Daftar sebagai Trader">
            Buat akun dengan username &amp; password. Kamu mulai dengan saldo $10.000 virtual.
          </Step>
          <Step n="2" title="Buka posisi">
            Masuk pasar, pilih Long atau Short, atur leverage dan SL/TP. Kelola posisi selagi
            harga bergerak.
          </Step>
          <Step n="3" title="Kalahkan sang Whale">
            Bertahan dari pump &amp; dump, panjat leaderboard, dan jangan sampai likuidasi
            memanen marginmu.
          </Step>
        </div>
        <div className="mt-12 text-center">
          <button onClick={go} className="btn btn-primary px-7 py-3 text-base">
            Masuk Arena →
          </button>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-8 text-center text-xs text-sub sm:flex-row sm:px-8 sm:text-left">
          <span>🐋 Whale Arena — game edukasi, bukan nasihat finansial.</span>
          <span>Tidak menggunakan uang sungguhan.</span>
        </div>
      </footer>
    </div>
  )
}

function Feature({ icon, title, children }) {
  return (
    <div className="rounded-2xl bg-panel p-6">
      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-panel2 text-xl leading-none text-txt">
        {icon}
      </div>
      <h3 className="mb-2 text-base font-semibold text-txt">{title}</h3>
      <p className="text-[13px] leading-relaxed text-sub">{children}</p>
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <div className="rounded-2xl bg-panel p-6">
      <div className="mb-5 font-mono text-3xl font-bold tracking-tight text-sub/60">0{n}</div>
      <h3 className="mb-2 text-base font-semibold text-txt">{title}</h3>
      <p className="text-[13px] leading-relaxed text-sub">{children}</p>
    </div>
  )
}

// Minimal line icons (stroke follows text colour).
function Icon({ children }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function IconChart() {
  return (
    <Icon>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Icon>
  )
}

function IconPulse() {
  return (
    <Icon>
      <path d="M2 12h4l3-8 5 16 3-8h5" />
    </Icon>
  )
}

function IconRank() {
  return (
    <Icon>
      <path d="M5 21V11" />
      <path d="M12 21V4" />
      <path d="M19 21v-7" />
    </Icon>
  )
}
