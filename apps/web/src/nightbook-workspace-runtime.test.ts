import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AcquireIntent,
  AssetRevision,
  BootstrapSnapshot,
  CaptureSetId,
  CommandId,
  LibraryAssetDetail,
  LibraryPage,
  LibraryQuery,
  LibraryQueryId,
  ObserveCommandRequest,
  OpenedProcessingProject,
  PlanCommandRequest,
  PlanId,
  PlanRevision,
  ProcessingProjectEvidence,
  ProcessingProjectId,
  ProcessingProjectRevision,
} from '@astro-console/protocol'
import {
  Deferred,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Schema,
  Stream,
} from 'effect'
import { BootstrapClient, BootstrapClientState } from './bootstrap-client'
import {
  AcquireAction,
  NightbookWorkspaceRemote,
  NightbookWorkspaceRemoteFailure,
  NightbookWorkspaceIntent,
  NightbookWorkspaceRuntime,
  nightbookWorkspaceRuntimeLayer,
  type NightbookWorkspaceRemoteShape,
  type NightbookWorkspaceState,
  type ProcessingProjectList,
} from './nightbook-workspace-runtime'
import { bootstrapFixtures } from './testing/bootstrap-fixtures'
import { CommandSubmission, ControlAction } from './command-client'
import {
  ObserveCommandClient,
  ObserveCommandSubmission,
  ObserveCommandTransport,
  ObserveCommandTransportFailure,
  layer as observeCommandClientLayer,
  type ObserveAction,
} from './observe-command-client'
import {
  PlanCommandClient,
  PlanCommandSubmission,
  PlanCommandTransport,
  PlanCommandTransportFailure,
  layer as planCommandClientLayer,
} from './plan-command-client'
import type { CreateProcessingProjectRequest } from './process-client'

const query = (id: string) =>
  LibraryQuery.make({
    queryId: LibraryQueryId.make(id),
    pageSize: 40,
    sort: 'capturedAtDescending',
  })

const page = (id: string, version: number) =>
  Schema.decodeUnknownSync(LibraryPage)({
    queryId: id,
    querySnapshotVersion: version,
    results: [],
    catalogChanged: false,
  })

const assetDetail = (assetId: string) =>
  Schema.decodeUnknownSync(LibraryAssetDetail)({
    assetId,
    revision: 1,
    role: 'original',
    format: 'fits',
    availability: 'availableLocally',
    capturedAt: '2026-08-11T00:00:00.000Z',
    comparisonGroupId: 'group-1',
    lineage: { sourceAssetIds: [] },
    representations: [],
    actions: [],
  })

const detail = assetDetail('asset-1')

const projects = (id: string): ProcessingProjectList => [
  {
    projectId: ProcessingProjectId.make(id),
    revision: ProcessingProjectRevision.make(1),
    name: id,
    sourceCount: 1,
    state: 'Ready',
    updatedAt: '2026-08-11T00:00:00.000Z',
  },
]

const processingStages = [
  {
    stage: 'Calibration',
    draft: {
      revision: 0,
      value: { _tag: 'Calibration', settings: [], overrides: [] },
      canUndo: false,
      canRedo: false,
    },
  },
  {
    stage: 'Registration',
    draft: {
      revision: 0,
      value: { _tag: 'Registration', settings: [], inclusions: [] },
      canUndo: false,
      canRedo: false,
    },
  },
  {
    stage: 'Stacking',
    draft: {
      revision: 0,
      value: { _tag: 'Stacking', settings: [], frameChoices: [] },
      canUndo: false,
      canRedo: false,
    },
  },
  {
    stage: 'Develop',
    draft: {
      revision: 0,
      value: {
        _tag: 'Develop',
        operation: { _tag: 'Stretch', method: 'asinh', amount: 0.35 },
      },
      canUndo: false,
      canRedo: false,
    },
  },
].map((stage) => ({
  ...stage,
  resultHistory: { canUndo: false, canRedo: false },
  run: { _tag: 'Unavailable', reason: 'CurrentUpstreamResultRequired' },
}))

const openedProject = (revision: number) =>
  Schema.decodeUnknownSync(OpenedProcessingProject)({
    projectId: 'project-1',
    revision,
    name: 'M27',
    authority: { _tag: 'Allowed' },
    sources: [],
    warnings: [],
    stages: processingStages,
    savedAssetIds: [],
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: `2026-08-11T00:00:0${revision}.000Z`,
  })

const projectEvidence = () =>
  Schema.decodeUnknownSync(ProcessingProjectEvidence)({
    projectId: 'project-1',
    attempts: [],
  })

const failure = (operation: NightbookWorkspaceRemoteFailure['operation']) =>
  new NightbookWorkspaceRemoteFailure({
    operation,
    reason: 'unavailable',
    message: `${operation} unavailable`,
  })

const makeRemote = (
  overrides: Partial<NightbookWorkspaceRemoteShape>,
): NightbookWorkspaceRemoteShape => ({
  states: Stream.empty,
  refresh: () => Effect.void,
  acquire: () => Effect.die('not used'),
  control: () => Effect.die('not used'),
  plan: () => Effect.die('not used'),
  observe: () => Effect.die('not used'),
  refreshPreflight: () => Effect.die('not used'),
  page: () => Effect.die('not used'),
  detail: () => Effect.die('not used'),
  processSource: () => Effect.die('not used'),
  review: () => Effect.die('not used'),
  listProjects: () => Effect.die('not used'),
  openProject: () => Effect.die('not used'),
  projectEvidence: () => Effect.die('not used'),
  createProject: () => Effect.die('not used'),
  changeProject: () => Effect.die('not used'),
  addProjectSources: () => Effect.die('not used'),
  ...overrides,
})

const makeRuntime = (remote: NightbookWorkspaceRemoteShape) =>
  ManagedRuntime.make(
    nightbookWorkspaceRuntimeLayer.pipe(
      Layer.provide(
        Layer.succeed(
          NightbookWorkspaceRemote,
          NightbookWorkspaceRemote.of(remote),
        ),
      ),
    ),
  )

const makeComposedPlanRuntime = (
  state: BootstrapClientState,
  transport: (
    body: unknown,
  ) => Effect.Effect<
    { readonly status: number; readonly body: unknown },
    PlanCommandTransportFailure
  >,
) => {
  const bootstrap = BootstrapClient.of({
    read: () => Effect.succeed(state),
    refresh: () => Effect.void,
    states: Stream.make(state),
  })
  const bootstrapLayer = Layer.succeed(BootstrapClient, bootstrap)
  const planLayer = planCommandClientLayer.pipe(
    Layer.provide(bootstrapLayer),
    Layer.provide(
      Layer.succeed(
        PlanCommandTransport,
        PlanCommandTransport.of({ submit: transport }),
      ),
    ),
  )
  const remoteLayer = Layer.effect(
    NightbookWorkspaceRemote,
    Effect.gen(function* () {
      const plan = yield* PlanCommandClient
      return NightbookWorkspaceRemote.of(
        makeRemote({
          states: bootstrap.states,
          refresh: bootstrap.refresh,
          plan: plan.submit,
        }),
      )
    }),
  ).pipe(Layer.provide(planLayer))
  return ManagedRuntime.make(
    nightbookWorkspaceRuntimeLayer.pipe(Layer.provide(remoteLayer)),
  )
}

const makeComposedObserveRuntime = (
  state: BootstrapClientState,
  transport: (
    body: unknown,
  ) => Effect.Effect<
    { readonly body: unknown },
    ObserveCommandTransportFailure
  >,
) => {
  const bootstrap = BootstrapClient.of({
    read: () => Effect.succeed(state),
    refresh: () => Effect.void,
    states: Stream.make(state),
  })
  const bootstrapLayer = Layer.succeed(BootstrapClient, bootstrap)
  const observeLayer = observeCommandClientLayer.pipe(
    Layer.provide(bootstrapLayer),
    Layer.provide(
      Layer.succeed(
        ObserveCommandTransport,
        ObserveCommandTransport.of({ submit: transport }),
      ),
    ),
  )
  const remoteLayer = Layer.effect(
    NightbookWorkspaceRemote,
    Effect.gen(function* () {
      const observe = yield* ObserveCommandClient
      return NightbookWorkspaceRemote.of(
        makeRemote({
          states: bootstrap.states,
          refresh: bootstrap.refresh,
          observe: observe.submit,
        }),
      )
    }),
  ).pipe(Layer.provide(observeLayer))
  return ManagedRuntime.make(
    nightbookWorkspaceRuntimeLayer.pipe(Layer.provide(remoteLayer)),
  )
}

