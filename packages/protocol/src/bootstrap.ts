import { Schema } from 'effect'
import { CommandFailure } from './failures.js'
import { ObserveWorkspaceProjection } from './observe.js'
import {
  ClientCapability,
  ClientId,
  EventCursor,
  ExpiresAt,
  GeneratedAt,
  LeaseRevision,
  MembershipRole,
  NonNegativeInt,
  NonNegativeNumber,
  PersonId,
  PlanId,
  PlanRevision,
  PreviewId,
  RunId,
  RunRevision,
  SnapshotVersion,
} from './primitives.js'
import { RunSequenceDefinition } from './commands.js'

export const PlanSequenceDetail = Schema.Struct({
  sequenceId: Schema.NonEmptyString,
  target: Schema.NonEmptyString,
  capture: Schema.NonEmptyString,
  acquisition: Schema.NonEmptyString,
  stopCondition: Schema.NonEmptyString,
  window: Schema.Struct({
    startsAt: Schema.NonEmptyString,
    endsAt: Schema.NonEmptyString,
    usableMinutes: NonNegativeInt,
    peakAltitudeDeg: Schema.Finite,
    horizonClearanceDeg: Schema.Finite,
  }),
  estimatedMinutes: NonNegativeInt,
  storageForecastMb: NonNegativeInt,
  horizon: Schema.Literals(['clear', 'limited', 'blocked', 'missing']),
  storage: Schema.Literals(['available', 'limited', 'blocked', 'missing']),
  viability: Schema.Literals(['viable', 'limited', 'blocked']),
  definition: RunSequenceDefinition,
})

export interface PlanSequenceDetail extends Schema.Schema.Type<
  typeof PlanSequenceDetail
> {}

export const AcceptedRunDefinitionSummary = Schema.Struct({
  id: Schema.NonEmptyString,
  sourcePlanRevision: PlanRevision,
  acceptedAt: Schema.NonEmptyString,
  executor: Schema.Literals(['fake', 'fixture', 'real']),
})

export const PlanActionEligibility = Schema.TaggedUnion({
  Eligible: {},
  Ineligible: {
    reason: Schema.Literals([
      'ownerRequired',
      'readOnlyClient',
      'controlRequired',
      'planNotReady',
      'acceptedDefinitionRequired',
      'activeRunRequired',
      'activeRunPresent',
      'definitionAlreadyAccepted',
      'terminalRun',
      'pausedRun',
      'runAdvanced',
      'previewRequired',
    ]),
  },
})

export const PlanWorkspaceProjection = Schema.Struct({
  planId: PlanId,
  revision: PlanRevision,
  readiness: Schema.Literals(['ready', 'readyWithLimitations', 'blocked']),
  readinessSummary: Schema.NonEmptyString,
  limitations: Schema.Array(Schema.NonEmptyString),
  sequences: Schema.NonEmptyArray(PlanSequenceDetail),
  acceptedRunDefinition: Schema.optionalKey(AcceptedRunDefinitionSummary),
  runMutationPreview: Schema.optionalKey(
    Schema.Struct({
      previewId: PreviewId,
      classification: Schema.Literals([
        'nonDisruptive',
        'notice',
        'disruptive',
      ]),
      consequences: Schema.NonEmptyString,
      expiresAt: ExpiresAt,
      approvalRequired: Schema.Boolean,
      approvalToken: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
  actions: Schema.optionalKey(
    Schema.Struct({
      saveDraft: PlanActionEligibility,
      acceptRunDefinition: PlanActionEligibility,
      startAcceptedRun: PlanActionEligibility,
      previewRunMutation: PlanActionEligibility,
      applyRunMutation: PlanActionEligibility,
      approveDisruptiveRunMutation: PlanActionEligibility,
    }),
  ),
})

export interface PlanWorkspaceProjection extends Schema.Schema.Type<
  typeof PlanWorkspaceProjection
> {}

export const BootstrapMembership = Schema.Struct({
  personId: PersonId,
  role: MembershipRole,
  clientId: ClientId,
  capability: ClientCapability,
})

export interface BootstrapMembership extends Schema.Schema.Type<
  typeof BootstrapMembership
> {}

export const BootstrapControl = Schema.Struct({
  revision: LeaseRevision,
  state: Schema.Literals(['held', 'reconnecting', 'unheld']),
  holderClientId: Schema.optionalKey(ClientId),
  reconnectGraceUntil: Schema.optionalKey(ExpiresAt),
  pendingRequests: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        requestId: Schema.NonEmptyString,
        personId: PersonId,
        clientId: ClientId,
        expiresAt: ExpiresAt,
      }),
    ),
  ),
})

export interface BootstrapControl extends Schema.Schema.Type<
  typeof BootstrapControl
