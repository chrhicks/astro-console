import { Context, Effect, Layer, Schema } from 'effect'
import {
  Command,
  CommandEnvelope,
  CommandFailure,
  CommandHttpSuccessEnvelope,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from './identity.ts'

export class CommandRejected extends Schema.TaggedErrorClass<CommandRejected>()(
  'Server.CommandRejected',
  { failure: CommandFailure },
) {}
export class CommandInputInvalid extends Schema.TaggedErrorClass<CommandInputInvalid>()(
  'Server.CommandInputInvalid',
  {},
) {}

export const controlEnvelopeCommand = Schema.Union([
  Command.cases.RequestControl,
  Command.cases.GrantControl,
  Command.cases.DeclineControl,
  Command.cases.ReleaseControl,
  Command.cases.TakeControl,
])

export type ControlTransition = {
  readonly status: number
  readonly body: typeof CommandHttpSuccessEnvelope.Type
  readonly event?: { readonly type: string; readonly cursor: number }
}
export interface ControlPersistenceShape {
  readonly execute: (
    commandId: string,
    command: typeof controlEnvelopeCommand.Type,
    identity: LocalIdentity,
  ) => Effect.Effect<ControlTransition, CommandRejected>
  readonly publish: (type: string, cursor: number) => Effect.Effect<void>
}
export class ControlPersistence extends Context.Service<
  ControlPersistence,
  ControlPersistenceShape
>()('@astro-console/server/ControlPersistence') {}
export const controlPersistenceLayer = (
  implementation: ControlPersistenceShape,
) => Layer.succeed(ControlPersistence, ControlPersistence.of(implementation))

export const executeControlRequest = Effect.fn(
  'ControlCommandService.executeRequest',
)(function* (
  request: Promise<unknown | undefined | symbol>,
  bodyTooLarge: symbol,
  identity: LocalIdentity,
) {
  const raw = yield* Effect.promise(() => request)
  if (raw === undefined || raw === bodyTooLarge)
    return yield* Effect.fail(new CommandInputInvalid())
  const envelope = yield* Schema.decodeUnknownEffect(CommandEnvelope)(raw).pipe(
    Effect.mapError(() => new CommandInputInvalid()),
  )
  const command = yield* Schema.decodeUnknownEffect(controlEnvelopeCommand)(
    envelope.command,
  ).pipe(Effect.mapError(() => new CommandInputInvalid()))
  const persistence = yield* ControlPersistence
  const transition = yield* persistence.execute(
    envelope.commandId,
    command,
    identity,
  )
  if (transition.event !== undefined)
    yield* persistence.publish(transition.event.type, transition.event.cursor)
  return { status: transition.status, body: transition.body }
})
