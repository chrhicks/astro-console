import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Effect, Layer, Schema } from 'effect'
import {
  Command,
  CommandFailure,
  CommandHttpSuccessEnvelope,
} from '@astro-console/protocol'
import {
  CommandRejected,
  controlEnvelopeCommand,
  controlPersistenceLayer,
  controlServiceLayer,
  executeControlRequest,
} from '../services/control-command-service.ts'
import type { CommandResult, FailureReason } from '../services/domain-state.ts'
import type { LocalIdentity } from '../auth/identity.ts'
import type { StateSqliteRepositoryShape } from './state-sqlite-repository.ts'

const ControlRequestRow = Schema.Struct({
  request_id: Schema.String,
  client_id: Schema.String,
  target_control_capable: Schema.Int,
})
export const ControlDomainEvent = Schema.TaggedUnion({
  ControlRequested: {
    requestId: Schema.NonEmptyString,
    requesterClientId: Schema.NonEmptyString,
  },
  ControlGranted: {
    requestId: Schema.NonEmptyString,
    holderClientId: Schema.NonEmptyString,
  },
  ControlDeclined: { requestId: Schema.NonEmptyString },
  ControlReleased: { previousHolderClientId: Schema.NonEmptyString },
  OwnerTookControl: { holderClientId: Schema.NonEmptyString },
  ControlLeaseExpired: { previousHolderClientId: Schema.NonEmptyString },
})
const operatorMessages: Partial<Record<FailureReason, string>> = {
  ClientReadOnly: 'Monitoring is read-only on this client.',
  FreshnessConflict:
    'The plan or control changed. Review the current plan before accepting it.',
  IdempotencyConflict:
    'This idempotency key was already used for a different command.',
  OwnerRequired: 'Only the owner can accept a RunDefinition.',
  ControlLeaseLost:
    'Control changed hands. Your command was not sent to the observatory; the accepted run continues.',
  AlreadyController: 'This desktop already controls the observatory.',
  ControlRequestAlreadyPending:
    'This desktop already has a pending control request.',
  ControlRequestUnavailable: 'There is no current control request to grant.',
}
const isOwner = (identity: LocalIdentity) => identity.role === 'owner'
const reject = (reason: FailureReason) => ({
  status:
    reason === 'FreshnessConflict' ||
    reason === 'IdempotencyConflict' ||
    reason === 'ControlRequestUnavailable'
      ? 409
      : 403,
  body: {
    outcome: 'rejected' as const,
    reason,
    message:
      operatorMessages[reason] ??
      'The requested control action is unavailable.',
  },
})
const commandFailure = (
  commandId: string,
  rejected: Extract<CommandResult, { readonly outcome: 'rejected' }>,
): CommandFailure => {
  const common = {
    commandId,
    summary: rejected.message,
    retryable: false,
    refreshFromSnapshot: rejected.reason === 'FreshnessConflict',
    safeAlternatives: [],
  }
  const failure =
    rejected.reason === 'ClientReadOnly' ||
    rejected.reason === 'ControlLeaseLost' ||
    rejected.reason === 'AlreadyController' ||
    rejected.reason === 'ControlRequestAlreadyPending' ||
    rejected.reason === 'OwnerRequired'
      ? {
          _tag: 'AuthorizationFailure',
          ...common,
          reason:
            rejected.reason === 'ClientReadOnly'
              ? 'ClientReadOnly'
              : rejected.reason === 'ControlLeaseLost'
                ? 'ControlLeaseLost'
                : rejected.reason === 'AlreadyController'
                  ? 'AlreadyController'
                  : rejected.reason === 'ControlRequestAlreadyPending'
                    ? 'ControlRequestAlreadyPending'
                    : 'OwnerRequired',
        }
      : rejected.reason === 'IdempotencyConflict'
        ? { _tag: 'IdempotencyConflict', ...common }
        : {
            _tag: 'FreshnessConflict',
            ...common,
            reason: 'ReconnectRequired',
          }
  return Schema.decodeUnknownSync(CommandFailure)(failure)
}

