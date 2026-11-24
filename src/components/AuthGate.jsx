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
    <div className="flex h-full flex-col overflow-y-auto bg-bg text-txt">
      {/* slim top nav */}
      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">🐋</span>
            <span className="text-[15px] font-bold tracking-tight">
              Whale <span className="text-gold">Arena</span>
            </span>
          </div>
          <button
            onClick={() => navigate(ROUTES.landing)}
            className="text-[13px] font-medium text-sub transition-colors hover:text-txt"
          >
            ← Kembali ke beranda
          </button>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl bg-panel p-6 sm:p-8">
          {/* brand */}
          <div className="mb-7">
            <span
              className={`mb-4 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${
                isHost ? 'bg-gold/15 text-gold' : 'bg-panel2 text-sub'
              }`}
            >
              {isHost ? 'God Console — Admin' : 'Perp Trading Game'}
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-txt">
              Whale <span className="text-gold">Arena</span>
            </h1>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {isHost ? (
              <>
                <p className="text-[13px] leading-relaxed text-sub">
                  Akses <b className="font-semibold text-gold">God Mode</b> — kendalikan seluruh pasar.
                  Masukkan <b className="font-semibold text-txt">admin code</b> milik whale.
                </p>
                <Field label="Admin code" host>
                  <input
                    type="password"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                    autoComplete="off"
                    className="w-full min-w-0 bg-transparent px-4 py-3 text-sm text-txt outline-none placeholder:text-sub/50"
                    placeholder="whale admin code"
                  />
                </Field>
              </>
            ) : (
              <>
                <div className="seg">
                  <button
                    type="button"
                    data-active={mode === 'login'}
                    onClick={() => { setMode('login'); setError('') }}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    data-active={mode === 'register'}
                    onClick={() => { setMode('register'); setError('') }}
                  >
                    Daftar
                  </button>
                </div>
                <Field label="Username">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                    className="w-full min-w-0 bg-transparent px-4 py-3 text-sm text-txt outline-none placeholder:text-sub/50"
                    placeholder="nama kamu"
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full min-w-0 bg-transparent px-4 py-3 text-sm text-txt outline-none placeholder:text-sub/50"
                    placeholder="••••••"
                  />
                </Field>
              </>
            )}

            {error && (
              <div className="rounded-lg bg-down/10 px-3 py-2.5 text-xs text-down">{error}</div>
            )}

            <button
              type="submit"
              disabled={busy}
              className={`btn w-full py-3 text-base ${
                isHost ? 'bg-gold text-black hover:brightness-110' : 'btn-primary'
              } ${busy ? 'opacity-60' : ''}`}
            >
              {busy ? '…' : isHost ? 'Masuk God Mode' : mode === 'register' ? 'Buat akun & main' : 'Masuk'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, host }) {
  return (
    <div>
      <div className="mb-1.5 text-xs text-sub">{label}</div>
      <div
        className={`rounded-lg border border-transparent bg-panel2 transition-colors hover:border-panel3 ${
          host ? 'focus-within:border-gold' : 'focus-within:border-sub'
        }`}
      >
        {children}
      </div>
    </div>
  )
}
