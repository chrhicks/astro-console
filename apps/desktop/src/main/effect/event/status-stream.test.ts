import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect, Layer } from 'effect'
import type { DesktopStatus } from '../../../shared/api-v2'
import { StatusProjector } from '../state/status-projector'
import { EventBus, EventBusLive } from './event-bus'
import { StatusStream, StatusStreamLive } from './status-stream'

test('removes a status listener when its callback throws', async () => {
  let received = 0
  let resolveFailure: () => void = () => {}
  const failed = new Promise<void>((resolve) => {
    resolveFailure = resolve
  })
  const projector = Layer.succeed(StatusProjector, {
    snapshot: Effect.succeed(status()),
  })
  const deps = Layer.merge(EventBusLive, projector)
  const streamLayer = Layer.merge(Layer.provide(StatusStreamLive, deps), deps)

  await Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus
      const stream = yield* StatusStream
      const unsubscribe = yield* stream.subscribe(() => {
        received += 1
        resolveFailure()
        throw new Error('renderer failed')
      })

      yield* Effect.tryPromise(() => failed)
      unsubscribe()
      unsubscribe()
      yield* bus.publish('capture.started', {})
      assert.equal(received, 1)
    }).pipe(Effect.provide(streamLayer)),
  )
})

function status(): DesktopStatus {
  return {
    session: { phase: 'connected', discovering: false, host: 'test' },
    pointing: { phase: 'idle', target: null },
    capture: { phase: 'idle' },
    preview: { phase: 'none', source: 'none', active: false },
    device: {},
    library: { scope: 'current_target', assets: [], polling: false },
    workspace: {
      state: 'idle_no_target',
      stateLabel: 'Idle',
      surface: { kind: 'idle', label: 'Idle' },
      capabilities: {
        preview: 'unsupported',
        capture: 'unsupported',
        darkExposure: 'no',
        autofocus: 'no',
        filterWheel: 'no',
        storage: 'no',
      },
      actions: [],
    },
    sequence: { phase: 'idle', completed: 0, failed: 0 },
    currentTarget: null,
    statusRevision: 1,
    lastUpdatedAt: '2026-07-14T00:00:00.000Z',
  }
}
