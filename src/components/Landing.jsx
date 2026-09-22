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
      <header className="sticky top-0 z-10 border-b border-border/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🐋</span>
            <span className="text-sm font-extrabold tracking-tight">
              WHALE <span className="text-gold">ARENA</span>
            </span>
          </div>
          <button
            onClick={go}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white transition-colors hover:brightness-110"
          >
            {isTrader ? 'Lanjut Main' : isHost ? 'Buka Console' : 'Login Trader'}
          </button>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              'radial-gradient(60% 60% at 50% 0%, rgba(59,130,246,0.25) 0%, rgba(11,14,17,0) 70%)',
          }}
        />
        <div className="relative mx-auto max-w-3xl px-5 py-20 text-center sm:py-28">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-sub">
            <span className="h-1.5 w-1.5 animate-flash rounded-full bg-up" />
            Live multiplayer market
          </div>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            Trade the perp.
            <br />
            <span className="text-gold">Survive the Whale.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-sub sm:text-lg">
            Satu pasar, satu harga, real-time. Buka posisi Long/Short dengan leverage
            sementara sang <b className="text-txt">Whale</b> melukis candle untuk menyapu
            stop-loss &amp; likuidasi setiap trader.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={go}
              className="w-full rounded-xl bg-accent px-8 py-3 text-sm font-bold text-white shadow-lg shadow-accent/20 transition-transform hover:scale-[1.02] sm:w-auto"
            >
              {isTrader ? 'Lanjut Main →' : 'Main Sekarang →'}
            </button>
            <a
              href="#cara-main"
              className="w-full rounded-xl border border-border bg-panel px-8 py-3 text-sm font-bold text-txt transition-colors hover:border-sub sm:w-auto"
            >
              Cara main
            </a>
          </div>
          <p className="mt-4 text-[11px] text-sub/60">Gratis · tanpa uang sungguhan · main bareng teman</p>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-6xl px-5 pb-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon="📈" title="Leverage trading">
            Market &amp; limit order, SL/TP yang bisa diedit, plus trailing stop — persis
            seperti exchange futures beneran.
          </Feature>
          <Feature icon="⚡" title="Satu pasar real-time">
            Semua yang terhubung melihat chart yang sama. Saat harga bergerak, chart semua
            orang ikut bergerak seketika.
          </Feature>
          <Feature icon="🏆" title="Leaderboard hidup">
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
      <section id="cara-main" className="mx-auto max-w-4xl scroll-mt-16 px-5 py-16">
        <h2 className="mb-10 text-center text-2xl font-extrabold tracking-tight">Cara main</h2>
        <div className="grid gap-6 sm:grid-cols-3">
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
          <button
            onClick={go}
            className="rounded-xl bg-gold px-8 py-3 text-sm font-bold text-black shadow-lg shadow-gold/20 transition-transform hover:scale-[1.02]"
          >
            Masuk Arena →
          </button>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-6 text-center text-[11px] text-sub/70 sm:flex-row sm:text-left">
          <span>🐋 Whale Arena — game edukasi, bukan nasihat finansial.</span>
          <span>Tidak menggunakan uang sungguhan.</span>
        </div>
      </footer>
    </div>
  )
}

function Feature({ icon, title, children }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="mb-3 text-2xl">{icon}</div>
      <h3 className="mb-1.5 text-sm font-bold text-txt">{title}</h3>
      <p className="text-xs leading-relaxed text-sub">{children}</p>
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <div className="relative rounded-xl border border-border bg-panel p-6">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-sm font-extrabold text-accent">
        {n}
      </div>
      <h3 className="mb-1.5 text-sm font-bold text-txt">{title}</h3>
      <p className="text-xs leading-relaxed text-sub">{children}</p>
    </div>
  )
}
