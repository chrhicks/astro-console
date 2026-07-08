import { Effect, Layer, Ref } from 'effect'
import type { DeviceSession } from '../device/device-plugin'
import { SessionManager } from './session-manager'

export const SessionManagerLive = Layer.effect(
  SessionManager,
  Effect.gen(function* () {
    const ref = yield* Ref.make<DeviceSession | null>(null)

    return {
      getCurrent: Ref.get(ref),
      setCurrent: (session) => Ref.set(ref, session),
      clearCurrent: Ref.set(ref, null),
    } satisfies SessionManager
  }),
)
