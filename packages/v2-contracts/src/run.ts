import { Data, Schema } from "effect"
import { NonNegativeInt, PlanId, PlanRevision, PreviewId, RunId, RunRevision } from "./primitives.js"
import { Command, RunMutation, RunSequenceDefinition } from "./commands.js"

export { RunSequenceDefinition } from "./commands.js"

export const RunExecutionContext = Schema.Struct({
  rigId: Schema.NonEmptyString,
  mountDeviceId: Schema.NonEmptyString,
  cameraDeviceId: Schema.NonEmptyString,
  focuserDeviceId: Schema.optionalKey(Schema.NonEmptyString),
  filterWheelDeviceId: Schema.optionalKey(Schema.NonEmptyString),
  latitudeDegrees: Schema.Finite.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
  longitudeDegrees: Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  elevationMeters: Schema.Finite,
  completionBehavior: Schema.Literals(["park", "hold"]),
  unsafeBehavior: Schema.Literals(["pauseAndPark", "stopAndPark"]),
})

export const ValidatedObservingPlan = Schema.Struct({
  planId: PlanId,
  revision: PlanRevision,
  validation: Schema.Literals(["ready", "readyWithLimitations", "blocked"]),
  limitations: Schema.Array(Schema.Struct({
    limitationId: Schema.NonEmptyString,
    summary: Schema.NonEmptyString,
  })),
  executionContext: RunExecutionContext,
  sequences: Schema.NonEmptyArray(RunSequenceDefinition),
}).check(Schema.makeFilter((plan) => {
  if (plan.validation === "ready" && plan.limitations.length > 0) {
    return { path: ["limitations"], issue: "a ready plan cannot retain limitations" }
  }
  if (plan.validation === "readyWithLimitations" && plan.limitations.length === 0) {
    return { path: ["limitations"], issue: "ready with limitations requires explicit limitation records" }
  }
  return uniqueRunInputs(plan.sequences.map(({ sequenceId }) => sequenceId), plan.limitations.map(({ limitationId }) => limitationId))
}))

export interface ValidatedObservingPlan extends Schema.Schema.Type<typeof ValidatedObservingPlan> {}

export const RunStartReadiness = Schema.TaggedUnion({
  Ready: { preconditionToken: Schema.NonEmptyString },
  Blocked: { reasons: Schema.NonEmptyArray(Schema.NonEmptyString) },
})

export const RunDefinition = Schema.Struct({
  runId: RunId,
  sourcePlanId: PlanId,
  sourcePlanRevision: PlanRevision,
  acceptedAt: Schema.NonEmptyString,
  acceptedLimitations: Schema.Array(Schema.Struct({
    limitationId: Schema.NonEmptyString,
    summary: Schema.NonEmptyString,
  })),
  executionContext: RunExecutionContext,
  sequences: Schema.NonEmptyArray(RunSequenceDefinition),
}).check(Schema.makeFilter((definition) =>
  uniqueRunInputs(
    definition.sequences.map(({ sequenceId }) => sequenceId),
    definition.acceptedLimitations.map(({ limitationId }) => limitationId),
  )))

export interface RunDefinition extends Schema.Schema.Type<typeof RunDefinition> {}

export const RunWork = Schema.TaggedUnion({
  BeginRun: { runId: RunId },
  RefreshFutureSchedule: { runId: RunId },
  StopActiveExposure: {
    runId: RunId,
    provisionalEvidenceId: Schema.optionalKey(Schema.NonEmptyString),
    reason: Schema.NonEmptyString,
  },
  SlewAndAcquire: { runId: RunId, sequenceId: Schema.NonEmptyString },
  PauseRun: { runId: RunId },
  ResumeRun: { runId: RunId, phase: Schema.NonEmptyString },
  StopRun: { runId: RunId },
})

export const RunMutationImpact = Schema.Literals(["nonDisruptive", "notice", "disruptive", "ineligible"])

export const ActiveRunState = Schema.Struct({
  runId: RunId,
  revision: RunRevision,
  phase: Schema.Literals(["preflight", "acquire", "capture", "verify", "recover", "paused", "completed", "failed", "stopped"]),
  pausedFromPhase: Schema.optionalKey(Schema.Literals(["preflight", "acquire", "capture", "verify", "recover"])),
  activeSequenceId: Schema.optionalKey(Schema.NonEmptyString),
  futureSequenceIds: Schema.Array(Schema.NonEmptyString),
  acceptedMutations: Schema.Array(RunMutation),
  activeExposure: Schema.optionalKey(Schema.Struct({
    startedAtEpochMs: NonNegativeInt,
    exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
    provisionalEvidenceId: Schema.NonEmptyString,
  })),
})