const submit = (
  runtime: ReturnType<typeof makeRuntime>,
  intent: NightbookWorkspaceIntent,
) =>
  runtime.runPromise(
    Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
      workspace.submit(intent),
    ),
  )

const waitFor = (
  runtime: ReturnType<typeof makeRuntime>,
  predicate: (state: NightbookWorkspaceState) => boolean,
) =>
  runtime.runPromise(
    Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
      workspace.states.pipe(
        Stream.filter(predicate),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      ),
    ),
  )

test('submits each semantic Shared Control action once without changing projected lease truth', async () => {
  const bootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...bootstrapFixtures.noRun,
      control: {
        revision: 7,
        state: 'held',
        holderClientId: 'desktop-other',
        pendingRequests: [
          {
            requestId: 'request-1',
            personId: 'member-person',
            clientId: 'desktop-member',
            expiresAt: '2026-08-02T20:05:00Z',
          },
        ],
      },
    }),
  })
  const actions = [
    ControlAction.RequestControl({}),
    ControlAction.ReleaseControl({}),
    ControlAction.GrantControl({
      requestId: 'request-1',
      targetClientId: 'desktop-member',
    }),
    ControlAction.DeclineControl({ requestId: 'request-1' }),
    ControlAction.TakeControl({}),
  ]
  const submitted: ControlAction[] = []
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(bootstrap),
      control: (action) =>
        Effect.sync(() => submitted.push(action)).pipe(
          Effect.as(
            CommandSubmission.Accepted({
              snapshot: bootstrap.snapshot,
              current: bootstrap,
              safeNextAction: 'Await authoritative projection.',
            }),
          ),
        ),
    }),
  )

  for (const action of actions) {
    const result = await submit(runtime, { _tag: 'Control', action })
    assert.equal(result._tag, 'Control')
  }

  assert.deepEqual(submitted, actions)
  const state = await waitFor(runtime, (value) => value.projectionReceived)
  assert.equal(state.projection.shell.control.revision, 7)
  assert.equal(state.projection.shell.control.state, 'held')
  await runtime.dispose()
})

test('preserves rejected and unavailable Shared Control outcomes without replay', async () => {
  const bootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
      bootstrapFixtures.noRun,
    ),
  })
  const outcomes = [
    CommandSubmission.Rejected({
      failure: {
        _tag: 'AuthorizationFailure',
        commandId: CommandId.make('control-command'),
        summary: 'Control was lost.',
        retryable: false,
        refreshFromSnapshot: true,
        safeAlternatives: ['Read current control truth.'],
        reason: 'ControlLeaseLost',
      },
      current: bootstrap,
      safeNextAction: 'Read current control truth.',
    }),
    CommandSubmission.Unavailable({
      current: bootstrap,
      reason: 'The command response was unavailable.',
      safeNextAction: 'Wait for current control truth.',
    }),
  ]

  for (const outcome of outcomes) {
    let calls = 0
    const runtime = makeRuntime(
      makeRemote({
        states: Stream.make(bootstrap),
        control: () =>
          Effect.sync(() => {
            calls += 1
            return outcome
          }),
      }),
    )
    const result = await submit(runtime, {
      _tag: 'Control',
      action: ControlAction.TakeControl({}),
    })
    assert.equal(result._tag, 'Control')
    if (result._tag === 'Control') assert.equal(result.result, outcome)
    assert.equal(calls, 1)
    await runtime.dispose()
  }
})

test('composes semantic Plan acceptance with current revisions and one write without optimistic state', async () => {
  const bootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...bootstrapFixtures.fresh,
      control: { revision: 23, state: 'held', holderClientId: 'desktop-owner' },
      plan: {
        planId: PlanId.make('plan-composed'),
        revision: PlanRevision.make(17),
        readiness: 'ready',
        readinessSummary: 'Ready.',
        limitations: [],
        sequences: [
          {
            sequenceId: 'seq-composed',
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
              sequenceId: 'seq-composed',
              targetName: 'M27',
              acquisitionMode: 'cameraOnly',
              rightAscensionHours: 19.9934,
              declinationDegrees: 22.7212,
              exposureSeconds: 15,
              frameCount: 1,
              binning: 1,
              minimumAltitudeDegrees: 25,
              horizonClearanceDegrees: 5,
              recenterThresholdArcsec: 30,
              maxSolveAttempts: 3,
              maxCaptureRetries: 2,
              acquireFailure: 'pause',
              captureFailure: 'retry',
              estimatedDurationSeconds: 15,
              estimatedStorageBytes: 1000,
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
          previewRunMutation: {
            _tag: 'Ineligible',
            reason: 'activeRunRequired',
          },
          applyRunMutation: {
            _tag: 'Ineligible',
            reason: 'activeRunRequired',
          },
          approveDisruptiveRunMutation: {
            _tag: 'Ineligible',
            reason: 'activeRunRequired',
          },
        },
      },
    }),
  })
  const requests: Array<typeof PlanCommandRequest.Type> = []
  const runtime = makeComposedPlanRuntime(bootstrap, (body) => {
    requests.push(Schema.decodeUnknownSync(PlanCommandRequest)(body))
    return Effect.succeed({
      status: 202,
      body: {
        _tag: 'Accepted',
        result: { _tag: 'RunDefinitionAccepted' },
        snapshot: bootstrap.snapshot,
      },
    })
  })
  const before = await waitFor(runtime, (state) => state.projectionReceived)

  const result = await submit(runtime, {
    _tag: 'Plan',
    action: { _tag: 'AcceptRunDefinition' },
  })
  const after = await waitFor(runtime, (state) => state.projectionReceived)
  await runtime.dispose()

  assert.equal(result._tag, 'Plan')
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.intent._tag, 'AcceptRunDefinition')
  if (requests[0]?.intent._tag === 'AcceptRunDefinition') {
    assert.equal(requests[0].intent.expectedPlanRevision, 17)
    assert.equal(requests[0].intent.expectedLeaseRevision, 23)
    assert.ok(requests[0].intent.idempotencyKey.length > 0)
  }
  assert.deepEqual(after.projection.plan, before.projection.plan)
})

test('stops an incomplete semantic Plan action before transport at the public runtime seam', async () => {
  const bootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...bootstrapFixtures.activeRun,
      plan: {
        planId: 'plan-incomplete',
        revision: 7,
        readiness: 'ready',
        readinessSummary: 'Ready.',
        limitations: [],
        sequences: [
          {
            sequenceId: 'seq-incomplete',
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
              sequenceId: 'seq-incomplete',
              targetName: 'M27',
              acquisitionMode: 'cameraOnly',
              rightAscensionHours: 19.9934,
              declinationDegrees: 22.7212,
              exposureSeconds: 15,
              frameCount: 1,
              binning: 1,
              minimumAltitudeDegrees: 25,
              horizonClearanceDegrees: 5,
              recenterThresholdArcsec: 30,
              maxSolveAttempts: 3,
              maxCaptureRetries: 2,
              acquireFailure: 'pause',
              captureFailure: 'retry',
              estimatedDurationSeconds: 15,
              estimatedStorageBytes: 1000,
              priority: 0,
            },
          },
        ],
        actions: {
          saveDraft: { _tag: 'Eligible' },
          acceptRunDefinition: { _tag: 'Eligible' },
          startAcceptedRun: { _tag: 'Eligible' },
          previewRunMutation: { _tag: 'Eligible' },
          applyRunMutation: { _tag: 'Eligible' },
          approveDisruptiveRunMutation: { _tag: 'Eligible' },
        },
      },
    }),
  })
  let writes = 0
  const runtime = makeComposedPlanRuntime(bootstrap, () => {
    writes += 1
    return Effect.die('must not submit without current preview facts')
  })
  await waitFor(runtime, (state) => state.projectionReceived)

  const result = await submit(runtime, {
    _tag: 'Plan',
    action: { _tag: 'ApplyRunMutation' },
  })
  await runtime.dispose()

  assert.equal(result._tag, 'Plan')
  if (result._tag === 'Plan')
    assert.equal(PlanCommandSubmission.$is('Unavailable')(result.result), true)
  assert.equal(writes, 0)
})

