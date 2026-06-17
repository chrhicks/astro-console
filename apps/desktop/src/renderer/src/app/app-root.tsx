import { useEffect } from 'react'
import {
  disposeProjectionStore,
  initializeProjectionStore,
  useProjectionStore,
} from '../state/projection-store'
import { Providers } from './providers'
import { AppShell } from './app-shell'
import { selectProjectionBoot } from '../state/projection-selectors'

function AppBootstrap() {
  const { hydrated, error, hasStatus } =
    useProjectionStore(selectProjectionBoot)
  useEffect(() => {
    void initializeProjectionStore()
    return () => {
      disposeProjectionStore()
    }
  }, [])

  if (!hydrated) return <div>Loading...</div>
  if (error) return <div>Error: {error}</div>
  if (!hasStatus) return <div>No status available</div>

  return <AppShell />
}

export function AppRoot() {
  return (
    <Providers>
      <AppBootstrap />
    </Providers>
  )
}
