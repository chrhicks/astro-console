import type { LocalIdentity } from './identity.ts'

export type RunPhase =
  | 'preflight'
  | 'acquire'
  | 'capture'
  | 'verify'
  | 'completed'
  | 'paused'
  | 'stopped'
  | 'parkRequested'
export type RunMutation = {
  readonly previewId: string
  readonly kind: 'reprioritizeSecond' | 'shortenSecond' | 'discardCurrent'
}
export type Run = {
  readonly id: string
  readonly revision: number
  readonly phase: RunPhase
  readonly target: string
  readonly progress: number
  readonly sourceDefinitionId?: string
  readonly activeSequenceIndex?: number
  readonly completedSequenceCount?: number
  readonly resumablePhase?: Exclude<
    RunPhase,
    'paused' | 'completed' | 'stopped' | 'parkRequested'
  >
  readonly retryPhase?: 'preflight' | 'acquire' | 'capture' | 'verify'
  readonly appliedMutations?: ReadonlyArray<RunMutation>
}
export const resumableRunPhase = (
  phase: RunPhase,
):
  | Exclude<RunPhase, 'paused' | 'completed' | 'stopped' | 'parkRequested'>
  | undefined =>
  phase === 'preflight' ||
  phase === 'acquire' ||
  phase === 'capture' ||
  phase === 'verify'
    ? phase
    : undefined
export type Evidence = {
  readonly frameId: string
  readonly capturedAt: string
  readonly quality: 'verified' | 'warning'
  readonly desired: string
  readonly solved: string
  readonly uncertaintyArcsec: number
  readonly stack?: {
    readonly availability: 'available' | 'unavailable'
    readonly observedAt: string
    readonly frameCount: number
    readonly message: string
  }
  readonly correction: {
    readonly state: 'automatic' | 'exhausted'
    readonly evidence: string
    readonly bound: string
    readonly protection: string
    readonly action: string
  }
}
export type PlanReadiness = 'ready' | 'readyWithLimitations' | 'blocked'
export type DraftSequence = {
  readonly sequenceId: string
  readonly target: string
  readonly capture: string
  readonly acquisition: string
  readonly stopCondition: string
  readonly window: {
    readonly startsAt: string
    readonly endsAt: string
    readonly usableMinutes: number
    readonly peakAltitudeDeg: number
    readonly horizonClearanceDeg: number
  }
  readonly estimatedMinutes: number
  readonly storageForecastMb: number
  readonly horizon: 'clear' | 'limited' | 'blocked' | 'missing'
  readonly storage: 'available' | 'limited' | 'blocked' | 'missing'
}
export type PlanProjection = {
  readonly planId: string
  readonly revision: number
  readonly readiness: PlanReadiness
  readonly readinessSummary: string
  readonly limitations: ReadonlyArray<string>
  readonly sequences: ReadonlyArray<
    DraftSequence & { readonly viability: 'viable' | 'limited' | 'blocked' }
  >
}
export type RunDefinition = {
  readonly id: string
  readonly sourcePlanId: string
  readonly sourcePlanRevision: number
  readonly acceptedAt: string
  readonly executor: 'fake' | 'fixture'
  readonly plan: PlanProjection
}
export type Snapshot = {
  readonly snapshotVersion: number
  readonly eventCursor: number
  readonly generatedAt: string
  readonly identity: LocalIdentity
  readonly plan: {
    readonly id: string
    readonly revision: number
    readonly target: string
    readonly readiness: PlanReadiness | 'unavailable'
    readonly runEligible: boolean
  }
  readonly control: {
    readonly holderClientId: string | null
    readonly revision: number
    readonly state: 'held' | 'reconnecting' | 'unheld'
    readonly reconnectGraceUntil?: string
    readonly pendingRequests: ReadonlyArray<{
      readonly requestId: string
      readonly clientId: string
      readonly personId: string
      readonly expiresAt: string
    }>
  }
  readonly run: Run | null
  readonly dispatch:
    'none' | 'pending' | 'dispatched' | 'unavailable' | 'failed'
  readonly dispatchAction: 'none' | 'pause' | 'resume' | 'stop'
  readonly evidence: Evidence
  readonly connection: 'current'
}
export type ControlEvent =
  | 'ControlRequested'
  | 'ControlGranted'
  | 'ControlDeclined'
  | 'ControlReleased'
  | 'OwnerTookControl'
  | 'ControlLeaseExpired'
  | 'RunPaused'
  | 'RunResumed'
  | 'RunStopped'
  | 'FakeSequenceSkipped'
  | 'FakePhaseRetried'
  | 'FakeParkRequested'
  | 'RunMutationApplied'
export type FailureReason =
  | 'Unauthenticated'
  | 'FreshnessConflict'
  | 'PlanUnavailable'
  | 'PlanNotReady'
  | 'RunDefinitionAlreadyAccepted'
  | 'ClientReadOnly'
  | 'ControlLeaseLost'
  | 'AlreadyController'
  | 'ControlRequestAlreadyPending'
  | 'OwnerRequired'
  | 'ControlRequestUnavailable'
  | 'ActiveRunConflict'
  | 'RunRevisionConflict'
  | 'AlreadyPaused'
  | 'AlreadyTerminal'
  | 'NotPaused'
  | 'ResumePhaseUnavailable'
  | 'IdempotencyConflict'
  | 'PreviewUnavailable'
  | 'PreviewExpired'
  | 'ApprovalRequired'
  | 'ApprovalMismatch'
  | 'RetryExhausted'
  | 'PolicyUnavailable'
  | 'InvalidInput'
  | 'DraftUnchanged'
export type CommandResult =
  | {
      readonly outcome: 'accepted'
      readonly eventType?: ControlEvent
      readonly message?: string
      readonly run?: Run
      readonly snapshot: Snapshot
    }
  | {
      readonly outcome: 'rejected'
      readonly reason: FailureReason
      readonly message: string
    }
export type SavePlanDraftResult =
  | {
      readonly outcome: 'accepted'
      readonly plan: PlanProjection
      readonly snapshot: Snapshot
    }
  | {
      readonly outcome: 'rejected'
      readonly reason: FailureReason
      readonly message: string
    }
export type AcceptRunDefinitionResult =
  | {
      readonly outcome: 'accepted'
      readonly runDefinition: RunDefinition
      readonly snapshot: Snapshot
    }
  | {
      readonly outcome: 'rejected'
      readonly reason: FailureReason
      readonly message: string
    }