test('submits every semantic Observe lifecycle action without changing projected truth', async () => {
  const bootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...bootstrapFixtures.activeRun,
      control: { revision: 9, state: 'held', holderClientId: 'desktop-owner' },
      observe: {
        runId: 'run-observe-semantic',
        revision: 6,
        executor: 'fixture',
        phase: 'capture',
        target: 'M27',
        currentSequence: 0,
        completedSequences: 0,
        totalSequences: 1,
        retryUsed: false,
        lifecycleFacts: ['Observe lifecycle is current.'],
        attemptFacts: ['No command result is assumed.'],
        actions: {
          pause: { _tag: 'Eligible' },
          resume: { _tag: 'Eligible' },
          stop: { _tag: 'Eligible' },
          skip: { _tag: 'Eligible' },
          retry: { _tag: 'Eligible' },
          park: { _tag: 'Eligible' },
        },
      },
    }),
  })
  const submitted: ObserveAction[] = []
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(bootstrap),
      observe: (action) =>
        Effect.sync(() => submitted.push(action)).pipe(
          Effect.as(
            ObserveCommandSubmission.Accepted({
              message: 'Action accepted. Await current lifecycle evidence.',
            }),
          ),
        ),
    }),
  )
  const before = await waitFor(runtime, (state) => state.projectionReceived)

  const actions: ObserveAction[] = [
    'PauseRun',
    'ResumeRun',
    'StopRun',
    'SkipSequence',
    'RetryPhase',
    'RequestPark',
  ]
  for (const action of actions) {
    const result = await submit(runtime, { _tag: 'Observe', action })
    assert.equal(result._tag, 'Observe')
  }
  const after = await waitFor(runtime, (state) => state.projectionReceived)
  await runtime.dispose()

  assert.deepEqual(submitted, actions)
  assert.deepEqual(after.projection.observe, before.projection.observe)
})

test('composes semantic Pause through the runtime and real Observe command client once without optimistic state', async () => {
  const bootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...bootstrapFixtures.activeRun,
      control: { revision: 23, state: 'held', holderClientId: 'desktop-owner' },
      observe: {
        runId: 'run-observe-composed',
        revision: 17,
        executor: 'fixture',
        phase: 'capture',
        target: 'M27',
        currentSequence: 0,
        completedSequences: 0,
        totalSequences: 1,
        retryUsed: false,
        lifecycleFacts: ['Observe lifecycle is current.'],
        attemptFacts: ['No command result is assumed.'],
        actions: {
          pause: { _tag: 'Eligible' },
          resume: { _tag: 'Ineligible', reason: 'pausedRunRequired' },
          stop: { _tag: 'Eligible' },
          skip: { _tag: 'Eligible' },
          retry: { _tag: 'Eligible' },
          park: { _tag: 'Eligible' },
        },
      },
    }),
  })
  const requests: Array<typeof ObserveCommandRequest.Type> = []
  const runtime = makeComposedObserveRuntime(bootstrap, (body) => {
    requests.push(Schema.decodeUnknownSync(ObserveCommandRequest)(body))
    return Effect.succeed({
      body: { _tag: 'Accepted', result: { _tag: 'PauseAccepted' } },
    })
  })
  const before = await waitFor(runtime, (state) => state.projectionReceived)

  const result = await submit(runtime, {
    _tag: 'Observe',
    action: 'PauseRun',
  })
  const after = await waitFor(runtime, (state) => state.projectionReceived)
  await runtime.dispose()

  assert.equal(result._tag, 'Observe')
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.intent._tag, 'PauseRun')
  assert.equal(requests[0]?.intent.expectedLeaseRevision, 23)
  assert.equal(requests[0]?.intent.expectedRunRevision, 17)
  assert.ok((requests[0]?.intent.idempotencyKey.length ?? 0) > 0)
  assert.deepEqual(after.projection.observe, before.projection.observe)
})

test('stops an ineligible semantic Observe action before transport at the public runtime seam', async () => {
  const bootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...bootstrapFixtures.activeRun,
      observe: {
        runId: 'run-observe-ineligible',
        revision: 17,
        executor: 'fixture',
        phase: 'capture',
        target: 'M27',
        currentSequence: 0,
        completedSequences: 0,
        totalSequences: 1,
        retryUsed: false,
        lifecycleFacts: ['Observe lifecycle is current.'],
        attemptFacts: ['No command result is assumed.'],
        actions: {
          pause: { _tag: 'Eligible' },
          resume: { _tag: 'Ineligible', reason: 'pausedRunRequired' },
          stop: { _tag: 'Eligible' },
          skip: { _tag: 'Eligible' },
          retry: { _tag: 'Eligible' },
          park: { _tag: 'Eligible' },
        },
      },
    }),
  })
  let writes = 0
  const runtime = makeComposedObserveRuntime(bootstrap, () => {
    writes += 1
    return Effect.die('must not submit an ineligible Observe action')
  })
  await waitFor(runtime, (state) => state.projectionReceived)

  const result = await submit(runtime, {
    _tag: 'Observe',
    action: 'ResumeRun',
  })
  await runtime.dispose()

  assert.equal(result._tag, 'Observe')
  if (result._tag === 'Observe')
    assert.equal(
      ObserveCommandSubmission.$is('Unavailable')(result.result),
      true,
    )
  assert.equal(writes, 0)
})

test('preserves rejected and unavailable Observe outcomes without replay', async () => {
  const bootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...bootstrapFixtures.activeRun,
      observe: {
        runId: 'run-observe-outcome',
        revision: 4,
        executor: 'fixture',
        phase: 'capture',
        target: 'M27',
        currentSequence: 0,
        completedSequences: 0,
        totalSequences: 1,
        retryUsed: false,
        lifecycleFacts: ['Observe lifecycle is current.'],
        attemptFacts: ['No command result is assumed.'],
        actions: {
          pause: { _tag: 'Eligible' },
          resume: { _tag: 'Ineligible', reason: 'pausedRunRequired' },
          stop: { _tag: 'Eligible' },
          skip: { _tag: 'Eligible' },
          retry: { _tag: 'Eligible' },
          park: { _tag: 'Eligible' },
        },
      },
    }),
  })
  const outcomes = [
    ObserveCommandSubmission.Rejected({
      reason: 'The run is terminal.',
      safeNextAction: 'Read current Observe truth.',
    }),
    ObserveCommandSubmission.Unavailable({
      reason: 'Observe is unavailable.',
      safeNextAction: 'Wait for current Observe truth.',
    }),
  ]

  for (const outcome of outcomes) {
    let calls = 0
    const runtime = makeRuntime(
      makeRemote({
        states: Stream.make(bootstrap),
        observe: () =>
          Effect.sync(() => {
            calls += 1
            return outcome
          }),
      }),
    )
    const result = await submit(runtime, {
      _tag: 'Observe',
      action: 'StopRun',
    })
    assert.equal(result._tag, 'Observe')
    if (result._tag === 'Observe') assert.equal(result.result, outcome)
    assert.equal(calls, 1)
    await runtime.dispose()
  }
})

const currentAcquireSnapshot = () =>
  BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...bootstrapFixtures.activeRun,
      control: { revision: 11, state: 'held', holderClientId: 'desktop-owner' },
      observe: {
        runId: 'run-semantic-acquire',
        revision: 7,
        executor: 'fixture',
        phase: 'acquire',
        target: 'M27',
        currentSequence: 0,
        completedSequences: 0,
        totalSequences: 1,
        retryUsed: false,
        acquire: {
          revision: 3,
          mode: 'pointing',
          acquisitionMethod: 'deepSkyPlateSolve',
          phase: 'solving',
          recoverySeries: 0,
          attemptCount: 0,
          correctionAttemptsRemaining: 3,
          activeAttemptId: 'target-solve-1',
          attention: 'Capture and plate-solve a fresh target frame.',
          pendingProposal: {
            proposalId: 'proposal-42',
            correction: {
              rightAscensionArcsec: 4,
              declinationArcsec: -2,
              convention: 'mountRaDec',
            },
            expiresAtEpochMs: 1_800_000_000_000,
          },
          actions: [
            {
              _tag: 'Available',
              action: 'CaptureTargetAcquisitionEvidence',
            },
            {
              _tag: 'Available',
              action: 'RetryPlateSolveWithParameters',
            },
            { _tag: 'Available', action: 'SkipAcquireTarget' },
            { _tag: 'Available', action: 'AbortAcquire' },
            { _tag: 'Available', action: 'ApprovePointingCorrection' },
          ],
        },
        lifecycleFacts: ['Target acquisition is current.'],
        attemptFacts: ['No evidence recorded yet.'],
        actions: {
          pause: { _tag: 'Ineligible', reason: 'policyUnavailable' },
          resume: { _tag: 'Ineligible', reason: 'policyUnavailable' },
          stop: { _tag: 'Eligible' },
          skip: { _tag: 'Ineligible', reason: 'policyUnavailable' },
          retry: { _tag: 'Ineligible', reason: 'policyUnavailable' },
          park: { _tag: 'Eligible' },
        },
      },
    }),
  })

