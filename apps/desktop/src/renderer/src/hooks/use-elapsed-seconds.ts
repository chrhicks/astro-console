import { useEffect, useState } from 'react'
import type { CaptureProjection } from '../../../shared/api-v2'

// Re-renders once per second while an exposure is in progress so the elapsed
// counter stays live. Returns null when no exposure is active.
export function useElapsedSeconds(capture: CaptureProjection): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null)

  useEffect(() => {
    if (!capture.startedAt || capture.phase !== 'capturing') {
      setElapsed(null)
      return
    }
    const startedAtMs = Date.parse(capture.startedAt)
    if (Number.isNaN(startedAtMs)) {
      setElapsed(null)
      return
    }
    const tick = () => setElapsed(Math.max(0, (Date.now() - startedAtMs) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [capture.startedAt, capture.phase])

  return elapsed
}
