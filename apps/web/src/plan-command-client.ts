import { Context, Data, Effect, Layer, Schema } from 'effect'
import {
  IdempotencyKey,
  PlanCommandResult,
  PlanCommandRequest,
  PlanCommandResponse,
  type BootstrapSnapshot,
  type PlanWorkspaceProjection,
} from '@astro-console/protocol'
import { BootstrapClient, BootstrapClientState } from './bootstrap-client'

type IdempotencyKeyValue = typeof IdempotencyKey.Type
type PlanCommandResultValue = typeof PlanCommandResult.Type

export type PlanAction = Data.TaggedEnum<{
  SaveDraft: {
    readonly sequences: ReadonlyArray<
      PlanWorkspaceProjection['sequences'][number]
    >
  }
  AcceptRunDefinition: Record<never, never>
  StartAcceptedRun: Record<never, never>
  PreviewRunMutation: {
    readonly mutation: 'shortenSecond' | 'discardCurrent'
  }
  ApplyRunMutation: Record<never, never>
  ApproveDisruptiveRunMutation: Record<never, never>
}>

export const PlanAction = Data.taggedEnum<PlanAction>()

export type PlanCommandSubmission = Data.TaggedEnum<{
  Accepted: {
    readonly result: PlanCommandResultValue
    readonly safeNextAction: string
  }
  Rejected: { readonly reason: string; readonly safeNextAction: string }
  Unavailable: { readonly reason: string; readonly safeNextAction: string }
}>

export const PlanCommandSubmission = Data.taggedEnum<PlanCommandSubmission>()

export class PlanCommandTransportFailure extends Schema.TaggedErrorClass<PlanCommandTransportFailure>()(
  'Web.PlanCommandTransportFailure',
  { reason: Schema.NonEmptyString },
) {}

export class PlanCommandResponseInvalid extends Schema.TaggedErrorClass<PlanCommandResponseInvalid>()(
  'Web.PlanCommandResponseInvalid',
  { reason: Schema.NonEmptyString },
) {}

export interface PlanCommandTransportShape {
  readonly submit: (
    body: unknown,
  ) => Effect.Effect<
    { readonly status: number; readonly body: unknown },
    PlanCommandTransportFailure
  >
}

export class PlanCommandTransport extends Context.Service<
  PlanCommandTransport,
  PlanCommandTransportShape
>()('@astro-console/web/PlanCommandTransport') {}

export interface PlanCommandClientShape {
  readonly submit: (action: PlanAction) => Effect.Effect<PlanCommandSubmission>
}

export class PlanCommandClient extends Context.Service<
  PlanCommandClient,
  PlanCommandClientShape
>()('@astro-console/web/PlanCommandClient') {}

export const layer = Layer.effect(
  PlanCommandClient,
  Effect.gen(function* () {
    const bootstrap = yield* BootstrapClient
    const transport = yield* PlanCommandTransport
    const submit = Effect.fn('PlanCommandClient.submit')(
      function* (action: PlanAction) {
        const state = yield* bootstrap.read()
        if (!BootstrapClientState.$is('Current')(state))
          return PlanCommandSubmission.Unavailable({
            reason:
              'A current authoritative snapshot is required before submitting this action.',
            safeNextAction:
              'Wait for the current Plan projection before trying again.',
          })
        const plan = state.snapshot.plan
        if (plan === undefined)
          return PlanCommandSubmission.Unavailable({
            reason:
              'Plan detail is unavailable from the current service snapshot.',
            safeNextAction: 'Wait for a Plan projection before trying again.',
          })
        const prepared = prepareAction(action, state.snapshot, plan)
        const eligibility = plan.actions?.[prepared.eligibilityKey]
        const unavailableReason =
          eligibility?._tag === 'Eligible'
            ? prepared.unavailableReason
            : 'This action is not available in the current Plan projection.'
        if (unavailableReason !== undefined)
          return PlanCommandSubmission.Unavailable({
            reason: unavailableReason,
            safeNextAction:
              'Read the projected Plan availability before trying another action.',
          })
        const idempotencyKey = yield* Effect.sync(() =>
          IdempotencyKey.make(crypto.randomUUID()),
        )
        const request = yield* Schema.decodeUnknownEffect(PlanCommandRequest)(
          prepared.request(idempotencyKey),
        ).pipe(
          Effect.mapError(
            () =>
              new PlanCommandResponseInvalid({
                reason: 'The Plan command could not be constructed.',
              }),
          ),
        )
        return yield* transport.submit(request).pipe(
          Effect.flatMap(({ body }) =>
            Schema.decodeUnknownEffect(PlanCommandResponse)(body).pipe(
              Effect.mapError(
                () =>
                  new PlanCommandResponseInvalid({
                    reason: 'The Plan command response was invalid.',
                  }),
              ),
            ),
          ),
          Effect.flatMap(
            (response): Effect.Effect<PlanCommandSubmission> =>
              PlanCommandResponse.guards.Accepted(response)
                ? (response.result._tag === 'RunMutationPreviewed'
                    ? bootstrap.refresh()
                    : Effect.void
                  ).pipe(
                    Effect.as(
                      PlanCommandSubmission.Accepted({
                        result: response.result,
                        safeNextAction:
                          'Await the next authoritative Plan projection before treating this action as complete.',
                      }),
                    ),
                  )
                : PlanCommandResponse.guards.Unavailable(response)
                  ? bootstrap.refresh().pipe(
                      Effect.as(
                        PlanCommandSubmission.Unavailable({
                          reason: response.failure.summary,
                          safeNextAction:
                            'Reconnect and recover a current Plan projection before trying again.',
                        }),
                      ),
                    )
                  : bootstrap.refresh().pipe(
                      Effect.as(
                        PlanCommandSubmission.Rejected({
                          reason: response.failure.summary,
                          safeNextAction:
                            'Read the current Plan projection before trying another action.',
                        }),
                      ),
                    ),
          ),
        )
      },
      (effect) =>
        effect.pipe(
          Effect.catchTags({
            'Web.PlanCommandTransportFailure': (error) =>
              Effect.succeed(
                PlanCommandSubmission.Unavailable({
                  reason: error.reason,
                  safeNextAction:
                    'Reconnect and read a current Plan projection before trying again.',
                }),
              ),
            'Web.PlanCommandResponseInvalid': (error) =>
              Effect.succeed(
                PlanCommandSubmission.Unavailable({
                  reason: error.reason,
                  safeNextAction:
                    'Wait for the authoritative Plan projection before trying again.',
                }),
              ),
          }),
        ),
    )
    return PlanCommandClient.of({ submit })
  }),
)

