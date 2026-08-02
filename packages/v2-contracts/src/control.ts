import { Data, Schema } from 'effect'
import {
  ClientCapability,
  ClientId,
  LeaseId,
  LeaseRevision,
  NonNegativeInt,
} from './primitives.js'

export const ControlRequest = Schema.Struct({
  requestId: Schema.NonEmptyString,
  requesterClientId: ClientId,
  basedOnLeaseRevision: LeaseRevision,
  requestedAtEpochMs: NonNegativeInt,
  expiresAtEpochMs: NonNegativeInt,
}).check(
  Schema.makeFilter((request) => {
    if (request.expiresAtEpochMs <= request.requestedAtEpochMs) {
      return {
        path: ['expiresAtEpochMs'],
        issue: 'control request expiry must be later than its request time',
      }
    }
  }),
)

export interface ControlRequest extends Schema.Schema.Type<
  typeof ControlRequest
> {}

export const ControlLeaseState = Schema.Struct({
  leaseId: LeaseId,
  revision: LeaseRevision,
  state: Schema.Literals(['available', 'held', 'reconnecting']),
  holderClientId: Schema.optionalKey(ClientId),
  graceDeadlineEpochMs: Schema.optionalKey(NonNegativeInt),
  requests: Schema.Array(ControlRequest),
}).check(
  Schema.makeFilter((lease) => {
    if (lease.state === 'available' && lease.holderClientId !== undefined) {
      return {
        path: ['holderClientId'],
        issue: 'an available lease cannot have a holder',
      }
    }
    if (
      lease.state === 'available' &&
      lease.graceDeadlineEpochMs !== undefined
    ) {
      return {
        path: ['graceDeadlineEpochMs'],
        issue: 'an available lease cannot have a reconnect deadline',
      }
    }
    if (lease.state === 'held' && lease.holderClientId === undefined) {
      return {
        path: ['holderClientId'],
        issue: 'a held lease requires a holder',
      }
    }
    if (lease.state === 'held' && lease.graceDeadlineEpochMs !== undefined) {
      return {
        path: ['graceDeadlineEpochMs'],
        issue: 'a held lease cannot have a reconnect deadline',
      }
    }
    if (lease.state === 'reconnecting' && lease.holderClientId === undefined) {
      return {
        path: ['holderClientId'],
        issue: 'a reconnecting lease requires a holder',
      }
    }
    if (
      lease.state === 'reconnecting' &&
      lease.graceDeadlineEpochMs === undefined
    ) {
      return {
        path: ['graceDeadlineEpochMs'],
        issue: 'a reconnecting lease requires a deadline',
      }
    }

    const requestIds = new Set(
      lease.requests.map((request) => request.requestId),
    )
    if (requestIds.size !== lease.requests.length) {
      return {
        path: ['requests'],
        issue: 'control request identities must be unique',
      }
    }

    const requesterClientIds = new Set(
      lease.requests.map((request) => request.requesterClientId),
    )
    if (requesterClientIds.size !== lease.requests.length) {
      return {
        path: ['requests'],
        issue: 'a client may have only one pending control request',
      }
    }
    if (
      lease.holderClientId !== undefined &&
      lease.requests.some(
        (request) => request.requesterClientId === lease.holderClientId,
      )
    ) {
      return {
        path: ['requests'],
        issue: 'the current holder cannot have a pending control request',
      }
    }
    if (
      lease.requests.some(
        (request) => request.basedOnLeaseRevision > lease.revision,
      )
    ) {
      return {
        path: ['requests'],
        issue: 'a control request cannot reference a future ownership epoch',
      }
    }
  }),
)

export interface ControlLeaseState extends Schema.Schema.Type<
  typeof ControlLeaseState
> {}

export const ControlTarget = Schema.Struct({
  clientId: ClientId,
  capability: ClientCapability,
  connection: Schema.Literals(['current', 'reconnecting', 'disconnected']),
})

export interface ControlTarget extends Schema.Schema.Type<
  typeof ControlTarget
> {}

export const ControlRequestResolution = Schema.TaggedUnion({
  Grant: {
    requestId: Schema.NonEmptyString,
    nowEpochMs: NonNegativeInt,
    target: ControlTarget,
  },
  Decline: {
    requestId: Schema.NonEmptyString,
    nowEpochMs: NonNegativeInt,
  },
})

export type ControlRequestResolution = typeof ControlRequestResolution.Type

export type ControlDecision = Data.TaggedEnum<{
  Updated: {
    readonly state: ControlLeaseState
    readonly effect:
      | 'requested'
      | 'declined'
      | 'granted'
      | 'released'
      | 'taken'
      | 'graceStarted'
      | 'reconnected'
      | 'expired'
  }
  Unchanged: {
    readonly reason:
      | 'AlreadyController'
      | 'AlreadyReconnecting'
      | 'RequestAlreadyPending'
      | 'RequestIdentityConflict'
      | 'RequestExpiryInvalid'
      | 'RequestUnavailable'
      | 'RequestExpired'
      | 'RequestSuperseded'
      | 'ControlTargetMismatch'
      | 'ControlTargetUnavailable'
      | 'NotController'
      | 'NotReconnecting'
      | 'GraceNotExpired'
  }
}>

export const ControlDecision = Data.taggedEnum<ControlDecision>()

