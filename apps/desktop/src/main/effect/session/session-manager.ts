import { Effect, Context } from 'effect'
import type { DeviceSession } from '../device/device-plugin'

export interface SessionManager {
  readonly getCurrent: Effect.Effect<DeviceSession | null>
  readonly setCurrent: (session: DeviceSession) => Effect.Effect<void>
  readonly clearCurrent: Effect.Effect<void>
}

export const SessionManager =
  Context.GenericTag<SessionManager>('SessionManager')