test('constructs closed Acquire and branded resource intents', () => {
  const acquire = NightbookWorkspaceIntent.Acquire({
    action: AcquireAction.AbortAcquire({}),
  })
  const comparison = NightbookWorkspaceIntent.SelectComparisonAsset({
    assetId: detail.assetId,
  })
  const intake = NightbookWorkspaceIntent.AddProjectSources({
    projectId: ProcessingProjectId.make('project-typed'),
    expectedProjectRevision: ProcessingProjectRevision.make(1),
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })

  assert.equal(acquire.action._tag, 'AbortAcquire')
  assert.equal(comparison.assetId, detail.assetId)
  assert.equal(intake.projectId, 'project-typed')
})

test('constructs current Capture intent once without optimistic Acquire state', async () => {
  const bootstrap = currentAcquireSnapshot()
  const submitted: Array<typeof AcquireIntent.Type> = []
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(bootstrap),
      acquire: (intent) => Effect.sync(() => submitted.push(intent)),
    }),
  )
  const before = await waitFor(runtime, (state) => state.projectionReceived)

  const result = await submit(runtime, {
    _tag: 'Acquire',
    action: AcquireAction.CaptureTargetAcquisitionEvidence({}),
  })
  const after = await waitFor(runtime, (state) => state.projectionReceived)
  await runtime.dispose()

  assert.equal(result._tag, 'Acquire')
  assert.equal(submitted.length, 1)
  assert.equal(submitted[0]?._tag, 'CaptureTargetAcquisitionEvidence')
  assert.equal(submitted[0]?.expectedLeaseRevision, 11)
  assert.equal(submitted[0]?.expectedRunRevision, 7)
  assert.equal(submitted[0]?.expectedAcquireRevision, 3)
  assert.ok((submitted[0]?.idempotencyKey.length ?? 0) > 0)
  assert.deepEqual(
    after.projection.observe.source?.acquire,
    before.projection.observe.source?.acquire,
  )
})

test('maps every semantic Acquire action with current revisions and fixed retry parameters', async () => {
  const bootstrap = currentAcquireSnapshot()
  const submitted: Array<typeof AcquireIntent.Type> = []
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(bootstrap),
      acquire: (intent) => Effect.sync(() => submitted.push(intent)),
    }),
  )
  await waitFor(runtime, (state) => state.projectionReceived)
  const actions = [
    AcquireAction.RetryPlateSolveWithParameters({}),
    AcquireAction.SkipAcquireTarget({}),
    AcquireAction.AbortAcquire({}),
    AcquireAction.ApprovePointingCorrection({ proposalId: 'proposal-42' }),
  ]

  for (const action of actions)
    await submit(runtime, { _tag: 'Acquire', action })
  await runtime.dispose()

  assert.deepEqual(
    submitted.map((intent) => intent._tag),
    [
      'RetryPlateSolveWithParameters',
      'SkipAcquireTarget',
      'AbortAcquire',
      'ApprovePointingCorrection',
    ],
  )
  for (const intent of submitted) {
    assert.equal(intent.expectedLeaseRevision, 11)
    assert.equal(intent.expectedRunRevision, 7)
    assert.equal(intent.expectedAcquireRevision, 3)
    assert.ok(intent.idempotencyKey.length > 0)
  }
  const retry = submitted[0]
  assert.equal(retry?._tag, 'RetryPlateSolveWithParameters')
  if (retry?._tag === 'RetryPlateSolveWithParameters')
    assert.deepEqual(retry.parameters, {
      exposureSeconds: 15,
      binning: 1,
      solverProfile: 'deep-sky-plate-solve',
    })
  const approval = submitted[3]
  assert.equal(approval?._tag, 'ApprovePointingCorrection')
  if (approval?._tag === 'ApprovePointingCorrection')
    assert.equal(approval.proposalId, 'proposal-42')
  assert.equal(
    new Set(submitted.map((intent) => intent.idempotencyKey)).size,
    4,
  )
})

test('fails semantic Acquire before transport for missing, stale, and unavailable state', async () => {
  const states = [
    BootstrapClientState.Current({
      snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
        bootstrapFixtures.noRun,
      ),
    }),
    BootstrapClientState.Stale({
      snapshot: currentAcquireSnapshot().snapshot,
      reason: 'Disconnected.',
    }),
    BootstrapClientState.Unavailable({ reason: 'Bootstrap unavailable.' }),
  ]

  for (const state of states) {
    let submissions = 0
    let refreshes = 0
    const runtime = makeRuntime(
      makeRemote({
        states: Stream.make(state),
        acquire: () => Effect.sync(() => void (submissions += 1)),
        refresh: () => Effect.sync(() => void (refreshes += 1)),
      }),
    )
    await waitFor(runtime, (current) => current.projectionReceived)

    const result = await submit(runtime, {
      _tag: 'Acquire',
      action: AcquireAction.AbortAcquire({}),
    })
    await runtime.dispose()

    assert.equal(result._tag, 'Acquire')
    if (result._tag === 'Acquire') assert.equal(result.accepted, false)
    assert.equal(submissions, 0)
    assert.equal(refreshes, 0)
  }
})

test('rejects unavailable Acquire actions and stale correction proposals before transport', async () => {
  let submissions = 0
  const bootstrap = currentAcquireSnapshot()
  const snapshot = Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrap.snapshot,
    observe: {
      ...bootstrap.snapshot.observe,
      acquire: {
        ...bootstrap.snapshot.observe?.acquire,
        actions: [{ _tag: 'Available', action: 'ApprovePointingCorrection' }],
      },
    },
  })
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(BootstrapClientState.Current({ snapshot })),
      acquire: () => Effect.sync(() => void (submissions += 1)),
    }),
  )
  await waitFor(runtime, (state) => state.projectionReceived)

  const unavailable = await submit(runtime, {
    _tag: 'Acquire',
    action: AcquireAction.AbortAcquire({}),
  })
  const staleProposal = await submit(runtime, {
    _tag: 'Acquire',
    action: AcquireAction.ApprovePointingCorrection({ proposalId: 'old' }),
  })
  await runtime.dispose()

  assert.equal(unavailable._tag, 'Acquire')
  if (unavailable._tag === 'Acquire') assert.equal(unavailable.accepted, false)
  assert.equal(staleProposal._tag, 'Acquire')
  if (staleProposal._tag === 'Acquire')
    assert.equal(staleProposal.accepted, false)
  assert.equal(submissions, 0)
})

test('reconciles an uncertain Acquire outcome once without replaying it', async () => {
  let submissions = 0
  let refreshes = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentAcquireSnapshot()),
      refresh: () => Effect.sync(() => void (refreshes += 1)),
      acquire: () =>
        Effect.sync(() => void (submissions += 1)).pipe(
          Effect.andThen(Effect.fail(failure('acquire'))),
        ),
    }),
  )

  await waitFor(runtime, (state) => state.projectionReceived)
  const result = await submit(runtime, {
    _tag: 'Acquire',
    action: AcquireAction.AbortAcquire({}),
  })
  await runtime.dispose()

  assert.equal(result._tag, 'Acquire')
  assert.equal(submissions, 1)
  assert.equal(refreshes, 1)
})

test('cancels replaced and disposed Library and Process loads and ignores late results', async () => {
  const pageStarted = Effect.runSync(Deferred.make<void>())
  const processStarted = Effect.runSync(Deferred.make<void>())
  const thirdPageStarted = Effect.runSync(Deferred.make<void>())
  const thirdProcessStarted = Effect.runSync(Deferred.make<void>())
  const firstPage = Effect.runSync(Deferred.make<ReturnType<typeof page>>())
  const firstProjects = Effect.runSync(Deferred.make<ProcessingProjectList>())
  const thirdPage = Effect.runSync(Deferred.make<ReturnType<typeof page>>())
  const thirdProjects = Effect.runSync(Deferred.make<ProcessingProjectList>())
  let pageCalls = 0
  let processCalls = 0
  let pageInterruptions = 0
  let processInterruptions = 0
  const latestPage = page('latest', 2)
  const latestProjects = projects('latest-project')
  const runtime = makeRuntime(
    makeRemote({
      page: () =>
        Effect.gen(function* () {
          pageCalls += 1
          if (pageCalls === 2) return latestPage
          yield* Deferred.succeed(
            pageCalls === 1 ? pageStarted : thirdPageStarted,
            undefined,
          )
          return yield* Deferred.await(
            pageCalls === 1 ? firstPage : thirdPage,
          ).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => void (pageInterruptions += 1)),
            ),
          )
        }),
      listProjects: () =>
        Effect.gen(function* () {
          processCalls += 1
          if (processCalls === 2) return latestProjects
          yield* Deferred.succeed(
            processCalls === 1 ? processStarted : thirdProcessStarted,
            undefined,
          )
          return yield* Deferred.await(
            processCalls === 1 ? firstProjects : thirdProjects,
          ).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => void (processInterruptions += 1)),
            ),
          )
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('first'),
  })
  await runtime.runPromise(
    Effect.all([Deferred.await(pageStarted), Deferred.await(processStarted)]),
  )
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('second'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.libraryPage.value?.querySnapshotVersion === 2 &&
      state.process.projects[0]?.projectId === 'latest-project',
  )

  await runtime.runPromise(
    Effect.all([
      Deferred.succeed(firstPage, page('late', 1)),
      Deferred.succeed(firstProjects, projects('late-project')),
    ]),
  )
  const latest = await waitFor(
    runtime,
    (state) => state.libraryPage.value?.querySnapshotVersion === 2,
  )
  assert.equal(latest.process.projects[0]?.projectId, 'latest-project')
  assert.equal(pageInterruptions, 1)
  assert.equal(processInterruptions, 1)

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('third'),
  })
  await runtime.runPromise(
    Effect.all([
      Deferred.await(thirdPageStarted),
      Deferred.await(thirdProcessStarted),
    ]),
  )
  await runtime.dispose()
  assert.equal(pageInterruptions, 2)
  assert.equal(processInterruptions, 2)
})

