import { Effect, Schema } from 'effect'
import type { WebContents } from 'electron'
import { appRuntime } from '../runtime/app-runtime'
import { fakeSeestarRuntime } from '../device/fake-seestar-runtime'
import { AggregateStore } from '../state/aggregate-store'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import type { FakeRuntimeSnapshot } from '../../../shared/api-v2'
import { ownedIpcHandle } from './owned-ipc'

// Development-only IPC surface for the fake Seestar scenario runtime. Registered
// only when the app is not packaged so it cannot leak into product builds.
export function registerIpcV2DevHandlers(allowed: WebContents) {
  const handle = ownedIpcHandle(allowed)
  handle('seestar:dev:fake:list-scenarios', () =>
    fakeSeestarRuntime.snapshot(),
  )

  handle(
    'seestar:dev:fake:load-scenario',
    async (_event, scenarioId) => {
      const decoded = Schema.decodeUnknownEither(Schema.String)(scenarioId)
      if (decoded._tag === 'Left') throw new Error('Invalid scenario id')
      const next = fakeSeestarRuntime.loadScenario(decoded.right)
      await refreshFakeProjection(next)
      return next
    },
  )

  handle('seestar:dev:fake:reset', async () => {
    const next = fakeSeestarRuntime.reset()
    await refreshFakeProjection(next)
    return next
  })
}

// When the connected session is the fake device, push the refreshed device,
// preview, capture, and library projections into the aggregate and publish a
// session event so the status stream republishes without a reconnect. Failure
// scenarios have no device projection to push.
function refreshFakeProjection(snapshot: FakeRuntimeSnapshot) {
  return appRuntime.runPromise(
    Effect.gen(function* () {
      if (snapshot.connectOutcome !== 'success') return
      const sessions = yield* SessionManager
      const current = yield* sessions.getCurrent
      if (!current || current.pluginKind !== 'fake-seestar') return
      const store = yield* AggregateStore
      const bus = yield* EventBus
      yield* store.update((aggregate) => ({
        ...aggregate,
        device: snapshot.device,
        preview: snapshot.preview,
        capture: snapshot.capture,
        library: snapshot.library,
      }))
      // The status stream only republishes on session./pointing./observer.
      // events; publish one so the renderer live-refreshes after a scenario
      // switch without a reconnect.
      yield* bus.publish('session.fake.scenario.changed', {
        scenarioId: snapshot.activeScenarioId,
      })
    }),
  )
}
