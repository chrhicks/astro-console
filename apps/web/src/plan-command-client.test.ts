import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BootstrapSnapshot,
  IdempotencyKey,
  PlanCommandRequest,
  PlanId,
  PlanRevision,
  PreviewId,
  type PlanWorkspaceProjection,
} from '@astro-console/protocol'
import { bootstrapFixtures } from './testing/bootstrap-fixtures'
import { Effect, Schema, Stream } from 'effect'
import { BootstrapClient, BootstrapClientState } from './bootstrap-client'
import {
  PlanCommandClient,
  PlanCommandSubmission,
  PlanCommandTransport,
  PlanCommandTransportFailure,
  layer,
  type PlanAction,
} from './plan-command-client'

const snapshot = (value: unknown) =>
  Schema.decodeUnknownSync(BootstrapSnapshot)(value)
const current = (value: unknown) =>
  BootstrapClientState.Current({ snapshot: snapshot(value) })
const plan: PlanWorkspaceProjection = {
  planId: PlanId.make('plan-m27'),
  revision: PlanRevision.make(3),
  readiness: 'ready',
  readinessSummary: 'Ready.',
  limitations: [],
  sequences: [
    {
      sequenceId: 'seq-1',
      window: {
        startsAt: '2026-08-02T20:00:00Z',
        endsAt: '2026-08-02T21:00:00Z',
        usableMinutes: 60,
        peakAltitudeDeg: 60,
        horizonClearanceDeg: 20,
      },
      horizon: 'clear',
      storage: 'available',
      viability: 'viable',
      definition: {
        sequenceId: 'seq-1',
        targetName: 'M27',
        acquisitionMode: 'deepSkyPlateSolve',
        rightAscensionHours: 19.9934,
        declinationDegrees: 22.7212,
        exposureSeconds: 180,
        frameCount: 24,
        binning: 1,
        minimumAltitudeDegrees: 25,
        horizonClearanceDegrees: 5,
        recenterThresholdArcsec: 30,
        maxSolveAttempts: 3,
        maxCaptureRetries: 2,
        acquireFailure: 'pause',
        captureFailure: 'retry',
        estimatedDurationSeconds: 4320,
        estimatedStorageBytes: 1_200_000_000,
        priority: 0,
      },
    },
  ],
  actions: {
    saveDraft: { _tag: 'Eligible' },
    acceptRunDefinition: { _tag: 'Eligible' },
    startAcceptedRun: {
      _tag: 'Ineligible',
      reason: 'acceptedDefinitionRequired',
    },
    previewRunMutation: { _tag: 'Ineligible', reason: 'activeRunRequired' },
    applyRunMutation: { _tag: 'Ineligible', reason: 'activeRunRequired' },
    approveDisruptiveRunMutation: {
      _tag: 'Ineligible',
      reason: 'activeRunRequired',
    },
  },
}

test('fails closed for stale, viewer, phone, and projected ineligibility without submitting', async () => {
  for (const state of [
    BootstrapClientState.Stale({
      snapshot: snapshot({ ...bootstrapFixtures.fresh, plan }),
      reason: 'stale',
    }),
    current({
      ...bootstrapFixtures.viewer,
      plan: {
        ...plan,
        actions: {
          ...plan.actions,
          saveDraft: { _tag: 'Ineligible', reason: 'ownerRequired' },
        },
      },
    }),
    current({
      ...bootstrapFixtures.phone,
      plan: {
        ...plan,
        actions: {
          ...plan.actions,
          saveDraft: { _tag: 'Ineligible', reason: 'readOnlyClient' },
        },
      },
    }),
    current({
      ...bootstrapFixtures.fresh,
      plan: {
        ...plan,
        actions: {
          ...plan.actions,
          saveDraft: { _tag: 'Ineligible', reason: 'ownerRequired' },
        },
      },
    }),
  ]) {
    let calls = 0
    const result = await submit(
      state,
      { _tag: 'SaveDraft', sequences: plan.sequences },
      () => {
        calls += 1
        return Effect.die('must not submit')
      },
    )
    assert.equal(PlanCommandSubmission.$is('Unavailable')(result), true)
    assert.equal(calls, 0)
  }
})

test('submits the displayed deterministic draft once with a fresh edge key and never synthesizes bootstrap', async () => {
  const state = current({ ...bootstrapFixtures.fresh, plan })
  let calls = 0
  let body: unknown
  const result = await submit(
    state,
    { _tag: 'SaveDraft', sequences: plan.sequences },
    (request) => {
      calls += 1
      body = request
      return Effect.succeed({
        _tag: 'Accepted',
        result: { _tag: 'DraftSaved' },
        snapshot: snapshot({ ...bootstrapFixtures.fresh, plan }),
      })
    },
  )
  assert.equal(PlanCommandSubmission.$is('Accepted')(result), true)
  assert.equal(calls, 1)
  const request = Schema.decodeUnknownSync(PlanCommandRequest)(body)
  assert.equal(request.intent._tag, 'SaveDraft')
  if (request.intent._tag === 'SaveDraft') {
    assert.equal(request.intent.sequences[0]?.definition.targetName, 'M27')
    assert.equal('target' in (request.intent.sequences[0] ?? {}), false)
  }
  assert.equal(state.snapshot.eventCursor, 40)
})