const sqliteControlOperation = (
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  commandId: string,
  command: typeof controlEnvelopeCommand.Type,
  identity: LocalIdentity,
) =>
  Effect.sync(() => acceptControl(db, stateRepository, command, identity)).pipe(
    Effect.flatMap((result) => {
      if (!('ok' in result.body))
        return Effect.fail(
          new CommandRejected({
            failure: commandFailure(commandId, result.body),
          }),
        )
      return Effect.succeed({
        status: result.status,
        body: result.body,
        ...('event' in result && result.event !== undefined
          ? { event: result.event }
          : {}),
      })
    }),
  )

const sqliteControlPersistenceLayer = (
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  publish: (type: string, cursor: number) => void,
) =>
  controlPersistenceLayer({
    request: (commandId, command, identity) =>
      sqliteControlOperation(db, stateRepository, commandId, command, identity),
    grant: (commandId, command, identity) =>
      sqliteControlOperation(db, stateRepository, commandId, command, identity),
    decline: (commandId, command, identity) =>
      sqliteControlOperation(db, stateRepository, commandId, command, identity),
    release: (commandId, command, identity) =>
      sqliteControlOperation(db, stateRepository, commandId, command, identity),
    take: (commandId, command, identity) =>
      sqliteControlOperation(db, stateRepository, commandId, command, identity),
    publish: (type, cursor) => Effect.sync(() => publish(type, cursor)),
  })

export const controlCommandFromEnvelope = Effect.fn(
  'ControlSqliteRepository.commandFromEnvelope',
)(
  function* (
    request: Promise<unknown | undefined | symbol>,
    bodyTooLarge: symbol,
    db: DatabaseSync,
    stateRepository: StateSqliteRepositoryShape,
    identity: LocalIdentity,
    publish: (type: string, cursor: number) => void,
  ) {
    void db
    void stateRepository
    void identity
    void publish
    return yield* executeControlRequest(request, bodyTooLarge, identity)
  },
  (effect, _request, _bodyTooLarge, db, stateRepository, _identity, publish) =>
    effect.pipe(
      Effect.provide(
        Layer.merge(
          sqliteControlPersistenceLayer(db, stateRepository, publish),
          controlServiceLayer.pipe(
            Layer.provide(
              sqliteControlPersistenceLayer(db, stateRepository, publish),
            ),
          ),
        ),
      ),
    ),
)