export interface ActiveRunState extends Schema.Schema.Type<typeof ActiveRunState> {}

type StartRunCommand = Extract<Command, { readonly _tag: "StartRunFromPlan" }>

export interface StartRunInput {
  readonly command: StartRunCommand
  readonly plan: ValidatedObservingPlan
  readonly readiness: typeof RunStartReadiness.Type
  readonly activeRunId?: typeof RunId.Type
  readonly assignedRunId: typeof RunId.Type
  readonly acceptedAt: string
}

export type StartRunDecision = Data.TaggedEnum<{
  Started: { readonly definition: RunDefinition; readonly state: ActiveRunState; readonly work: typeof RunWork.Type }
  Rejected: {
    readonly reason: "PlanNotReady" | "PlanLimitationsNotAccepted" | "PlanRevisionConflict" | "ActiveRunConflict" | "CriticalStateUnknown" | "PreconditionExpired"
    readonly explanations: ReadonlyArray<string>
  }
}>

export const StartRunDecision = Data.taggedEnum<StartRunDecision>()

export const decideStartRun = (input: StartRunInput): StartRunDecision => {
  if (input.activeRunId !== undefined) {
    return StartRunDecision.Rejected({ reason: "ActiveRunConflict", explanations: [`Run ${input.activeRunId} is already active`] })
  }
  if (input.command.planId !== input.plan.planId || input.command.expectedPlanRevision !== input.plan.revision) {
    return StartRunDecision.Rejected({ reason: "PlanRevisionConflict", explanations: ["The accepted plan input changed"] })
  }
  if (input.plan.validation === "blocked") {
    return StartRunDecision.Rejected({ reason: "PlanNotReady", explanations: ["The observing plan has blocking validation findings"] })
  }
  const unacceptedLimitations = input.plan.limitations.filter(
    ({ limitationId }) => !input.command.acceptedPlanLimitationIds.includes(limitationId),
  )
  const acceptedLimitationIds = new Set(input.command.acceptedPlanLimitationIds)
  const limitationIds = new Set(input.plan.limitations.map(({ limitationId }) => limitationId))
  const acceptanceMismatch = acceptedLimitationIds.size !== input.command.acceptedPlanLimitationIds.length
    || acceptedLimitationIds.size !== limitationIds.size
    || [...acceptedLimitationIds].some((limitationId) => !limitationIds.has(limitationId))
  if (unacceptedLimitations.length > 0 || acceptanceMismatch) {
    return StartRunDecision.Rejected({
      reason: "PlanLimitationsNotAccepted",
      explanations: unacceptedLimitations.length > 0
        ? unacceptedLimitations.map(({ summary }) => summary)
        : ["Accepted plan limitations do not match the current validated plan"],
    })
  }

  return RunStartReadiness.match(input.readiness, {
    Blocked: ({ reasons }): StartRunDecision => StartRunDecision.Rejected({ reason: "CriticalStateUnknown", explanations: reasons }),
    Ready: ({ preconditionToken }): StartRunDecision => {
      if (preconditionToken !== input.command.preconditionToken) {
        return StartRunDecision.Rejected({ reason: "PreconditionExpired", explanations: ["Observatory readiness changed after review"] })
      }
      const definition = RunDefinition.make({
        runId: input.assignedRunId,
        sourcePlanId: input.plan.planId,
        sourcePlanRevision: input.plan.revision,
        acceptedAt: input.acceptedAt,
        acceptedLimitations: input.plan.limitations.filter(({ limitationId }) =>
          input.command.acceptedPlanLimitationIds.includes(limitationId)),
        executionContext: input.plan.executionContext,
        sequences: input.plan.sequences,
      })
      const [active, ...future] = input.plan.sequences
      return StartRunDecision.Started({
        definition,
        state: ActiveRunState.make({
          runId: input.assignedRunId,
          revision: RunRevision.make(0),
          phase: "preflight",
          activeSequenceId: active.sequenceId,
          futureSequenceIds: future.map((sequence) => sequence.sequenceId),
          acceptedMutations: [],
        }),
        work: RunWork.cases.BeginRun.make({ runId: input.assignedRunId }),
      })
    },
  })
}