test('cancels route work when the next workspace no longer needs it', async () => {
  const pageStarted = Effect.runSync(Deferred.make<void>())
  const processStarted = Effect.runSync(Deferred.make<void>())
  let pageInterruptions = 0
  let processInterruptions = 0
  const runtime = makeRuntime(
    makeRemote({
      page: () =>
        Deferred.succeed(pageStarted, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => void (pageInterruptions += 1)),
          ),
        ),
      listProjects: () =>
        Deferred.succeed(processStarted, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => void (processInterruptions += 1)),
          ),
        ),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('library'),
  })
  await runtime.runPromise(
    Effect.all([Deferred.await(pageStarted), Deferred.await(processStarted)]),
  )
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'plan' },
    libraryQuery: query('plan'),
  })
  await runtime.dispose()

  assert.equal(pageInterruptions, 1)
  assert.equal(processInterruptions, 1)
})

test('retains last-confirmed Library and Process values while reload fails', async () => {
  const pageReloadStarted = Effect.runSync(Deferred.make<void>())
  const detailReloadStarted = Effect.runSync(Deferred.make<void>())
  const processReloadStarted = Effect.runSync(Deferred.make<void>())
  const releaseReloads = Effect.runSync(Deferred.make<void>())
  let pageCalls = 0
  let detailCalls = 0
  let processCalls = 0
  const confirmedPage = page('confirmed', 7)
  const confirmedProjects = projects('confirmed-project')
  const reloadFailure = (
    started: Deferred.Deferred<void>,
    operation: NightbookWorkspaceRemoteFailure['operation'],
  ) =>
    Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Deferred.await(releaseReloads)),
      Effect.andThen(Effect.fail(failure(operation))),
    )
  const runtime = makeRuntime(
    makeRemote({
      page: () =>
        ++pageCalls === 1
          ? Effect.succeed(confirmedPage)
          : reloadFailure(pageReloadStarted, 'page'),
      detail: () =>
        ++detailCalls === 1
          ? Effect.succeed(detail)
          : reloadFailure(detailReloadStarted, 'detail'),
      listProjects: () =>
        ++processCalls === 1
          ? Effect.succeed(confirmedProjects)
          : reloadFailure(processReloadStarted, 'list-projects'),
    }),
  )
  const route = { kind: 'asset', assetId: detail.assetId } as const

  await submit(runtime, {
    _tag: 'RouteChanged',
    route,
    libraryQuery: query('confirmed'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.libraryPage.value?.querySnapshotVersion === 7 &&
      state.libraryDetail.value?.assetId === detail.assetId &&
      state.process.projects[0]?.projectId === 'confirmed-project',
  )
  await submit(runtime, {
    _tag: 'RouteChanged',
    route,
    libraryQuery: query('reload'),
  })
  await runtime.runPromise(
    Effect.all([
      Deferred.await(pageReloadStarted),
      Deferred.await(detailReloadStarted),
      Deferred.await(processReloadStarted),
    ]),
  )
  const loading = await waitFor(
    runtime,
    (state) =>
      state.libraryPage.message === 'Loading Library records.' &&
      state.libraryDetail.state === 'loading' &&
      state.process.state === 'loading',
  )
  assert.equal(loading.libraryPage.value?.querySnapshotVersion, 7)
  assert.equal(loading.libraryDetail.value?.assetId, detail.assetId)
  assert.equal(loading.process.projects[0]?.projectId, 'confirmed-project')

  const failedState = waitFor(
    runtime,
    (state) =>
      state.libraryPage.message === 'Library evidence is unavailable.' &&
      state.libraryDetail.state === 'unavailable' &&
      state.process.state === 'unavailable',
  )
  await runtime.runPromise(Deferred.succeed(releaseReloads, undefined))
  const failed = await failedState
  await runtime.dispose()

  assert.equal(failed.libraryPage.value?.querySnapshotVersion, 7)
  assert.equal(failed.libraryDetail.value?.assetId, detail.assetId)
  assert.equal(failed.process.projects[0]?.projectId, 'confirmed-project')
})

