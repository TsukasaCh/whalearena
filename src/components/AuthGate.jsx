import { useState } from 'react'
import { useAuth } from '../store/useAuth'
import { apiRegister, apiLogin, apiHost } from '../net/api'
import { navigate, ROUTES } from '../router'

// Single-role login screen. `role` is decided by the route, never by a toggle
// on the page — traders reach role="trader" at /play and never see the whale
// login, which lives (role="host") at the separate /whale-god endpoint.
export default function AuthGate({ role = 'trader' }) {
  const isHost = role === 'host'
  const setSession = useAuth((s) => s.setSession)
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    let res
    if (isHost) res = await apiHost(code)
    else if (mode === 'register') res = await apiRegister(username, password)
    else res = await apiLogin(username, password)
    setBusy(false)
    if (res.error) setError(res.error)
    else setSession(res)
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        {/* brand */}
        <div className="mb-6 text-center">
          <div className="mb-1 text-4xl">{isHost ? '👑' : '🐋'}</div>
          <h1 className="text-2xl font-extrabold tracking-tight text-txt">
            WHALE <span className="text-gold">ARENA</span>
          </h1>
          <p className="text-xs uppercase tracking-[0.3em] text-sub">
            {isHost ? 'God Console — Admin' : 'Perp Trading Game'}
          </p>
        </div>

        <div
          className={`rounded-xl border bg-panel p-5 shadow-2xl ${
            isHost ? 'border-gold/40' : 'border-border'
          }`}
        >
          <form onSubmit={submit} className="space-y-3">
            {isHost ? (
              <>
                <p className="text-xs leading-relaxed text-sub">
                  Akses <b className="text-gold">God Mode</b> — kendalikan seluruh pasar.
                  Masukkan <b>admin code</b> milik whale.
                </p>
                <Field label="Admin code" host>
                  <input
                    type="password"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                    autoComplete="off"
                    className="w-full bg-transparent px-3 py-2 text-sm text-txt outline-none"
                    placeholder="whale admin code"
                  />
                </Field>
              </>
            ) : (
              <>
                <div className="flex gap-4 text-sm">
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError('') }}
                    className={`font-semibold ${mode === 'login' ? 'text-txt' : 'text-sub'}`}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setError('') }}
                    className={`font-semibold ${mode === 'register' ? 'text-txt' : 'text-sub'}`}
                  >
                    Daftar
                  </button>
                </div>
                <Field label="Username">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                    className="w-full bg-transparent px-3 py-2 text-sm text-txt outline-none"
                    placeholder="nama kamu"
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent px-3 py-2 text-sm text-txt outline-none"
                    placeholder="••••••"
                  />
                </Field>
              </>
            )}

            {error && <div className="rounded bg-down/10 px-3 py-2 text-xs text-down">{error}</div>}

            <button
              type="submit"
              disabled={busy}
              className={`w-full rounded-lg py-2.5 text-sm font-bold transition-colors ${
                isHost ? 'bg-gold text-black hover:brightness-110' : 'bg-accent text-white hover:brightness-110'
              } ${busy ? 'opacity-60' : ''}`}
            >
              {busy ? '…' : isHost ? 'Masuk God Mode' : mode === 'register' ? 'Buat akun & main' : 'Masuk'}
            </button>
          </form>
        </div>

        <div className="mt-4 text-center">
          <button
            onClick={() => navigate(ROUTES.landing)}
            className="text-[11px] text-sub/70 hover:text-txt"
          >
            ← Kembali ke beranda
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, host }) {
  return (
    <div>
      <div className="mb-1 text-xs text-sub">{label}</div>
      <div
        className={`rounded-lg border border-border bg-panel2 ${
          host ? 'focus-within:border-gold' : 'focus-within:border-accent'
        }`}
      >
        {children}
      </div>
    </div>
  )
}
