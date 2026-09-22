import { useEffect } from 'react'
import { useSim } from '../store/useSimStore'

// Drives the whole simulation: one tick every TICK_MS.
const TICK_MS = 250

export function useEngine() {
  useEffect(() => {
    const id = setInterval(() => useSim.getState().tick(), TICK_MS)
    return () => clearInterval(id)
  }, [])
}
