import { Context, Effect, Layer, Ref } from 'effect'
import type { DesktopLogEntryV2 } from '../../../shared/api-v2'
import { EventBus, type AppEvent } from '../event/event-bus'

const LOG_LIMIT = 250

export interface LogSink {
  readonly list: Effect.Effect<DesktopLogEntryV2[]>
}

export const LogSink = Context.GenericTag<LogSink>('LogSink')

export const LogSinkLive = Layer.effect(
  LogSink,
  Effect.gen(function* () {
    const ref = yield* Ref.make<DesktopLogEntryV2[]>([])
    const bus = yield* EventBus

    const unsubscribe = yield* bus.listen((event) => {
      if (event.name === 'status.snapshot.emitted') {
        return Effect.void
      }

      const entry = toDesktopLogEntry(event)

      return Ref.update(ref, (current) => [
        ...current.slice(-(LOG_LIMIT - 1)),
        entry,
      ]).pipe(Effect.tap(() => Effect.sync(() => writeToConsole(entry))))
    })

    void unsubscribe

    return {
      list: Ref.get(ref),
    } satisfies LogSink
  }),
)

export function toDesktopLogEntry(event: AppEvent): DesktopLogEntryV2 {
  const payload = asRecord(event.payload)

  return {
    ts: event.ts,
    level: inferLevel(event, payload),
    event: event.name,
    component: event.name.split('.')[0] ?? 'app',
    summary: inferSummary(event, payload),
    error: asString(payload?.error),
    host: event.host,
    sessionId: event.sessionId,
    data: event.payload,
  }
}

function inferLevel(
  event: AppEvent,
  payload: Record<string, unknown> | undefined,
): DesktopLogEntryV2['level'] {
  if (typeof payload?.error === 'string' && payload.error.length > 0) {
    return 'error'
  }
  if (event.name.endsWith('.failed')) return 'error'
  if (event.name.endsWith('.warning')) return 'warn'
  if (event.name.endsWith('.started')) return 'info'
  if (event.name.endsWith('.completed')) return 'info'
  if (event.name.endsWith('.succeeded')) return 'info'
  return 'debug'
}

function inferSummary(
  event: AppEvent,
  payload: Record<string, unknown> | undefined,
): string {
  if (typeof payload?.error === 'string' && payload.error.length > 0) {
    return payload.error
  }

  switch (event.name) {
    case 'session.discover.started':
      return 'Started device discovery'
    case 'session.discover.completed': {
      const count = asNumber(payload?.count)
      return typeof count === 'number'
        ? `Completed device discovery with ${count} result(s)`
        : 'Completed device discovery'
    }
    case 'session.discover.failed':
      return 'Device discovery failed'
    case 'session.connect.started':
      return `Started connect for ${asString(payload?.deviceId) ?? 'device'}`
    case 'session.connect.succeeded':
      return `Connected to ${asString(payload?.deviceId) ?? 'device'}`
    case 'session.connect.failed':
      return `Failed to connect to ${asString(payload?.deviceId) ?? 'device'}`
    case 'session.disconnect.started':
      return 'Started disconnect'
    case 'session.disconnect.succeeded':
      return 'Disconnected device'
    case 'session.disconnect.failed':
      return 'Failed to disconnect device'
    default:
      return event.name
  }
}

function writeToConsole(entry: DesktopLogEntryV2): void {
  const line = JSON.stringify(entry)
  if (entry.level === 'error') {
    console.error(line)
    return
  }
  if (entry.level === 'warn') {
    console.warn(line)
    return
  }
  console.log(line)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