test('reports malformed responses and transport failures without retry', async () => {
  const state = current({ ...bootstrapFixtures.fresh, plan })
  for (const transport of [
    () => Effect.succeed({ _tag: 'Accepted' }),
    () => Effect.fail(new PlanCommandTransportFailure({ reason: 'offline' })),
  ]) {
    let calls = 0
    const result = await submit(
      state,
      { _tag: 'SaveDraft', sequences: plan.sequences },
      () => {
        calls += 1
        return transport()
      },
    )
    assert.equal(PlanCommandSubmission.$is('Unavailable')(result), true)
    assert.equal(calls, 1)
  }
})

test('maps a service unavailable response to reconnect recovery guidance', async () => {
  const result = await submit(
    current({ ...bootstrapFixtures.fresh, plan }),
    { _tag: 'SaveDraft', sequences: plan.sequences },
    () =>
      Effect.succeed({
        _tag: 'Unavailable',
        failure: {
          _tag: 'PlanServiceUnavailable',
          summary: 'The Plan service is recovering.',
        },
      }),
  )
  assert.equal(PlanCommandSubmission.$is('Unavailable')(result), true)
  if (PlanCommandSubmission.$is('Unavailable')(result)) {
    assert.match(result.reason, /recovering/)
    assert.match(result.safeNextAction, /Reconnect and recover/)
  }
})

test('binds approval to the exact returned preview', async () => {
  const active = current({
    ...bootstrapFixtures.activeRun,
    plan: {
      ...plan,
      actions: {
        ...plan.actions,
        previewRunMutation: { _tag: 'Eligible' },
        approveDisruptiveRunMutation: { _tag: 'Eligible' },
      },
    },
  })
  let previewId = ''
  const preview = await submit(
    active,
    { _tag: 'PreviewRunMutation', mutation: 'discardCurrent' },
    () =>
      Effect.succeed({
        _tag: 'Accepted',
        result: {
          _tag: 'RunMutationPreviewed',
          previewId: 'preview-exact',
          classification: 'disruptive',
          consequences: 'The second sequence will be shortened.',
          expiresAt: '2026-08-02T20:05:00.000Z',
          approvalRequired: true,
          approvalToken: 'approval-exact',
        },
        snapshot: active.snapshot,
      }),
  )
  assert.equal(PlanCommandSubmission.$is('Accepted')(preview), true)
  if (
    PlanCommandSubmission.$is('Accepted')(preview) &&
    preview.result._tag === 'RunMutationPreviewed'
  ) {
    previewId = preview.result.previewId
    assert.equal(preview.result.approvalToken, 'approval-exact')
    assert.equal(preview.result.expiresAt, '2026-08-02T20:05:00.000Z')
  }
  const applied = await submit(
    active,
    {
      _tag: 'ApproveDisruptiveRunMutation',
      previewId: PreviewId.make(previewId),
      approvalToken: 'approval-exact',
    },
    (body) => {
      const request = Schema.decodeUnknownSync(PlanCommandRequest)(body)
      assert.equal(request.intent._tag, 'ApproveDisruptiveRunMutation')
      if (request.intent._tag === 'ApproveDisruptiveRunMutation') {
        assert.equal(request.intent.previewId, 'preview-exact')
        assert.equal(request.intent.approvalToken, 'approval-exact')
      }
      return Effect.succeed({
        _tag: 'Accepted',
        result: { _tag: 'RunMutationApplied' },
        snapshot: active.snapshot,
      })
    },
  )
  assert.equal(PlanCommandSubmission.$is('Accepted')(applied), true)
})

test('refreshes authoritative eligibility after a preview without replacing its exact result', async () => {
  const active = current({
    ...bootstrapFixtures.activeRun,
    plan: {
      ...plan,
      actions: { ...plan.actions, previewRunMutation: { _tag: 'Eligible' } },
    },
  })
  let refreshes = 0
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* PlanCommandClient).submit(
        { _tag: 'PreviewRunMutation', mutation: 'shortenSecond' },
        IdempotencyKey.make('preview-refresh'),
      )
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(
        BootstrapClient,
        BootstrapClient.of({
          read: () => Effect.succeed(active),
          refresh: () => Effect.sync(() => void (refreshes += 1)),
          states: Stream.empty,
        }),
      ),
      Effect.provideService(
        PlanCommandTransport,
        PlanCommandTransport.of({
          submit: () =>
            Effect.succeed({
              status: 202,
              body: {
                _tag: 'Accepted',
                result: {
                  _tag: 'RunMutationPreviewed',
                  previewId: 'preview-refresh',
                  classification: 'notice',
                  consequences: 'The second sequence is shortened.',
                  expiresAt: '2026-08-02T20:05:00.000Z',
                  approvalRequired: false,
                },
                snapshot: active.snapshot,
              },
            }),
        }),
      ),
    ),
  )
  assert.equal(refreshes, 1)
  assert.equal(PlanCommandSubmission.$is('Accepted')(result), true)
  if (PlanCommandSubmission.$is('Accepted')(result))
    assert.equal(result.result._tag, 'RunMutationPreviewed')
})

async function submit(
  state:
    | ReturnType<typeof current>
    | ReturnType<typeof BootstrapClientState.Stale>,
  action: PlanAction,
  transport: (
    body: unknown,
  ) => Effect.Effect<unknown, PlanCommandTransportFailure>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* PlanCommandClient).submit(
        action,
        IdempotencyKey.make('edge-key'),
      )
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(
        BootstrapClient,
        BootstrapClient.of({
          read: () => Effect.succeed(state),
          refresh: () => Effect.void,
          states: Stream.empty,
        }),
      ),
      Effect.provideService(
        PlanCommandTransport,
        PlanCommandTransport.of({
          submit: (body) =>
            transport(body).pipe(Effect.map((body) => ({ status: 202, body }))),
        }),
      ),
    ),
  )
}
