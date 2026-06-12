import { Effect, Context } from 'effect'

export interface ConnectedSession {
  sessionId: string
  host: string
  openedAt: string
}

export interface SessionManager {
  readonly connectFake: (input: { host: string }) => Effect.Effect<ConnectedSession>
  readonly getCurrent: Effect.Effect<ConnectedSession | null>
  readonly disconnectFake: Effect.Effect<void>
}

export const SessionManager = Context.GenericTag<SessionManager>('SessionManager')