> {}

export const ActiveRunSummary = Schema.Struct({
  runId: RunId,
  revision: RunRevision,
  phase: Schema.Literals([
    'preflight',
    'acquire',
    'capture',
    'verify',
    'recover',
    'completed',
    'paused',
    'stopped',
    'parkRequested',
  ]),
  target: Schema.NonEmptyString,
  progress: NonNegativeNumber.check(Schema.isLessThanOrEqualTo(100)),
  completedSequenceCount: NonNegativeInt,
})

export interface ActiveRunSummary extends Schema.Schema.Type<
  typeof ActiveRunSummary
> {}

export const BootstrapActiveRun = Schema.TaggedUnion({
  Active: { run: ActiveRunSummary },
  None: {},
})

export type BootstrapActiveRun = typeof BootstrapActiveRun.Type

export const BootstrapHealthState = Schema.Literals([
  'healthy',
  'degraded',
  'unavailable',
  'stale',
  'unknown',
])

export const BootstrapSubsystemHealth = Schema.Struct({
  state: BootstrapHealthState,
  observedAt: GeneratedAt,
  reason: Schema.optionalKey(Schema.NonEmptyString),
})

export interface BootstrapSubsystemHealth extends Schema.Schema.Type<
  typeof BootstrapSubsystemHealth
> {}

export const BootstrapHealth = Schema.Struct({
  service: BootstrapSubsystemHealth,
  rig: BootstrapSubsystemHealth,
  tunnel: BootstrapSubsystemHealth,
  processing: BootstrapSubsystemHealth,
  publication: BootstrapSubsystemHealth,
  storage: BootstrapSubsystemHealth,
})

export interface BootstrapHealth extends Schema.Schema.Type<
  typeof BootstrapHealth
> {}

export const BootstrapSnapshot = Schema.Struct({
  snapshotVersion: SnapshotVersion,
  eventCursor: EventCursor,
  generatedAt: GeneratedAt,
  membership: BootstrapMembership,
  control: BootstrapControl,
  plan: Schema.optionalKey(PlanWorkspaceProjection),
  observe: Schema.optionalKey(ObserveWorkspaceProjection),
  activeRun: BootstrapActiveRun,
  health: BootstrapHealth,
})

export interface BootstrapSnapshot extends Schema.Schema.Type<
  typeof BootstrapSnapshot
> {}

export const BootstrapHttpSuccessEnvelope = Schema.Struct({
  ok: Schema.Literal(true),
  data: BootstrapSnapshot,
})

export interface BootstrapHttpSuccessEnvelope extends Schema.Schema.Type<
  typeof BootstrapHttpSuccessEnvelope
> {}

export const BootstrapHttpFailure = Schema.TaggedUnion({
  AuthenticationFailure: {
    reason: Schema.Literals(['Unauthenticated', 'MembershipRequired']),
    summary: Schema.NonEmptyString,
  },
  ServiceUnavailable: {
    reason: Schema.Literal('ServiceUnavailable'),
    summary: Schema.NonEmptyString,
  },
})

export type BootstrapHttpFailure = typeof BootstrapHttpFailure.Type

export const BootstrapHttpFailureEnvelope = Schema.Struct({
  ok: Schema.Literal(false),
  failure: BootstrapHttpFailure,
})

export interface BootstrapHttpFailureEnvelope extends Schema.Schema.Type<
  typeof BootstrapHttpFailureEnvelope
> {}

export const BootstrapSseEventEnvelope = Schema.Struct({
  id: EventCursor,
  event: Schema.Literal('ProjectionChanged'),
  data: BootstrapSnapshot,
}).check(
  Schema.makeFilter(({ id, data }) =>
    id === data.eventCursor
      ? undefined
      : { path: ['id'], issue: 'SSE event id must equal data.eventCursor' },
  ),
)

export interface BootstrapSseEventEnvelope extends Schema.Schema.Type<
  typeof BootstrapSseEventEnvelope
> {}

export const CommandHttpSuccessEnvelope = Schema.Struct({
  ok: Schema.Literal(true),
  data: BootstrapSnapshot,
})

export interface CommandHttpSuccessEnvelope extends Schema.Schema.Type<
  typeof CommandHttpSuccessEnvelope
> {}

export const CommandHttpFailureEnvelope = Schema.Struct({
  ok: Schema.Literal(false),
  failure: Schema.TaggedUnion({
    AuthenticationFailure: { summary: Schema.NonEmptyString },
    InvalidInput: { summary: Schema.NonEmptyString },
    CommandRejected: { failure: CommandFailure },
  }),
})

export interface CommandHttpFailureEnvelope extends Schema.Schema.Type<
  typeof CommandHttpFailureEnvelope
> {}