test('publishes a matched Process pair when post-change evidence needs reconciliation', async () => {
  const confirmed = openedProject(1)
  const changed = openedProject(2)
  const confirmedEvidence = projectEvidence()
  const changedEvidence = projectEvidence()
  let openCalls = 0
  let evidenceCalls = 0
  let changeCalls = 0
  const runtime = makeRuntime(
    makeRemote({
      openProject: () =>
        Effect.succeed(++openCalls === 1 ? confirmed : changed),
      projectEvidence: () => {
        evidenceCalls += 1
        if (evidenceCalls === 1) return Effect.succeed(confirmedEvidence)
        if (evidenceCalls === 2) return Effect.fail(failure('project-evidence'))
        return Effect.succeed(changedEvidence)
      },
      changeProject: () =>
        Effect.sync(() => {
          changeCalls += 1
          return changed
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: confirmed.projectId },
    libraryQuery: query('process'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.process.project?.revision === confirmed.revision &&
      state.process.evidence === confirmedEvidence,
  )
  const result = await submit(runtime, {
    _tag: 'ChangeProject',
    project: confirmed,
    intent: { _tag: 'UndoDraft', stage: 'Calibration' },
  })
  const reconciled = await waitFor(
    runtime,
    (state) =>
      state.process.project?.revision === changed.revision &&
      state.process.evidence === changedEvidence,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Project')
  assert.equal(reconciled.process.project, changed)
  assert.equal(reconciled.process.evidence, changedEvidence)
  assert.equal(changeCalls, 1)
  assert.equal(openCalls, 2)
  assert.equal(evidenceCalls, 3)
})

test('retains the last-confirmed Process pair when changed evidence stays unavailable', async () => {
  const confirmed = openedProject(1)
  const changed = openedProject(2)
  const confirmedEvidence = projectEvidence()
  let evidenceCalls = 0
  let changeCalls = 0
  const runtime = makeRuntime(
    makeRemote({
      openProject: () =>
        Effect.succeed(evidenceCalls === 0 ? confirmed : changed),
      projectEvidence: () =>
        ++evidenceCalls === 1
          ? Effect.succeed(confirmedEvidence)
          : Effect.fail(failure('project-evidence')),
      changeProject: () =>
        Effect.sync(() => {
          changeCalls += 1
          return changed
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: confirmed.projectId },
    libraryQuery: query('process'),
  })
  await waitFor(runtime, (state) => state.process.state === 'current')
  const result = await submit(runtime, {
    _tag: 'ChangeProject',
    project: confirmed,
    intent: { _tag: 'UndoDraft', stage: 'Calibration' },
  })
  const unavailableState = await waitFor(
    runtime,
    (state) => state.process.state === 'unavailable',
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Unavailable')
  assert.equal(unavailableState.process.project, confirmed)
  assert.equal(unavailableState.process.evidence, confirmedEvidence)
  assert.equal(changeCalls, 1)
  assert.equal(evidenceCalls, 3)
})

test(
  'refreshes the open Process pair after a later bootstrap state',
  { timeout: 2_000 },
  async () => {
    const states = Effect.runSync(Queue.unbounded<BootstrapClientState>())
    const confirmed = openedProject(1)
    const settled = openedProject(2)
    const confirmedEvidence = projectEvidence()
    const settledEvidence = projectEvidence()
    let openCalls = 0
    let evidenceCalls = 0
    let changeCalls = 0
    const runtime = makeRuntime(
      makeRemote({
        states: Stream.fromQueue(states),
        openProject: () =>
          Effect.sync(() => (++openCalls === 1 ? confirmed : settled)),
        projectEvidence: () =>
          Effect.sync(() =>
            ++evidenceCalls === 1 ? confirmedEvidence : settledEvidence,
          ),
        changeProject: () =>
          Effect.sync(() => {
            changeCalls += 1
            return settled
          }),
      }),
    )

    const initialBootstrap = Schema.decodeUnknownSync(BootstrapSnapshot)(
      bootstrapFixtures.fresh,
    )
    await runtime.runPromise(
      Queue.offer(
        states,
        BootstrapClientState.Current({ snapshot: initialBootstrap }),
      ),
    )
    await waitFor(
      runtime,
      (state) =>
        state.projection.snapshotVersion === initialBootstrap.snapshotVersion,
    )
    await submit(runtime, {
      _tag: 'RouteChanged',
      route: { kind: 'process-project', projectId: confirmed.projectId },
      libraryQuery: query('process'),
    })
    await waitFor(
      runtime,
      (state) =>
        state.process.project === confirmed &&
        state.process.evidence === confirmedEvidence,
    )
    await runtime.runPromise(
      Queue.offer(
        states,
        BootstrapClientState.Reconnecting({
          snapshot: initialBootstrap,
          reason: 'Reconnect without a new service event.',
        }),
      ),
    )
    await waitFor(runtime, (state) =>
      state.projection.shell.freshness.startsWith('Reconnecting snapshot'),
    )
    assert.equal(openCalls, 1)
    assert.equal(evidenceCalls, 1)

    const settledBootstrap = Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...initialBootstrap,
      snapshotVersion: initialBootstrap.snapshotVersion + 1,
      eventCursor: initialBootstrap.eventCursor + 1,
    })
    await runtime.runPromise(
      Queue.offer(
        states,
        BootstrapClientState.Current({ snapshot: settledBootstrap }),
      ),
    )
    const refreshed = await waitFor(
      runtime,
      (state) =>
        state.process.project === settled &&
        state.process.evidence === settledEvidence,
    )
    await runtime.dispose()

    assert.equal(refreshed.process.project?.revision, settled.revision)
    assert.equal(openCalls, 2)
    assert.equal(evidenceCalls, 2)
    assert.equal(changeCalls, 0)
  },
)

test('reconciles Review and Project intake failures through reads without replay', async () => {
  const confirmedProject = openedProject(1)
  const confirmedEvidence = projectEvidence()
  let reviewCalls = 0
  let createCalls = 0
  let addCalls = 0
  let detailReads = 0
  let listReads = 0
  let projectReads = 0
  let evidenceReads = 0
  const runtime = makeRuntime(
    makeRemote({
      page: () => Effect.succeed(page('review', 1)),
      review: () =>
        Effect.sync(() => void (reviewCalls += 1)).pipe(
          Effect.andThen(Effect.fail(failure('review'))),
        ),
      detail: () =>
        Effect.sync(() => {
          detailReads += 1
          return detail
        }),
      createProject: () =>
        Effect.sync(() => void (createCalls += 1)).pipe(
          Effect.andThen(Effect.fail(failure('create-project'))),
        ),
      listProjects: () =>
        Effect.sync(() => {
          listReads += 1
          return projects('project-1')
        }),
      addProjectSources: () =>
        Effect.sync(() => void (addCalls += 1)).pipe(
          Effect.andThen(Effect.fail(failure('add-project-sources'))),
        ),
      openProject: () =>
        Effect.sync(() => {
          projectReads += 1
          return confirmedProject
        }),
      projectEvidence: () =>
        Effect.sync(() => {
          evidenceReads += 1
          return confirmedEvidence
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'asset', assetId: detail.assetId },
    libraryQuery: query('review'),
  })
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === detail.assetId,
  )
  const reviewResult = await submit(runtime, {
    _tag: 'ReviewLibraryAsset',
    assetId: detail.assetId,
    request: {
      expectedAssetRevision: detail.revision,
      expectedReviewRevision: AssetRevision.make(0),
      decision: 'accepted',
      idempotencyKey: 'review-1',
    },
  })
  const reviewState = await waitFor(
    runtime,
    (state) => state.libraryDetail.value === detail,
  )
  const createResult = await submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  const listState = await waitFor(
    runtime,
    (state) => state.process.projects[0]?.projectId === 'project-1',
  )
  const addResult = await submit(runtime, {
    _tag: 'AddProjectSources',
    projectId: confirmedProject.projectId,
    expectedProjectRevision: confirmedProject.revision,
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  const pairState = await waitFor(
    runtime,
    (state) =>
      state.process.project === confirmedProject &&
      state.process.evidence === confirmedEvidence,
  )
  await runtime.dispose()

  assert.equal(reviewResult._tag, 'Unavailable')
  assert.equal(createResult._tag, 'Unavailable')
  assert.equal(addResult._tag, 'Unavailable')
  assert.equal(reviewState.libraryDetail.value, detail)
  assert.equal(listState.process.projects[0]?.projectId, 'project-1')
  assert.equal(pairState.process.project, confirmedProject)
  assert.equal(pairState.process.evidence, confirmedEvidence)
  assert.equal(reviewCalls, 1)
  assert.equal(createCalls, 1)
  assert.equal(addCalls, 1)
  assert.equal(detailReads, 2)
  assert.equal(listReads, 2)
  assert.equal(projectReads, 1)
  assert.equal(evidenceReads, 1)
})

test('reuses one Project creation receipt after an uncertain accepted response', async () => {
  const acceptedProject = openedProject(1)
  const requests: Array<CreateProcessingProjectRequest> = []
  let createCalls = 0
  let listReads = 0
  const runtime = makeRuntime(
    makeRemote({
      createProject: (...args) =>
        Effect.suspend(() => {
          createCalls += 1
          requests.push(args[0])
          return createCalls === 1
            ? Effect.fail(failure('create-project'))
            : Effect.succeed(acceptedProject)
        }),
      listProjects: () =>
        Effect.sync(() => {
          listReads += 1
          return projects('project-1')
        }),
    }),
  )
  const intent = NightbookWorkspaceIntent.CreateProject({
    name: 'M27',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })

  const uncertain = await submit(runtime, intent)
  assert.equal(uncertain._tag, 'Unavailable')
  assert.equal(createCalls, 1)
  assert.equal(listReads, 1)

  const recovered = await submit(
    runtime,
    NightbookWorkspaceIntent.CreateProject({
      name: 'M27',
      selection: { assetIds: [detail.assetId], captureSetIds: [] },
    }),
  )

  assert.equal(recovered._tag, 'Project')
  if (recovered._tag === 'Project')
    assert.equal(recovered.project, acceptedProject)
  assert.equal(createCalls, 2)
  assert.equal(requests.length, 2)
  const first = requests[0]
  const second = requests[1]
  assert.ok(first !== undefined)
  assert.ok(second !== undefined)
  assert.equal(first.name, 'M27')
  assert.deepEqual(first.selection, intent.selection)
  assert.equal(typeof first.intentId, 'string')
  assert.equal(second.intentId, first.intentId)

  const next = await submit(runtime, intent)
  assert.equal(next._tag, 'Project')
  assert.equal(requests.length, 3)
  assert.notEqual(requests[2]?.intentId, first.intentId)
  await runtime.dispose()
})

test('starts a new Project creation receipt when the name or exact selection changes', async () => {
  const intentIds: Array<string> = []
  const runtime = makeRuntime(
    makeRemote({
      createProject: (request) =>
        Effect.sync(() => {
          intentIds.push(request.intentId)
        }).pipe(Effect.andThen(Effect.fail(failure('create-project')))),
      listProjects: () => Effect.succeed([]),
    }),
  )

  await submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27 Widefield',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27 Widefield',
    selection: {
      assetIds: [detail.assetId, assetDetail('asset-2').assetId],
      captureSetIds: [
        CaptureSetId.make('capture-set-1'),
        CaptureSetId.make('capture-set-2'),
      ],
    },
  })
  await submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27 Widefield',
    selection: {
      assetIds: [assetDetail('asset-2').assetId, detail.assetId],
      captureSetIds: [
        CaptureSetId.make('capture-set-1'),
        CaptureSetId.make('capture-set-2'),
      ],
    },
  })
  await submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27 Widefield',
    selection: {
      assetIds: [assetDetail('asset-2').assetId, detail.assetId],
      captureSetIds: [
        CaptureSetId.make('capture-set-2'),
        CaptureSetId.make('capture-set-1'),
      ],
    },
  })
  await runtime.dispose()

  assert.equal(intentIds.length, 5)
  assert.equal(new Set(intentIds).size, 5)
})

test('retains uncertain Project creation receipts for independent semantic requests', async () => {
  const requests: Array<CreateProcessingProjectRequest> = []
  let firstA = true
  const runtime = makeRuntime(
    makeRemote({
      createProject: (request) =>
        Effect.suspend(() => {
          requests.push(request)
          if (request.name === 'A' && firstA) {
            firstA = false
            return Effect.fail(failure('create-project'))
          }
          return Effect.succeed(openedProject(1))
        }),
      listProjects: () => Effect.succeed([]),
    }),
  )

  await submit(runtime, {
    _tag: 'CreateProject',
    name: 'A',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await submit(runtime, {
    _tag: 'CreateProject',
    name: 'B',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await submit(runtime, {
    _tag: 'CreateProject',
    name: 'A',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await runtime.dispose()

  const aRequests = requests.filter((request) => request.name === 'A')
  const bRequest = requests.find((request) => request.name === 'B')
  assert.equal(aRequests.length, 2)
  assert.ok(aRequests[0] !== undefined)
  assert.ok(aRequests[1] !== undefined)
  assert.ok(bRequest !== undefined)
  assert.equal(aRequests[1].intentId, aRequests[0].intentId)
  assert.notEqual(bRequest.intentId, aRequests[0].intentId)
})

test('does not let an older Project-list reconciliation replace newer truth', async () => {
  const olderListStarted = Effect.runSync(Deferred.make<void>())
  const releaseOlderList = Effect.runSync(Deferred.make<void>())
  let listReads = 0
  const runtime = makeRuntime(
    makeRemote({
      createProject: () => Effect.fail(failure('create-project')),
      listProjects: () =>
        Effect.suspend(() => {
          listReads += 1
          if (listReads === 1)
            return Deferred.succeed(olderListStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseOlderList)),
              Effect.as(projects('older-project')),
            )
          return Effect.succeed(projects('newer-project'))
        }),
    }),
  )

  const older = submit(runtime, {
    _tag: 'CreateProject',
    name: 'Older',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await runtime.runPromise(Deferred.await(olderListStarted))
  await submit(runtime, {
    _tag: 'CreateProject',
    name: 'Newer',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await runtime.runPromise(Deferred.succeed(releaseOlderList, undefined))
  await older
  const current = await waitFor(runtime, () => true)
  await runtime.dispose()

  assert.equal(current.process.projects[0]?.projectId, 'newer-project')
})

test('does not let an older Create reconciliation replace a newer route Project list', async () => {
  const createListStarted = Effect.runSync(Deferred.make<void>())
  const releaseCreateList = Effect.runSync(Deferred.make<void>())
  let listReads = 0
  const runtime = makeRuntime(
    makeRemote({
      createProject: () => Effect.fail(failure('create-project')),
      listProjects: () =>
        Effect.suspend(() => {
          listReads += 1
          if (listReads === 1)
            return Deferred.succeed(createListStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseCreateList)),
              Effect.as(projects('create-project')),
            )
          return Effect.succeed(projects('route-project'))
        }),
    }),
  )

  const create = submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await runtime.runPromise(Deferred.await(createListStarted))
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'process' },
    libraryQuery: query('process'),
  })
  await waitFor(
    runtime,
    (state) => state.process.projects[0]?.projectId === 'route-project',
  )
  await runtime.runPromise(Deferred.succeed(releaseCreateList, undefined))
  await create
  const current = await waitFor(runtime, () => true)
  await runtime.dispose()

  assert.equal(current.process.projects[0]?.projectId, 'route-project')
})

test('does not publish Create reconciliation after navigating to an unavailable open Project', async () => {
  const createListStarted = Effect.runSync(Deferred.make<void>())
  const releaseCreateList = Effect.runSync(Deferred.make<void>())
  let createCalls = 0
  let listReads = 0
  const runtime = makeRuntime(
    makeRemote({
      page: () => Effect.succeed(page('library', 1)),
      createProject: () =>
        Effect.sync(() => {
          createCalls += 1
        }).pipe(Effect.andThen(Effect.fail(failure('create-project')))),
      listProjects: () =>
        Effect.suspend(() => {
          listReads += 1
          if (listReads === 1) return Effect.succeed(projects('initial'))
          return Deferred.succeed(createListStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseCreateList)),
            Effect.as(projects('stale-create')),
          )
        }),
      openProject: () => Effect.fail(failure('open-project')),
      projectEvidence: () => Effect.fail(failure('project-evidence')),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('library'),
  })
  await waitFor(
    runtime,
    (state) => state.process.projects[0]?.projectId === 'initial',
  )
  const create = submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await runtime.runPromise(Deferred.await(createListStarted))
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: openedProject(1).projectId },
    libraryQuery: query('process'),
  })
  await waitFor(runtime, (state) => state.process.state === 'unavailable')
  await runtime.runPromise(Deferred.succeed(releaseCreateList, undefined))
  await create
  const current = await waitFor(runtime, () => true)
  await runtime.dispose()

  assert.equal(current.process.state, 'unavailable')
  assert.equal(current.process.projects[0]?.projectId, 'initial')
  assert.equal(createCalls, 1)
  assert.equal(listReads, 2)
})

test('does not let an old-route Create failure invalidate a current route Project list', async () => {
  const createStarted = Effect.runSync(Deferred.make<void>())
  const releaseCreate = Effect.runSync(Deferred.make<void>())
  const routeListStarted = Effect.runSync(Deferred.make<void>())
  const releaseRouteList = Effect.runSync(Deferred.make<void>())
  let createCalls = 0
  let listReads = 0
  const runtime = makeRuntime(
    makeRemote({
      page: () => Effect.succeed(page('library', 1)),
      createProject: () =>
        Effect.sync(() => {
          createCalls += 1
        }).pipe(
          Effect.andThen(Deferred.succeed(createStarted, undefined)),
          Effect.andThen(Deferred.await(releaseCreate)),
          Effect.andThen(Effect.fail(failure('create-project'))),
        ),
      listProjects: () =>
        Effect.suspend(() => {
          listReads += 1
          if (listReads === 1) return Effect.succeed(projects('initial'))
          if (listReads === 2)
            return Deferred.succeed(routeListStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseRouteList)),
              Effect.as(projects('route-current')),
            )
          return Effect.succeed(projects('stale-create'))
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('library'),
  })
  await waitFor(
    runtime,
    (state) => state.process.projects[0]?.projectId === 'initial',
  )
  const create = submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await runtime.runPromise(Deferred.await(createStarted))
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'process' },
    libraryQuery: query('process'),
  })
  await runtime.runPromise(Deferred.await(routeListStarted))
  await runtime.runPromise(Deferred.succeed(releaseCreate, undefined))
  await create
  assert.equal(createCalls, 1)
  assert.equal(listReads, 2)
  await runtime.runPromise(Deferred.succeed(releaseRouteList, undefined))
  const current = await waitFor(
    runtime,
    (state) => state.process.state !== 'loading',
  )
  await runtime.dispose()

  assert.equal(current.process.state, 'current')
  assert.equal(current.process.projects[0]?.projectId, 'route-current')
  assert.equal(createCalls, 1)
  assert.equal(listReads, 2)
})