export const requestControl = (
  state: ControlLeaseState,
  requestId: string,
  requesterClientId: typeof ClientId.Type,
  requestedAtEpochMs: number,
  expiresAtEpochMs: number,
): ControlDecision => {
  if (state.holderClientId === requesterClientId)
    return ControlDecision.Unchanged({ reason: 'AlreadyController' })
  if (expiresAtEpochMs <= requestedAtEpochMs)
    return ControlDecision.Unchanged({ reason: 'RequestExpiryInvalid' })

  const activeRequests = state.requests.filter(
    (request) => request.expiresAtEpochMs > requestedAtEpochMs,
  )
  const matchingIdentity = activeRequests.find(
    (request) => request.requestId === requestId,
  )
  if (
    matchingIdentity !== undefined &&
    matchingIdentity.requesterClientId !== requesterClientId
  ) {
    return ControlDecision.Unchanged({ reason: 'RequestIdentityConflict' })
  }
  if (
    activeRequests.some(
      (request) => request.requesterClientId === requesterClientId,
    )
  ) {
    return ControlDecision.Unchanged({ reason: 'RequestAlreadyPending' })
  }

  return ControlDecision.Updated({
    state: ControlLeaseState.make({
      ...state,
      requests: [
        ...activeRequests,
        ControlRequest.make({
          requestId,
          requesterClientId,
          basedOnLeaseRevision: state.revision,
          requestedAtEpochMs: NonNegativeInt.make(requestedAtEpochMs),
          expiresAtEpochMs: NonNegativeInt.make(expiresAtEpochMs),
        }),
      ],
    }),
    effect: 'requested',
  })
}

export const resolveControlRequest = (
  state: ControlLeaseState,
  resolution: ControlRequestResolution,
): ControlDecision => {
  const request = state.requests.find(
    (candidate) => candidate.requestId === resolution.requestId,
  )
  if (request === undefined)
    return ControlDecision.Unchanged({ reason: 'RequestUnavailable' })
  if (request.expiresAtEpochMs <= resolution.nowEpochMs)
    return ControlDecision.Unchanged({ reason: 'RequestExpired' })
  if (request.basedOnLeaseRevision !== state.revision)
    return ControlDecision.Unchanged({ reason: 'RequestSuperseded' })

  return ControlRequestResolution.match(resolution, {
    Decline: () =>
      ControlDecision.Updated({
        state: ControlLeaseState.make({
          ...state,
          requests: state.requests.filter(
            (candidate) => candidate.requestId !== request.requestId,
          ),
        }),
        effect: 'declined',
      }),
    Grant: ({ target }) => {
      if (target.clientId !== request.requesterClientId) {
        return ControlDecision.Unchanged({ reason: 'ControlTargetMismatch' })
      }
      if (
        target.capability !== 'controlCapable' ||
        target.connection !== 'current'
      ) {
        return ControlDecision.Unchanged({
          reason: 'ControlTargetUnavailable',
        })
      }
      return ControlDecision.Updated({
        state: ownershipChanged(state, 'held', target.clientId),
        effect: 'granted',
      })
    },
  })
}

export const releaseControl = (
  state: ControlLeaseState,
  clientId: typeof ClientId.Type,
): ControlDecision =>
  state.holderClientId !== clientId
    ? ControlDecision.Unchanged({ reason: 'NotController' })
    : ControlDecision.Updated({
        state: ownershipChanged(state, 'available'),
        effect: 'released',
      })

export const takeControl = (
  state: ControlLeaseState,
  ownerClientId: typeof ClientId.Type,
): ControlDecision =>
  state.holderClientId === ownerClientId
    ? ControlDecision.Unchanged({ reason: 'AlreadyController' })
    : ControlDecision.Updated({
        state: ownershipChanged(state, 'held', ownerClientId),
        effect: 'taken',
      })

export const markControllerDisconnected = (
  state: ControlLeaseState,
  clientId: typeof ClientId.Type,
  deadlineEpochMs: number,
): ControlDecision => {
  if (state.holderClientId !== clientId)
    return ControlDecision.Unchanged({ reason: 'NotController' })
  if (state.state === 'reconnecting')
    return ControlDecision.Unchanged({ reason: 'AlreadyReconnecting' })
  return ControlDecision.Updated({
    state: ControlLeaseState.make({
      ...state,
      state: 'reconnecting',
      graceDeadlineEpochMs: NonNegativeInt.make(deadlineEpochMs),
    }),
    effect: 'graceStarted',
  })
}

export const markControllerReconnected = (
  state: ControlLeaseState,
  clientId: typeof ClientId.Type,
): ControlDecision => {
  if (state.holderClientId !== clientId)
    return ControlDecision.Unchanged({ reason: 'NotController' })
  if (state.state !== 'reconnecting')
    return ControlDecision.Unchanged({ reason: 'NotReconnecting' })
  return ControlDecision.Updated({
    state: ControlLeaseState.make({
      leaseId: state.leaseId,
      revision: state.revision,
      state: 'held',
      holderClientId: clientId,
      requests: state.requests,
    }),
    effect: 'reconnected',
  })
}

export const expireControlGrace = (
  state: ControlLeaseState,
  nowEpochMs: number,
): ControlDecision => {
  if (
    state.state !== 'reconnecting' ||
    state.graceDeadlineEpochMs === undefined ||
    nowEpochMs < state.graceDeadlineEpochMs
  ) {
    return ControlDecision.Unchanged({ reason: 'GraceNotExpired' })
  }
  return ControlDecision.Updated({
    state: ownershipChanged(state, 'available'),
    effect: 'expired',
  })
}

function ownershipChanged(
  state: ControlLeaseState,
  nextState: 'available' | 'held',
  holderClientId?: typeof ClientId.Type,
): ControlLeaseState {
  return ControlLeaseState.make({
    leaseId: state.leaseId,
    revision: LeaseRevision.make(state.revision + 1),
    state: nextState,
    ...(holderClientId === undefined ? {} : { holderClientId }),
    requests: [],
  })
}
