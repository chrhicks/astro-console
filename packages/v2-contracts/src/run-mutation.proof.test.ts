import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from 'effect'
import { Command, RunMutation } from './commands.js'
import { ActorContext } from './gate.js'
import {
  ClientId,
  EventCursor,
  LeaseRevision,
  PersonId,
  PlanId,
  PlanRevision,
  RunId,
  RunRevision,
  SnapshotVersion,
} from './primitives.js'
import {
  RunMutationPreview,
  RunSequenceDefinition,
  RunWork,
  ActiveRunState,
  RunDefinition,
} from './run.js'
import {
  RunMutationProjection,
  RunPreviewResponse,
  makeRunMutationServerSimulation,
} from './run-mutation-server-simulation.js'

const owner = ActorContext.cases.Member.make({
  personId: PersonId.make('owner'),
  clientId: ClientId.make('owner-desktop'),
  role: 'owner',
  capability: 'controlCapable',
})

const controller = ActorContext.cases.Member.make({
  personId: PersonId.make('maya'),
  clientId: ClientId.make('maya-desktop'),
  role: 'viewer',
  capability: 'controlCapable',
})

const viewer = ActorContext.cases.Member.make({
  personId: PersonId.make('viewer'),
  clientId: ClientId.make('viewer-desktop'),
  role: 'viewer',
  capability: 'controlCapable',
})

const sequence = (
  sequenceId: string,
  targetName: string,
  rightAscensionHours: number,
  declinationDegrees: number,
) =>
  RunSequenceDefinition.make({
    sequenceId,
    targetName,
    acquisitionMode: 'deepSkyPlateSolve',
    rightAscensionHours,
    declinationDegrees,
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
    estimatedStorageBytes: 960000000,
    priority: 0,
  })

const m27 = sequence('m27', 'M27', 19.9934, 22.7212)
const m31 = sequence('m31', 'M31', 0.712, 41.269)
const ngc7000 = sequence('ngc7000', 'NGC 7000', 20.98, 44.33)
const sh2101 = sequence('sh2-101', 'Sh2-101', 20.3, 40.7)

const initialState = (holderClientId = controller.clientId) => ({
  definition: RunDefinition.make({
    runId: RunId.make('run-1'),
    executor: 'fake',
    sourcePlanId: PlanId.make('plan-1'),
    sourcePlanRevision: PlanRevision.make(7),
    acceptedAt: '2026-07-23T00:00:00Z',
    acceptedLimitations: [],
    executionContext: {
      rigId: 'rig-main',
      mountDeviceId: 'mount-asi',
      cameraDeviceId: 'camera-sony',
      latitudeDegrees: 39.95,
      longitudeDegrees: -75.16,
      elevationMeters: 30,
      completionBehavior: 'park',
      unsafeBehavior: 'pauseAndPark',
    },
    sequences: [m27, m31, ngc7000],
  }),
  run: ActiveRunState.make({
    runId: RunId.make('run-1'),
    revision: RunRevision.make(12),
    phase: 'capture',
    activeSequenceId: 'm27',
    futureSequenceIds: ['m31', 'ngc7000'],
    acceptedMutations: [],
    activeExposure: {
      startedAtEpochMs: 0,
      exposureSeconds: 180,
      provisionalEvidenceId: 'provisional-frame-15',
    },
  }),
  leaseRevision: LeaseRevision.make(4),
  leaseHolderClientId: holderClientId,
  snapshotVersion: SnapshotVersion.make(20),
  eventCursor: EventCursor.make(40),
  previews: [],
  receipts: [],
  results: [],
  events: [],
  outbox: [],
})

const previewCommand = (
  commandId: string,
  proposedChange: (typeof Command.cases.PreviewRunMutation.Type)['proposedChange'],
) => ({
  commandId,
  command: {
    _tag: 'PreviewRunMutation',
    runId: 'run-1',
    expectedRunRevision: 12,
    proposedChange,
  },
})

const applyCommand = (
  commandId: string,
  previewId: string,
  idempotencyKey: string,
) => ({
  commandId,
  command: {
    _tag: 'ApplyRunMutation',
    runId: 'run-1',
    expectedRunRevision: 12,
    expectedLeaseRevision: 4,
    previewId,
    idempotencyKey,
  },
})

const approveCommand = (
  commandId: string,
  previewId: string,
  approvalId: string,
  idempotencyKey: string,
) => ({
  commandId,
  command: {
    _tag: 'ApproveDisruptiveRunMutation',
    runId: 'run-1',
    expectedRunRevision: 12,
    expectedLeaseRevision: 4,
    previewId,
    approvalId,
    idempotencyKey,
  },
})

const requirePreview = (
  response: typeof RunPreviewResponse.Type,
): RunMutationPreview =>
  RunPreviewResponse.match(response, {
    Ineligible: ({ consequences }) =>
      assert.fail(`unexpected ineligible preview: ${consequences.join('; ')}`),
    Previewed: ({ preview }) => preview,
  })