export const RunMutationPreview = Schema.Struct({
  previewId: PreviewId,
  runId: RunId,
  basedOnRevision: RunRevision,
  mutation: RunMutation,
  impact: RunMutationImpact,
  consequences: Schema.NonEmptyArray(Schema.NonEmptyString),
  expiresAtEpochMs: NonNegativeInt,
  approvalId: Schema.optionalKey(Schema.NonEmptyString),
})

export interface RunMutationPreview extends Schema.Schema.Type<typeof RunMutationPreview> {}

export interface PreviewRunMutationInput {
  readonly state: ActiveRunState
  readonly definition: RunDefinition
  readonly mutation: typeof RunMutation.Type
  readonly previewId: typeof PreviewId.Type
  readonly nowEpochMs: number
  readonly expiresAtEpochMs: number
  readonly approvalId: string
  readonly forecast?: {
    readonly completionDeltaSeconds: number
    readonly viabilityChanges: ReadonlyArray<string>
  }
}

export type RunMutationPreviewDecision = Data.TaggedEnum<{
  Previewed: { readonly preview: RunMutationPreview }
  Ineligible: { readonly consequences: ReadonlyArray<string> }
}>

export const RunMutationPreviewDecision = Data.taggedEnum<RunMutationPreviewDecision>()

export const previewRunMutation = (input: PreviewRunMutationInput): RunMutationPreviewDecision =>
  RunMutation.match(input.mutation, {
    AppendFutureSequence: ({ sequence }) => {
      if (input.definition.sequences.some((candidate) => candidate.sequenceId === sequence.sequenceId)) {
        return RunMutationPreviewDecision.Ineligible({ consequences: [`Sequence ${sequence.sequenceId} already exists`] })
      }
      return RunMutationPreviewDecision.Previewed({
        preview: RunMutationPreview.make({
          previewId: input.previewId,
          runId: input.state.runId,
          basedOnRevision: input.state.revision,
          mutation: input.mutation,
          impact: "nonDisruptive",
          consequences: [
            `${sequence.targetName} is added after current work`,
            `Forecast adds ${sequence.estimatedDurationSeconds} seconds and ${sequence.estimatedStorageBytes} bytes`,
          ],
          expiresAtEpochMs: input.expiresAtEpochMs,
        }),
      })
    },
    ReorderFutureSequences: ({ sequenceIds }) => {
      if (!sameMembers(sequenceIds, input.state.futureSequenceIds)) {
        return RunMutationPreviewDecision.Ineligible({ consequences: ["Reorder must contain every future sequence exactly once"] })
      }
      if (sequenceIds.every((sequenceId, index) => sequenceId === input.state.futureSequenceIds[index])) {
        return RunMutationPreviewDecision.Ineligible({ consequences: ["The future sequence order is unchanged"] })
      }
      if (input.forecast === undefined) {
        return RunMutationPreviewDecision.Ineligible({ consequences: ["Authoritative schedule forecast is unavailable"] })
      }
      const forecast = input.forecast
      return RunMutationPreviewDecision.Previewed({
        preview: RunMutationPreview.make({
          previewId: input.previewId,
          runId: input.state.runId,
          basedOnRevision: input.state.revision,
          mutation: input.mutation,
          impact: "notice",
          consequences: [
            `Future order becomes ${sequenceIds.join(", ")}`,
            `Forecast completion changes by ${forecast.completionDeltaSeconds} seconds`,
            ...forecast.viabilityChanges,
          ],
          expiresAtEpochMs: input.expiresAtEpochMs,
        }),
      })
    },
    SwitchTargetNow: ({ sequenceId }) => {
      if (!input.state.futureSequenceIds.includes(sequenceId)) {
        return RunMutationPreviewDecision.Ineligible({ consequences: [`Sequence ${sequenceId} is not queued for this run`] })
      }
      const target = input.definition.sequences.find((sequence) => sequence.sequenceId === sequenceId)
      if (target === undefined) {
        return RunMutationPreviewDecision.Ineligible({ consequences: [`Sequence ${sequenceId} has no accepted execution definition`] })
      }
      const elapsedSeconds = input.state.activeExposure === undefined
        ? 0
        : Math.min(input.state.activeExposure.exposureSeconds, Math.max(0, (input.nowEpochMs - input.state.activeExposure.startedAtEpochMs) / 1000))
      return RunMutationPreviewDecision.Previewed({
        preview: RunMutationPreview.make({
          previewId: input.previewId,
          runId: input.state.runId,
          basedOnRevision: input.state.revision,
          mutation: input.mutation,
          impact: "disruptive",
          consequences: [
            `Stop the current exposure and discard ${elapsedSeconds} seconds of provisional evidence`,
            `Slew to ${target.targetName}`,
            `Restart acquisition with a ${target.recenterThresholdArcsec} arcsecond recenter threshold`,
          ],
          expiresAtEpochMs: input.expiresAtEpochMs,
          approvalId: input.approvalId,
        }),
      })
    },
    UpdateFutureSequence: ({ sequenceId, exposureSeconds, frameCount, priority }) => {
      if (!input.state.futureSequenceIds.includes(sequenceId)) {
        return RunMutationPreviewDecision.Ineligible({ consequences: [`Only queued future sequence ${sequenceId} may be updated`] })
      }
      if (exposureSeconds === undefined && frameCount === undefined && priority === undefined) {
        return RunMutationPreviewDecision.Ineligible({ consequences: ["No execution setting changed"] })
      }
      const current = input.definition.sequences.find((sequence) => sequence.sequenceId === sequenceId)
      if (current === undefined) {
        return RunMutationPreviewDecision.Ineligible({ consequences: [`Sequence ${sequenceId} has no accepted execution definition`] })
      }
      const nextExposure = exposureSeconds ?? current.exposureSeconds
      const nextFrameCount = frameCount ?? current.frameCount
      return RunMutationPreviewDecision.Previewed({
        preview: RunMutationPreview.make({
          previewId: input.previewId,
          runId: input.state.runId,
          basedOnRevision: input.state.revision,
          mutation: input.mutation,
          impact: "notice",
          consequences: [
            `Future sequence ${sequenceId} changes from ${current.frameCount} x ${current.exposureSeconds}s to ${nextFrameCount} x ${nextExposure}s`,
            `Estimated exposure time changes by ${nextExposure * nextFrameCount - current.exposureSeconds * current.frameCount} seconds`,
            "Current exposure and accepted evidence remain untouched",
          ],
          expiresAtEpochMs: input.expiresAtEpochMs,
        }),
      })
    },
  })

