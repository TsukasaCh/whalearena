import { useEffect, useState } from 'react'

// Tiny hash router: '#/trader' and '#/mm' behave like two separate pages
// (shareable URL, back/forward works) without pulling in a router dependency.
const parse = () => (window.location.hash.replace(/^#\/?/, '') === 'mm' ? 'mm' : 'trader')

export function useRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onHash = () => setRoute(parse())
    window.addEventListener('hashchange', onHash)
    if (!window.location.hash) window.history.replaceState(null, '', '#/trader')
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const navigate = (r) => {
    window.location.hash = '#/' + r
  }
  return [route, navigate]
}
