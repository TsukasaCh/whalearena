// REST helpers for auth. Relative URLs work in dev (Vite proxy) and in
// production (server serves the built app on the same origin).
async function post(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  } catch (e) {
    return { error: 'Tidak bisa terhubung ke server' }
  }
}

export const apiRegister = (username, password) => post('/api/register', { username, password })
export const apiLogin = (username, password) => post('/api/login', { username, password })
export const apiHost = (code) => post('/api/host', { code })
