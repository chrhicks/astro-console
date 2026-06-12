import { Effect, Layer, Ref } from 'effect'
import { ConnectedSession, SessionManager } from './session-manager'

export const SessionManagerFake = Layer.effect(
  SessionManager,
  Effect.gen(function* () {
    const ref = yield* Ref.make<ConnectedSession | null>(null)

    return {
      connectFake: ({ host }) =>
        Effect.gen(function* () {
          const session: ConnectedSession = {
            sessionId: crypto.randomUUID(),
            host,
            openedAt: new Date().toISOString()
          }

          yield* Ref.set(ref, session)
          return session
        }),
      getCurrent: Ref.get(ref),
      disconnectFake: Ref.set(ref, null)
    } satisfies SessionManager
  })
)