export const browserPlanCommandTransportLayer = Layer.succeed(
  PlanCommandTransport,
  PlanCommandTransport.of({
    submit: Effect.fn('PlanCommandTransport.submit')(function* (body: unknown) {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch('/api/plan/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          }),
        catch: () =>
          new PlanCommandTransportFailure({
            reason: 'The Plan command service could not be reached.',
          }),
      })
      const parsedBody = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new PlanCommandTransportFailure({
            reason: 'The Plan command response could not be read.',
          }),
      })
      return { status: response.status, body: parsedBody }
    }),
  }),
)

type PlanEligibilityKey = keyof NonNullable<PlanWorkspaceProjection['actions']>

type PreparedAction = {
  readonly eligibilityKey: PlanEligibilityKey
  readonly unavailableReason?: string
  readonly request: (idempotencyKey: IdempotencyKeyValue) => unknown
}

function prepareAction(
  action: PlanAction,
  snapshot: BootstrapSnapshot,
  plan: PlanWorkspaceProjection,
): PreparedAction {
  const expectedRunRevision =
    snapshot.activeRun._tag === 'Active' ? snapshot.activeRun.run.revision : -1
  const planRequest = (idempotencyKey: IdempotencyKeyValue) => ({
    planId: plan.planId,
    expectedPlanRevision: plan.revision,
    expectedLeaseRevision: snapshot.control.revision,
    idempotencyKey,
  })
  const prepared = PlanAction.$match(action, {
    SaveDraft: ({ sequences }) => ({
      eligibilityKey: 'saveDraft' as const,
      request: (idempotencyKey: IdempotencyKeyValue) => ({
        intent: {
          _tag: 'SaveDraft',
          planId: plan.planId,
          expectedPlanRevision: plan.revision,
          idempotencyKey,
          sequences: sequences.map((sequence) => ({
            sequenceId: sequence.sequenceId,
            definition: sequence.definition,
          })),
        },
      }),
    }),
    AcceptRunDefinition: () => ({
      eligibilityKey: 'acceptRunDefinition' as const,
      request: (idempotencyKey: IdempotencyKeyValue) => ({
        intent: {
          _tag: 'AcceptRunDefinition',
          ...planRequest(idempotencyKey),
        },
      }),
    }),
    StartAcceptedRun: () => ({
      eligibilityKey: 'startAcceptedRun' as const,
      request: (idempotencyKey: IdempotencyKeyValue) => ({
        intent: {
          _tag: 'StartAcceptedRun',
          ...planRequest(idempotencyKey),
        },
      }),
    }),
    PreviewRunMutation: ({ mutation }) => ({
      eligibilityKey: 'previewRunMutation' as const,
      request: (idempotencyKey: IdempotencyKeyValue) => ({
        intent: {
          _tag: 'PreviewRunMutation',
          mutation,
          expectedLeaseRevision: snapshot.control.revision,
          expectedRunRevision,
          idempotencyKey,
        },
      }),
    }),
    ApplyRunMutation: () => {
      const preview = plan.runMutationPreview
      return {
        eligibilityKey: 'applyRunMutation' as const,
        ...(preview === undefined
          ? {
              unavailableReason:
                'The current Plan mutation preview is unavailable.',
            }
          : {}),
        request: (idempotencyKey: IdempotencyKeyValue) => ({
          intent: {
            _tag: 'ApplyRunMutation',
            previewId: preview?.previewId,
            expectedLeaseRevision: snapshot.control.revision,
            expectedRunRevision,
            idempotencyKey,
          },
        }),
      }
    },
    ApproveDisruptiveRunMutation: () => {
      const preview = plan.runMutationPreview
      const unavailableReason =
        preview === undefined
          ? 'The current Plan mutation preview is unavailable.'
          : preview.approvalToken === undefined
            ? 'The current Plan mutation approval is unavailable.'
            : undefined
      return {
        eligibilityKey: 'approveDisruptiveRunMutation' as const,
        ...(unavailableReason === undefined ? {} : { unavailableReason }),
        request: (idempotencyKey: IdempotencyKeyValue) => ({
          intent: {
            _tag: 'ApproveDisruptiveRunMutation',
            previewId: preview?.previewId,
            approvalToken: preview?.approvalToken,
            expectedLeaseRevision: snapshot.control.revision,
            expectedRunRevision,
            idempotencyKey,
          },
        }),
      }
    },
  })
  return prepared
}