describe('active-run mutation server proofs', () => {
  it('RUN-02 derives a future-only impact, allows owner preview, and requires the lease to apply once', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeRunMutationServerSimulation(
          initialState(),
          112_000,
        )
        const preview = requirePreview(
          yield* server.preview(
            previewCommand(
              'preview-append',
              Command.cases.PreviewRunMutation.fields.proposedChange.cases.AppendFutureSequence.make(
                { sequence: sh2101 },
              ),
            ),
            owner,
          ),
        )

        assert.equal(preview.impact, 'nonDisruptive')
        assert.equal(
          'impact' in
            previewCommand('inspect-command', preview.mutation).command,
          false,
        )

        const beforeRejectedApply = yield* server.readState()
        const ownerOutcome = yield* server
          .apply(
            applyCommand('apply-owner', preview.previewId, 'append-owner'),
            owner,
          )
          .pipe(
            Effect.as('applied' as const),
            Effect.catchTag('RunSimulation.CommandRejected', () =>
              Effect.succeed('rejected' as const),
            ),
          )
        assert.equal(ownerOutcome, 'rejected')
        assert.deepEqual(yield* server.readState(), beforeRejectedApply)

        const accepted = yield* server.apply(
          applyCommand(
            'apply-controller',
            preview.previewId,
            'append-controller',
          ),
          controller,
        )
        const replayed = yield* server.apply(
          applyCommand(
            'apply-controller-retry',
            preview.previewId,
            'append-controller',
          ),
          controller,
        )
        const state = yield* server.readState()

        assert.equal(accepted.replayed, false)
        assert.equal(replayed.replayed, true)
        assert.equal(replayed.resultRef, accepted.resultRef)
        assert.equal(state.run.revision, RunRevision.make(13))
        assert.equal(state.run.activeSequenceId, 'm27')
        assert.equal(
          state.run.activeExposure?.provisionalEvidenceId,
          'provisional-frame-15',
        )
        assert.deepEqual(state.run.futureSequenceIds, [
          'm31',
          'ngc7000',
          'sh2-101',
        ])
        assert.deepEqual(
          state.definition.sequences,
          initialState().definition.sequences,
        )
        assert.equal(state.run.acceptedMutations.length, 1)
        assert.equal(
          RunMutation.guards.AppendFutureSequence(
            state.run.acceptedMutations[0],
          ),
          true,
        )
        assert.equal(state.events.length, 1)
        assert.equal(state.outbox.length, 1)
        assert.equal(state.receipts.length, 1)
        assert.deepEqual(
          accepted.projection,
          RunMutationProjection.make({
            snapshotVersion: SnapshotVersion.make(21),
            eventCursor: EventCursor.make(41),
            definition: state.definition,
            run: state.run,
          }),
        )
      }),
    )
  })

  it('RUN-03 derives notice from forecast consequences before reordering only future work', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeRunMutationServerSimulation(
          initialState(),
          112_000,
        )
        const preview = requirePreview(
          yield* server.preview(
            previewCommand(
              'preview-reorder',
              Command.cases.PreviewRunMutation.fields.proposedChange.cases.ReorderFutureSequences.make(
                { sequenceIds: ['ngc7000', 'm31'] },
              ),
            ),
            owner,
          ),
        )

        assert.equal(preview.impact, 'notice')
        assert.equal(
          preview.consequences.some((consequence) =>
            consequence.includes('1620 seconds'),
          ),
          true,
        )
        assert.equal(
          preview.consequences.some((consequence) =>
            consequence.includes('14 minutes'),
          ),
          true,
        )

        yield* server.apply(
          applyCommand('apply-reorder', preview.previewId, 'reorder-1'),
          controller,
        )
        const state = yield* server.readState()
        assert.deepEqual(state.run.futureSequenceIds, ['ngc7000', 'm31'])
        assert.equal(state.run.activeSequenceId, 'm27')
        assert.equal(
          state.run.activeExposure?.provisionalEvidenceId,
          'provisional-frame-15',
        )
        assert.equal(
          RunWork.guards.RefreshFutureSchedule(state.outbox[0]),
          true,
        )
      }),
    )
  })

  it('RUN-04 binds disruptive approval to exact loss and queues stop then slew and reacquire', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeRunMutationServerSimulation(
          initialState(),
          112_000,
        )
        const preview = requirePreview(
          yield* server.preview(
            previewCommand(
              'preview-switch',
              Command.cases.PreviewRunMutation.fields.proposedChange.cases.SwitchTargetNow.make(
                { sequenceId: 'm31' },
              ),
            ),
            owner,
          ),
        )

        assert.equal(preview.impact, 'disruptive')
        assert.equal(
          preview.consequences.some((consequence) =>
            consequence.includes('112 seconds'),
          ),
          true,
        )
        assert.notEqual(preview.approvalId, undefined)
        const beforeApproval = yield* server.readState()

        const ordinaryApply = yield* server
          .apply(
            applyCommand('apply-switch', preview.previewId, 'switch-ordinary'),
            controller,
          )
          .pipe(
            Effect.as('applied' as const),
            Effect.catchTag('RunSimulation.MutationRejected', ({ reason }) =>
              Effect.succeed(reason),
            ),
          )
        assert.equal(ordinaryApply, 'RequiresApproval')
        assert.deepEqual(yield* server.readState(), beforeApproval)

        const wrongApproval = yield* server
          .approve(
            approveCommand(
              'approve-wrong',
              preview.previewId,
              'wrong',
              'switch-wrong',
            ),
            controller,
          )
          .pipe(
            Effect.as('applied' as const),
            Effect.catchTag('RunSimulation.MutationRejected', ({ reason }) =>
              Effect.succeed(reason),
            ),
          )
        assert.equal(wrongApproval, 'ApprovalMismatch')
        assert.deepEqual(yield* server.readState(), beforeApproval)

        yield* server.approve(
          approveCommand(
            'approve-switch',
            preview.previewId,
            preview.approvalId ?? 'missing',
            'switch-approved',
          ),
          controller,
        )
        const state = yield* server.readState()
        assert.equal(state.run.activeSequenceId, 'm31')
        assert.equal(state.run.activeExposure, undefined)
        assert.equal(state.run.revision, RunRevision.make(13))
        assert.deepEqual(
          state.outbox.map((work) => work._tag),
          ['StopActiveExposure', 'SlewAndAcquire'],
        )
        assert.equal(state.events[0]?.event._tag, 'RunMutationApplied')
      }),
    )
  })

  it('RUN-05 rejects impossible and unauthorized proposals without partial state', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeRunMutationServerSimulation(
          initialState(),
          112_000,
        )
        const before = yield* server.readState()
        const impossible = yield* server.preview(
          previewCommand(
            'preview-impossible',
            Command.cases.PreviewRunMutation.fields.proposedChange.cases.SwitchTargetNow.make(
              { sequenceId: 'not-queued' },
            ),
          ),
          owner,
        )
        RunPreviewResponse.match(impossible, {
          Previewed: () =>
            assert.fail(
              'impossible switch must not produce an eligible preview',
            ),
          Ineligible: ({ consequences }) =>
            assert.equal(consequences[0]?.includes('not queued'), true),
        })
        assert.deepEqual(yield* server.readState(), before)

        const unauthorized = yield* server
          .preview(
            previewCommand(
              'preview-viewer',
              Command.cases.PreviewRunMutation.fields.proposedChange.cases.AppendFutureSequence.make(
                { sequence: sh2101 },
              ),
            ),
            viewer,
          )
          .pipe(
            Effect.as('previewed' as const),
            Effect.catchTag('RunSimulation.CommandRejected', () =>
              Effect.succeed('rejected' as const),
            ),
          )
        assert.equal(unauthorized, 'rejected')
        assert.deepEqual(yield* server.readState(), before)
      }),
    )
  })

  it('RUN-06 serializes concurrent revision-12 applies and leaves no evidence or work for the loser', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeRunMutationServerSimulation(
          initialState(),
          112_000,
        )
        const appendPreview = requirePreview(
          yield* server.preview(
            previewCommand(
              'preview-concurrent-append',
              Command.cases.PreviewRunMutation.fields.proposedChange.cases.AppendFutureSequence.make(
                { sequence: sh2101 },
              ),
            ),
            owner,
          ),
        )
        const reorderPreview = requirePreview(
          yield* server.preview(
            previewCommand(
              'preview-concurrent-reorder',
              Command.cases.PreviewRunMutation.fields.proposedChange.cases.ReorderFutureSequences.make(
                { sequenceIds: ['ngc7000', 'm31'] },
              ),
            ),
            owner,
          ),
        )
        const apply = (request: unknown) =>
          server.apply(request, controller).pipe(
            Effect.as('applied' as const),
            Effect.catchTag('RunSimulation.CommandRejected', () =>
              Effect.succeed('rejected' as const),
            ),
          )

        const outcomes = yield* Effect.all(
          [
            apply(
              applyCommand(
                'apply-concurrent-append',
                appendPreview.previewId,
                'concurrent-append',
              ),
            ),
            apply(
              applyCommand(
                'apply-concurrent-reorder',
                reorderPreview.previewId,
                'concurrent-reorder',
              ),
            ),
          ],
          { concurrency: 'unbounded' },
        )
        const state = yield* server.readState()

        assert.deepEqual([...outcomes].sort(), ['applied', 'rejected'])
        assert.equal(state.run.revision, RunRevision.make(13))
        assert.equal(state.events.length, 1)
        assert.equal(state.receipts.length, 1)
        assert.equal(state.results.length, 1)
        assert.equal(state.outbox.length, 1)
      }),
    )
  })
})
