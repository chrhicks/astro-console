import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BootstrapSnapshot,
  PlanCommandRequest,
  PlanId,
  PlanRevision,
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

const semanticActions = [
  { _tag: 'SaveDraft', sequences: plan.sequences },
  { _tag: 'AcceptRunDefinition' },
  { _tag: 'StartAcceptedRun' },
  { _tag: 'PreviewRunMutation', mutation: 'shortenSecond' },
  { _tag: 'ApplyRunMutation' },
  { _tag: 'ApproveDisruptiveRunMutation' },
] as const satisfies ReadonlyArray<PlanAction>

const everyPlanActionIsCovered = true satisfies Exclude<
  PlanAction['_tag'],
  (typeof semanticActions)[number]['_tag']
> extends never
  ? true
  : false

test('encodes every semantic Plan action once with current facts and fresh identity', async () => {
  assert.equal(everyPlanActionIsCovered, true)
  const activePlan = {
    ...plan,
    runMutationPreview: {
      previewId: 'preview-current',
      classification: 'disruptive' as const,
      consequences: 'Current mutation consequences.',
      expiresAt: '2026-08-02T20:05:00.000Z',
      approvalRequired: true,
      approvalToken: 'approval-current',
    },
    actions: {
      saveDraft: { _tag: 'Eligible' as const },
      acceptRunDefinition: { _tag: 'Eligible' as const },
      startAcceptedRun: { _tag: 'Eligible' as const },
      previewRunMutation: { _tag: 'Eligible' as const },
      applyRunMutation: { _tag: 'Eligible' as const },
      approveDisruptiveRunMutation: { _tag: 'Eligible' as const },
    },
  }
  const requests: Array<typeof PlanCommandRequest.Type> = []
  for (const action of semanticActions) {
    let writes = 0
    const result = await submit(
      current({ ...bootstrapFixtures.activeRun, plan: activePlan }),
      action,
      (body) => {
        writes += 1
        requests.push(Schema.decodeUnknownSync(PlanCommandRequest)(body))
        return Effect.succeed({
          _tag: 'Accepted',
          result: { _tag: 'DraftSaved' },
          snapshot: snapshot({
            ...bootstrapFixtures.activeRun,
            plan: activePlan,
          }),
        })
      },
    )
    assert.equal(PlanCommandSubmission.$is('Accepted')(result), true)
    assert.equal(writes, 1)
  }

  assert.deepEqual(
    requests.map(({ intent }) => intent._tag),
    semanticActions.map(({ _tag }) => _tag),
  )
  assert.equal(requests[0]?.intent._tag, 'SaveDraft')
  if (requests[0]?.intent._tag === 'SaveDraft') {
    assert.equal(requests[0].intent.expectedPlanRevision, 3)
    assert.equal('expectedLeaseRevision' in requests[0].intent, false)
    assert.equal(requests[0].intent.sequences[0]?.definition.targetName, 'M27')
  }
  assert.equal(requests[1]?.intent._tag, 'AcceptRunDefinition')
  if (requests[1]?.intent._tag === 'AcceptRunDefinition') {
    assert.equal(requests[1].intent.expectedPlanRevision, 3)
    assert.equal(requests[1].intent.expectedLeaseRevision, 4)
  }
  assert.equal(requests[2]?.intent._tag, 'StartAcceptedRun')
  if (requests[2]?.intent._tag === 'StartAcceptedRun') {
    assert.equal(requests[2].intent.expectedPlanRevision, 3)
    assert.equal(requests[2].intent.expectedLeaseRevision, 4)
  }
  assert.equal(requests[3]?.intent._tag, 'PreviewRunMutation')
  if (requests[3]?.intent._tag === 'PreviewRunMutation') {
    assert.equal(requests[3].intent.mutation, 'shortenSecond')
    assert.equal(requests[3].intent.expectedLeaseRevision, 4)
    assert.equal(requests[3].intent.expectedRunRevision, 3)
  }
  assert.equal(requests[4]?.intent._tag, 'ApplyRunMutation')
  if (requests[4]?.intent._tag === 'ApplyRunMutation') {
    assert.equal(requests[4].intent.previewId, 'preview-current')
    assert.equal(requests[4].intent.expectedLeaseRevision, 4)
    assert.equal(requests[4].intent.expectedRunRevision, 3)
  }
  assert.equal(requests[5]?.intent._tag, 'ApproveDisruptiveRunMutation')
  if (requests[5]?.intent._tag === 'ApproveDisruptiveRunMutation') {
    assert.equal(requests[5].intent.previewId, 'preview-current')
    assert.equal(requests[5].intent.approvalToken, 'approval-current')
    assert.equal(requests[5].intent.expectedLeaseRevision, 4)
    assert.equal(requests[5].intent.expectedRunRevision, 3)
  }
  const identities = requests.map(({ intent }) => intent.idempotencyKey)
  assert.equal(
    identities.every((identity) => identity.length > 0),
    true,
  )
  assert.equal(new Set(identities).size, semanticActions.length)
})

test('fails closed for missing current mutation preview facts', async () => {
  const cases = [
    {
      action: { _tag: 'ApplyRunMutation' } as const,
      plan: {
        ...plan,
        actions: {
          ...plan.actions,
          applyRunMutation: { _tag: 'Eligible' as const },
        },
      },
    },
    {
      action: { _tag: 'ApproveDisruptiveRunMutation' } as const,
      plan: {
        ...plan,
        runMutationPreview: {
          previewId: 'preview-without-approval',
          classification: 'disruptive' as const,
          consequences: 'Approval is required.',
          expiresAt: '2026-08-02T20:05:00.000Z',
          approvalRequired: true,
        },
        actions: {
          ...plan.actions,
          approveDisruptiveRunMutation: { _tag: 'Eligible' as const },
        },
      },
    },
  ]
  for (const value of cases) {
    let writes = 0
    const result = await submit(
      current({ ...bootstrapFixtures.activeRun, plan: value.plan }),
      value.action,
      () => {
        writes += 1
        return Effect.die('must not submit without current preview facts')
      },
    )
    assert.equal(PlanCommandSubmission.$is('Unavailable')(result), true)
    assert.equal(writes, 0)
  }
})

test('submits the displayed deterministic draft once without synthesizing bootstrap', async () => {
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

test('binds approval to the exact current authoritative preview', async () => {
  const active = current({
    ...bootstrapFixtures.activeRun,
    plan: {
      ...plan,
      runMutationPreview: {
        previewId: 'preview-exact',
        classification: 'disruptive',
        consequences: 'The second sequence will be shortened.',
        expiresAt: '2026-08-02T20:05:00.000Z',
        approvalRequired: true,
        approvalToken: 'approval-exact',
      },
      actions: {
        ...plan.actions,
        approveDisruptiveRunMutation: { _tag: 'Eligible' },
      },
    },
  })
  const applied = await submit(
    active,
    { _tag: 'ApproveDisruptiveRunMutation' },
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
      return yield* (yield* PlanCommandClient).submit({
        _tag: 'PreviewRunMutation',
        mutation: 'shortenSecond',
      })
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
      return yield* (yield* PlanCommandClient).submit(action)
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