test('releases the Project creation receipt after a definite protocol rejection', async () => {
  const intentIds: Array<string> = []
  let createCalls = 0
  const rejected = new NightbookWorkspaceRemoteFailure({
    operation: 'create-project',
    reason: 'rejected',
    message: 'Project creation was rejected.',
  })
  const runtime = makeRuntime(
    makeRemote({
      createProject: (request) =>
        Effect.suspend(() => {
          createCalls += 1
          intentIds.push(request.intentId)
          return Effect.fail(
            createCalls === 1 ? rejected : failure('create-project'),
          )
        }),
      listProjects: () => Effect.succeed([]),
    }),
  )
  const intent = NightbookWorkspaceIntent.CreateProject({
    name: 'M27',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })

  await submit(runtime, intent)
  await submit(runtime, intent)
  await runtime.dispose()

  assert.equal(intentIds.length, 2)
  assert.notEqual(intentIds[1], intentIds[0])
})

test('keeps a late Review failure reconciliation bound to its Asset route', async () => {
  const assetA = assetDetail('asset-a')
  const assetB = assetDetail('asset-b')
  const reviewStarted = Effect.runSync(Deferred.make<void>())
  const releaseReview = Effect.runSync(Deferred.make<void>())
  let reviewCalls = 0
  let detailReads = 0
  const runtime = makeRuntime(
    makeRemote({
      page: () => Effect.succeed(page('library', 1)),
      listProjects: () => Effect.succeed([]),
      review: () =>
        Effect.gen(function* () {
          reviewCalls += 1
          yield* Deferred.succeed(reviewStarted, undefined)
          yield* Deferred.await(releaseReview)
          return yield* Effect.fail(failure('review'))
        }),
      detail: (assetId) =>
        Effect.sync(() => {
          detailReads += 1
          return assetId === assetA.assetId ? assetA : assetB
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'asset', assetId: assetA.assetId },
    libraryQuery: query('asset-a'),
  })
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === assetA.assetId,
  )
  const reviewResult = submit(runtime, {
    _tag: 'ReviewLibraryAsset',
    assetId: assetA.assetId,
    request: {
      expectedAssetRevision: assetA.revision,
      expectedReviewRevision: AssetRevision.make(0),
      decision: 'accepted',
      idempotencyKey: 'review-asset-a',
    },
  })
  await runtime.runPromise(Deferred.await(reviewStarted))
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'asset', assetId: assetB.assetId },
    libraryQuery: query('asset-b'),
  })
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === assetB.assetId,
  )
  await runtime.runPromise(Deferred.succeed(releaseReview, undefined))
  const result = await reviewResult
  const finalState = await waitFor(
    runtime,
    (state) => state.libraryDetail.value !== undefined,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Unavailable')
  assert.equal(finalState.libraryDetail.value?.assetId, assetB.assetId)
  assert.equal(finalState.libraryDetail.state, undefined)
  assert.equal(reviewCalls, 1)
  assert.equal(detailReads, 3)
})

