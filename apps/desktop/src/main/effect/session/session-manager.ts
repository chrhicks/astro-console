import { Effect, Context } from 'effect'
import type { LiveDeviceSession } from '../device/device-plugin'

export interface SessionManager {
  readonly getCurrent: Effect.Effect<LiveDeviceSession | null>
  readonly setCurrent: (session: LiveDeviceSession) => Effect.Effect<void>
  readonly clearCurrent: Effect.Effect<void>
}

export const SessionManager =
  Context.GenericTag<SessionManager>('SessionManager')