export type RunMutationDecision = Data.TaggedEnum<{
  Applied: {
    readonly state: ActiveRunState
    readonly definition: RunDefinition
    readonly impact: "nonDisruptive" | "notice" | "disruptive"
    readonly consequences: ReadonlyArray<string>
    readonly work: ReadonlyArray<typeof RunWork.Type>
  }
  RequiresApproval: { readonly preview: RunMutationPreview }
  Ineligible: { readonly consequences: ReadonlyArray<string> }
  StalePreview: { readonly currentRevision: number }
  ExpiredPreview: {}
  ApprovalMismatch: {}
}>

export const RunMutationDecision = Data.taggedEnum<RunMutationDecision>()

interface MutationApplication {
  readonly activeSequenceId: string | undefined
  readonly futureSequenceIds: ReadonlyArray<string>
  readonly definition: RunDefinition
  readonly work: ReadonlyArray<typeof RunWork.Type>
}

export const applyRunMutation = (
  state: ActiveRunState,
  definition: RunDefinition,
  preview: RunMutationPreview,
  nowEpochMs: number,
  approvalId?: string,
): RunMutationDecision => {
  if (preview.runId !== state.runId || preview.basedOnRevision !== state.revision) {
    return RunMutationDecision.StalePreview({ currentRevision: state.revision })
  }
  if (nowEpochMs > preview.expiresAtEpochMs) return RunMutationDecision.ExpiredPreview()
  if (preview.impact === "ineligible") return RunMutationDecision.Ineligible({ consequences: preview.consequences })
  if (preview.impact === "disruptive") {
    if (approvalId === undefined) return RunMutationDecision.RequiresApproval({ preview })
    if (approvalId !== preview.approvalId) return RunMutationDecision.ApprovalMismatch()
  }

  const mutation = RunMutation.match(preview.mutation, {
    AppendFutureSequence: ({ sequence }): MutationApplication => ({
      activeSequenceId: state.activeSequenceId,
      futureSequenceIds: [...state.futureSequenceIds, sequence.sequenceId],
      definition,
      work: [RunWork.cases.RefreshFutureSchedule.make({ runId: state.runId })],
    }),
    ReorderFutureSequences: ({ sequenceIds }): MutationApplication => ({
      activeSequenceId: state.activeSequenceId,
      futureSequenceIds: [...sequenceIds],
      definition,
      work: [RunWork.cases.RefreshFutureSchedule.make({ runId: state.runId })],
    }),
    SwitchTargetNow: ({ sequenceId }): MutationApplication => ({
      activeSequenceId: sequenceId,
      futureSequenceIds: state.futureSequenceIds.filter((id) => id !== sequenceId),
      definition,
      work: [
        RunWork.cases.StopActiveExposure.make({
          runId: state.runId,
          ...(state.activeExposure === undefined ? {} : { provisionalEvidenceId: state.activeExposure.provisionalEvidenceId }),
          reason: `Approved switch to ${sequenceId}`,
        }),
        RunWork.cases.SlewAndAcquire.make({ runId: state.runId, sequenceId }),
      ],
    }),
    UpdateFutureSequence: ({ sequenceId, exposureSeconds, frameCount, priority }): MutationApplication => {
      return {
        activeSequenceId: state.activeSequenceId,
        futureSequenceIds: [...state.futureSequenceIds],
        definition,
        work: [RunWork.cases.RefreshFutureSchedule.make({ runId: state.runId })],
      }
    },
  })

  const currentSequence = mutation.activeSequenceId === undefined ? {} : { activeSequenceId: mutation.activeSequenceId }
  const { activeExposure: _activeExposure, ...stateWithoutExposure } = state
  return RunMutationDecision.Applied({
    state: ActiveRunState.make({
      ...stateWithoutExposure,
      revision: RunRevision.make(state.revision + 1),
      ...currentSequence,
      futureSequenceIds: mutation.futureSequenceIds,
      acceptedMutations: [...state.acceptedMutations, preview.mutation],
      ...(preview.impact === "disruptive" || state.activeExposure === undefined ? {} : { activeExposure: state.activeExposure }),
    }),
    definition: mutation.definition,
    impact: preview.impact,
    consequences: preview.consequences,
    work: mutation.work,
  })
}