test('keeps a late failed Review read-back from making the newer Asset unavailable', async () => {
  const assetA = assetDetail('asset-a')
  const assetB = assetDetail('asset-b')
  const reviewStarted = Effect.runSync(Deferred.make<void>())
  const releaseReview = Effect.runSync(Deferred.make<void>())
  let reviewCalls = 0
  let assetAReads = 0
  const runtime = makeRuntime(
    makeRemote({
      page: () => Effect.succeed(page('library', 1)),
      listProjects: () => Effect.succeed([]),
      review: () =>
        Effect.gen(function* () {
          reviewCalls += 1
          yield* Deferred.succeed(reviewStarted, undefined)
          yield* Deferred.await(releaseReview)
          return yield* Effect.fail(failure('review'))
        }),
      detail: (assetId) => {
        if (assetId === assetB.assetId) return Effect.succeed(assetB)
        assetAReads += 1
        return assetAReads === 1
          ? Effect.succeed(assetA)
          : Effect.fail(failure('detail'))
      },
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'asset', assetId: assetA.assetId },
    libraryQuery: query('asset-a'),
  })
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === assetA.assetId,
  )
  const reviewResult = submit(runtime, {
    _tag: 'ReviewLibraryAsset',
    assetId: assetA.assetId,
    request: {
      expectedAssetRevision: assetA.revision,
      expectedReviewRevision: AssetRevision.make(0),
      decision: 'accepted',
      idempotencyKey: 'review-asset-a-failed-read-back',
    },
  })
  await runtime.runPromise(Deferred.await(reviewStarted))
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'asset', assetId: assetB.assetId },
    libraryQuery: query('asset-b'),
  })
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === assetB.assetId,
  )
  await runtime.runPromise(Deferred.succeed(releaseReview, undefined))
  const result = await reviewResult
  const finalState = await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === assetB.assetId,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Unavailable')
  assert.equal(finalState.libraryDetail.value?.assetId, assetB.assetId)
  assert.equal(finalState.libraryDetail.state, undefined)
  assert.equal(reviewCalls, 1)
  assert.equal(assetAReads, 2)
})

test('does not publish a late Review success after returning to the same Asset', async () => {
  const assetA = assetDetail('asset-a')
  const assetB = assetDetail('asset-b')
  const reviewStarted = Effect.runSync(Deferred.make<void>())
  const releaseReview = Effect.runSync(Deferred.make<void>())
  let reviewCalls = 0
  const runtime = makeRuntime(
    makeRemote({
      page: () => Effect.succeed(page('library', 1)),
      listProjects: () => Effect.succeed([]),
      detail: (assetId) =>
        Effect.succeed(assetId === assetA.assetId ? assetA : assetB),
      review: () =>
        Effect.gen(function* () {
          reviewCalls += 1
          yield* Deferred.succeed(reviewStarted, undefined)
          yield* Deferred.await(releaseReview)
          return {
            revision: AssetRevision.make(1),
            decision: 'accepted' as const,
            updatedAt: '2026-08-12T00:00:00.000Z',
          }
        }),
    }),
  )
  const openAsset = (assetId: typeof assetA.assetId, queryId: string) =>
    submit(runtime, {
      _tag: 'RouteChanged',
      route: { kind: 'asset', assetId },
      libraryQuery: query(queryId),
    })

  await openAsset(assetA.assetId, 'asset-a-first')
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === assetA.assetId,
  )
  const reviewResult = submit(runtime, {
    _tag: 'ReviewLibraryAsset',
    assetId: assetA.assetId,
    request: {
      expectedAssetRevision: assetA.revision,
      expectedReviewRevision: AssetRevision.make(0),
      decision: 'accepted',
      idempotencyKey: 'review-asset-a-first-route',
    },
  })
  await runtime.runPromise(Deferred.await(reviewStarted))
  await openAsset(assetB.assetId, 'asset-b')
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === assetB.assetId,
  )
  await openAsset(assetA.assetId, 'asset-a-returned')
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === assetA.assetId,
  )
  await runtime.runPromise(Deferred.succeed(releaseReview, undefined))
  const result = await reviewResult
  const finalState = await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === assetA.assetId,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Loaded')
  assert.equal(finalState.libraryDetail.value?.review, undefined)
  assert.equal(finalState.libraryDetail.state, undefined)
  assert.equal(reviewCalls, 1)
})

test('keeps an older overlapping Review from replacing the newer Review', async () => {
  const asset = assetDetail('asset-a')
  const olderStarted = Effect.runSync(Deferred.make<void>())
  const newerStarted = Effect.runSync(Deferred.make<void>())
  const releaseOlder = Effect.runSync(Deferred.make<void>())
  const releaseNewer = Effect.runSync(Deferred.make<void>())
  let reviewCalls = 0
  const runtime = makeRuntime(
    makeRemote({
      page: () => Effect.succeed(page('library', 1)),
      listProjects: () => Effect.succeed([]),
      detail: () => Effect.succeed(asset),
      review: (_assetId, request) =>
        Effect.gen(function* () {
          reviewCalls += 1
          const isOlder = request.idempotencyKey === 'review-older'
          yield* Deferred.succeed(
            isOlder ? olderStarted : newerStarted,
            undefined,
          )
          yield* Deferred.await(isOlder ? releaseOlder : releaseNewer)
          return {
            revision: AssetRevision.make(isOlder ? 1 : 2),
            decision: isOlder ? ('rejected' as const) : ('accepted' as const),
            updatedAt: isOlder
              ? '2026-08-12T00:00:01.000Z'
              : '2026-08-12T00:00:02.000Z',
          }
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'asset', assetId: asset.assetId },
    libraryQuery: query('asset-a'),
  })
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === asset.assetId,
  )
  const olderResult = submit(runtime, {
    _tag: 'ReviewLibraryAsset',
    assetId: asset.assetId,
    request: {
      expectedAssetRevision: asset.revision,
      expectedReviewRevision: AssetRevision.make(0),
      decision: 'rejected',
      idempotencyKey: 'review-older',
    },
  })
  await runtime.runPromise(Deferred.await(olderStarted))
  const newerResult = submit(runtime, {
    _tag: 'ReviewLibraryAsset',
    assetId: asset.assetId,
    request: {
      expectedAssetRevision: asset.revision,
      expectedReviewRevision: AssetRevision.make(0),
      decision: 'accepted',
      idempotencyKey: 'review-newer',
    },
  })
  await runtime.runPromise(Deferred.await(newerStarted))
  await runtime.runPromise(Deferred.succeed(releaseNewer, undefined))
  const newerSubmission = await newerResult
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.review?.decision === 'accepted',
  )
  await runtime.runPromise(Deferred.succeed(releaseOlder, undefined))
  const olderSubmission = await olderResult
  const finalState = await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.review !== undefined,
  )
  await runtime.dispose()

  assert.equal(newerSubmission._tag, 'Loaded')
  assert.equal(olderSubmission._tag, 'Loaded')
  assert.equal(finalState.libraryDetail.value?.review?.decision, 'accepted')
  assert.equal(finalState.libraryDetail.value?.review?.revision, 2)
  assert.equal(reviewCalls, 2)
})
