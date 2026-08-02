import { BootstrapClientState } from './bootstrap-client'
import { projectBootstrapState } from './bootstrap-projection'

export const unavailableProjection = projectBootstrapState(
  BootstrapClientState.Unavailable({
    reason: 'The production BootstrapClient has not loaded a snapshot.',
  }),
)