function acceptControl(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  command: typeof controlEnvelopeCommand.Type,
  identity: LocalIdentity,
) {
  stateRepository.expireReconnectGrace()
  const semanticKey = createHash('sha256')
    .update(JSON.stringify({ version: 1, command }))
    .digest('hex')
  const existingRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM control_command_receipts WHERE idempotency_key=? AND actor_person_id=? AND actor_client_id=?',
    )
    .get(command.idempotencyKey, identity.personId, identity.clientId)
  const existing = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ semantic_key: Schema.String, response: Schema.String }),
    ),
  )(existingRaw)
  if (existing !== undefined)
    return existing.semantic_key === semanticKey
      ? {
          status: 200,
          body: Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(
            JSON.parse(existing.response),
          ),
        }
      : reject('IdempotencyConflict')
  const current = stateRepository.state()
  // Admission assigns control capability only to the local-owner or desktop
  // listener. Production Access client IDs are `access:<subject>`, so the
  // client-ID prefix must not be treated as an authority boundary here.
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (command.expectedLeaseRevision !== current.control.revision)
    return reject('FreshnessConflict')
  if (
    (Command.guards.GrantControl(command) ||
      Command.guards.DeclineControl(command) ||
      Command.guards.TakeControl(command)) &&
    !isOwner(identity)
  )
    return reject('OwnerRequired')
  if (
    Command.guards.ReleaseControl(command) &&
    current.control.holderClientId !== identity.clientId
  )
    return reject('ControlLeaseLost')
  if (Command.guards.RequestControl(command)) {
    if (current.control.holderClientId === identity.clientId)
      return reject('AlreadyController')
    const pendingRequest: unknown = db
      .prepare('SELECT client_id FROM control_requests WHERE client_id=?')
      .get(identity.clientId)
    if (
      Schema.decodeUnknownSync(
        Schema.optional(Schema.Struct({ client_id: Schema.String })),
      )(pendingRequest) !== undefined
    )
      return reject('ControlRequestAlreadyPending')
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    let holder = current.control.holderClientId
    let revision = current.control.revision
    let event: typeof ControlDomainEvent.Type
    if (Command.guards.RequestControl(command)) {
      const createdAt = new Date().toISOString()
      const expiresAt = new Date(Date.now() + 60_000).toISOString()
      const requestId = randomUUID()
      db.prepare('INSERT INTO control_requests VALUES (?,?,?,?,?,?)').run(
        requestId,
        identity.clientId,
        identity.personId,
        createdAt,
        expiresAt,
        1,
      )
      event = Schema.decodeUnknownSync(ControlDomainEvent)({
        _tag: 'ControlRequested',
        requestId,
        requesterClientId: identity.clientId,
      })
    } else if (Command.guards.GrantControl(command)) {
      const requestRaw: unknown = db
        .prepare(
          'SELECT request_id,client_id,target_control_capable FROM control_requests WHERE request_id=? AND client_id=?',
        )
        .get(command.requestId, command.targetClientId)
      const request = Schema.decodeUnknownSync(
        Schema.optional(ControlRequestRow),
      )(requestRaw)
      if (request === undefined || request.target_control_capable !== 1) {
        db.exec('ROLLBACK')
        return reject('ControlRequestUnavailable')
      }
      holder = request.client_id
      revision += 1
      event = Schema.decodeUnknownSync(ControlDomainEvent)({
        _tag: 'ControlGranted',
        requestId: request.request_id,
        holderClientId: request.client_id,
      })
      db.exec('DELETE FROM control_requests')
    } else if (Command.guards.DeclineControl(command)) {
      const requestRaw: unknown = db
        .prepare(
          'SELECT request_id,client_id,target_control_capable FROM control_requests WHERE request_id=?',
        )
        .get(command.requestId)
      const request = Schema.decodeUnknownSync(
        Schema.optional(ControlRequestRow),
      )(requestRaw)
      if (request === undefined) {
        db.exec('ROLLBACK')
        return reject('ControlRequestUnavailable')
      }
      db.prepare('DELETE FROM control_requests WHERE request_id=?').run(
        request.request_id,
      )
      event = Schema.decodeUnknownSync(ControlDomainEvent)({
        _tag: 'ControlDeclined',
        requestId: request.request_id,
      })
    } else if (Command.guards.ReleaseControl(command)) {
      holder = null
      revision += 1
      event = Schema.decodeUnknownSync(ControlDomainEvent)({
        _tag: 'ControlReleased',
        previousHolderClientId: identity.clientId,
      })
      db.exec('DELETE FROM control_requests')
    } else {
      holder = identity.clientId
      revision += 1
      event = Schema.decodeUnknownSync(ControlDomainEvent)({
        _tag: 'OwnerTookControl',
        holderClientId: identity.clientId,
      })
      db.exec('DELETE FROM control_requests')
    }
    const cursor = current.eventCursor + 1
    stateRepository.commit({
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      leaseRevision: revision,
      leaseHolder: holder,
      leaseState: holder === null ? 'unheld' : 'held',
      reconnectGraceUntil: null,
    })
    const data = Effect.runSync(stateRepository.bootstrapSnapshot(identity))
    const body = Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)({
      ok: true,
      data,
    })
    db.prepare('INSERT INTO control_command_receipts VALUES (?,?,?,?,?)').run(
      command.idempotencyKey,
      identity.personId,
      identity.clientId,
      semanticKey,
      JSON.stringify(body),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      event._tag,
      JSON.stringify(event),
    )
    db.exec('COMMIT')
    return { status: 202, body, event: { type: event._tag, cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