export type RunInterventionDecision = Data.TaggedEnum<{
  Applied: { readonly state: ActiveRunState; readonly work: typeof RunWork.Type }
  Ineligible: { readonly reason: "AlreadyPaused" | "NotPaused" | "AlreadyTerminal" | "ResumePhaseUnavailable" }
}>

export const RunInterventionDecision = Data.taggedEnum<RunInterventionDecision>()

export const decideRunIntervention = (
  state: ActiveRunState,
  intent: "pause" | "resume" | "stop",
): RunInterventionDecision => {
  if (state.phase === "completed" || state.phase === "failed" || state.phase === "stopped") {
    return RunInterventionDecision.Ineligible({ reason: "AlreadyTerminal" })
  }
  if (intent === "pause") {
    if (state.phase === "paused") return RunInterventionDecision.Ineligible({ reason: "AlreadyPaused" })
    return RunInterventionDecision.Applied({
      state: ActiveRunState.make({
        ...state,
        revision: RunRevision.make(state.revision + 1),
        phase: "paused",
        pausedFromPhase: state.phase,
      }),
      work: RunWork.cases.PauseRun.make({ runId: state.runId }),
    })
  }
  if (intent === "resume") {
    if (state.phase !== "paused") return RunInterventionDecision.Ineligible({ reason: "NotPaused" })
    if (state.pausedFromPhase === undefined) return RunInterventionDecision.Ineligible({ reason: "ResumePhaseUnavailable" })
    const resumedPhase = state.pausedFromPhase
    const { pausedFromPhase: _pausedFromPhase, ...resumable } = state
    return RunInterventionDecision.Applied({
      state: ActiveRunState.make({
        ...resumable,
        revision: RunRevision.make(state.revision + 1),
        phase: resumedPhase,
      }),
      work: RunWork.cases.ResumeRun.make({ runId: state.runId, phase: resumedPhase }),
    })
  }
  const { pausedFromPhase: _pausedFromPhase, activeExposure: _activeExposure, ...stoppable } = state
  return RunInterventionDecision.Applied({
    state: ActiveRunState.make({
      ...stoppable,
      revision: RunRevision.make(state.revision + 1),
      phase: "stopped",
    }),
    work: RunWork.cases.StopRun.make({ runId: state.runId }),
  })
}

function sameMembers(left: ReadonlyArray<string>, right: ReadonlyArray<string>) {
  return left.length === right.length && new Set(left).size === left.length && left.every((value) => right.includes(value))
}

function uniqueRunInputs(sequenceIds: ReadonlyArray<string>, limitationIds: ReadonlyArray<string>) {
  if (new Set(sequenceIds).size !== sequenceIds.length) {
    return { path: ["sequences"], issue: "run sequence identities must be unique" }
  }
  if (new Set(limitationIds).size !== limitationIds.length) {
    return { path: ["limitations"], issue: "plan limitation identities must be unique" }
  }
}
