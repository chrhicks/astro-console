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
  readonly request: (
    commandId: string,
    command: Extract<
      typeof controlEnvelopeCommand.Type,
      { readonly _tag: 'RequestControl' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<ControlTransition, CommandRejected>
  readonly grant: (
    commandId: string,
    command: Extract<
      typeof controlEnvelopeCommand.Type,
      { readonly _tag: 'GrantControl' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<ControlTransition, CommandRejected>
  readonly decline: (
    commandId: string,
    command: Extract<
      typeof controlEnvelopeCommand.Type,
      { readonly _tag: 'DeclineControl' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<ControlTransition, CommandRejected>
  readonly release: (
    commandId: string,
    command: Extract<
      typeof controlEnvelopeCommand.Type,
      { readonly _tag: 'ReleaseControl' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<ControlTransition, CommandRejected>
  readonly take: (
    commandId: string,
    command: Extract<
      typeof controlEnvelopeCommand.Type,
      { readonly _tag: 'TakeControl' }
    >,
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

export class ControlService extends Context.Service<
  ControlService,
  {
    readonly execute: (
      commandId: string,
      command: typeof controlEnvelopeCommand.Type,
      identity: LocalIdentity,
    ) => Effect.Effect<ControlTransition, CommandRejected>
  }
>()('@astro-console/server/ControlService') {}
export const controlServiceLayer = Layer.effect(
  ControlService,
  Effect.gen(function* () {
    const persistence = yield* ControlPersistence
    return ControlService.of({
      execute: Effect.fn('ControlService.execute')(
        function* (commandId, command, identity) {
          if (Command.guards.RequestControl(command))
            return yield* persistence.request(commandId, command, identity)
          if (Command.guards.GrantControl(command))
            return yield* persistence.grant(commandId, command, identity)
          if (Command.guards.DeclineControl(command))
            return yield* persistence.decline(commandId, command, identity)
          if (Command.guards.ReleaseControl(command))
            return yield* persistence.release(commandId, command, identity)
          return yield* persistence.take(commandId, command, identity)
        },
      ),
    })
  }),
)

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
  const service = yield* ControlService
  const transition = yield* service.execute(
    envelope.commandId,
    command,
    identity,
  )
  if (transition.event !== undefined)
    yield* persistence.publish(transition.event.type, transition.event.cursor)
  return { status: transition.status, body: transition.body }
})
