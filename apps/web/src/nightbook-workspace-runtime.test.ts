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
  ProcessingProjectChangeRequest,
  ProcessingProjectEvidence,
  ProcessingProjectId,
  ProcessingProjectRevision,
  type ReviewAssetRequest,
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
  ProcessAction,
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

const currentBootstrap = BootstrapClientState.Current({
  snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
    bootstrapFixtures.fresh,
  ),
})

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

const semanticProcessDraft = {
  _tag: 'Develop',
  operation: { _tag: 'Stretch', method: 'asinh', amount: 0.5 },
} as const

const semanticProcessActions = [
  ProcessAction.ReplaceDraft({ draft: semanticProcessDraft }),
  ProcessAction.SyncDevelopPreview({}),
  ProcessAction.RunCurrentDraft({ stage: 'Calibration' }),
  ProcessAction.UndoDraft({ stage: 'Calibration' }),
  ProcessAction.RedoDraft({ stage: 'Registration' }),
  ProcessAction.UndoCurrentResult({ stage: 'Stacking' }),
  ProcessAction.RedoCurrentResult({ stage: 'Develop' }),
  ProcessAction.SaveCurrentResult({ stage: 'Stacking' }),
  ProcessAction.OpenSavedMasterInDevelop({}),
] as const satisfies ReadonlyArray<ProcessAction>

const everySemanticProcessActionIsCovered = true satisfies Exclude<
  ProcessAction['_tag'],
  (typeof semanticProcessActions)[number]['_tag']
> extends never
  ? true
  : false

const semanticProcessProject = () =>
  Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...openedProject(7),
    stages: processingStages.map((stage) =>
      stage.stage === 'Develop'
        ? { ...stage, draft: { ...stage.draft, revision: 12 } }
        : stage,
    ),
    savedAssetIds: ['asset-master-old', 'asset-master', 'asset-developed'],
  })

const semanticProcessEvidence = () =>
  Schema.decodeUnknownSync(ProcessingProjectEvidence)({
    projectId: 'project-1',
    attempts: [
      {
        attemptId: 'stacking-attempt-old',
        stage: 'Stacking',
        state: 'succeeded',
        draftRevision: 1,
        draft: { _tag: 'Stacking', settings: [], frameChoices: [] },
        sources: [],
        frozenAt: '2026-08-11T00:00:01.000Z',
        settledAt: '2026-08-11T00:00:02.000Z',
        outcome: 'Succeeded',
        outputs: [
          {
            outputId: 'stacking-output-old',
            checksum: 'stacking-checksum-old',
            relation: 'CurrentResult',
          },
        ],
        evidence: {
          _tag: 'Stacking',
          recommendations: [],
          frameChoices: [],
          includedAssetIds: [],
          savedMasterAssetId: 'asset-master-old',
        },
        diagnostics: [],
      },
      {
        attemptId: 'stacking-attempt-current',
        stage: 'Stacking',
        state: 'succeeded',
        draftRevision: 2,
        draft: { _tag: 'Stacking', settings: [], frameChoices: [] },
        sources: [],
        frozenAt: '2026-08-11T00:00:03.000Z',
        settledAt: '2026-08-11T00:00:04.000Z',
        outcome: 'Succeeded',
        outputs: [
          {
            outputId: 'stacking-output-current',
            checksum: 'stacking-checksum-current',
            relation: 'CurrentResult',
          },
        ],
        evidence: {
          _tag: 'Stacking',
          recommendations: [],
          frameChoices: [],
          includedAssetIds: [],
          savedMasterAssetId: 'asset-master',
        },
        diagnostics: [],
      },
      {
        attemptId: 'develop-attempt-current',
        stage: 'Develop',
        state: 'succeeded',
        draftRevision: 12,
        draft: semanticProcessDraft,
        sources: [],
        inputCheckpointId: 'checkpoint-develop',
        previewId: 'preview-develop',
        frozenAt: '2026-08-11T00:00:05.000Z',
        settledAt: '2026-08-11T00:00:06.000Z',
        outcome: 'Succeeded',
        outputs: [
          {
            outputId: 'develop-output-current',
            checksum: 'develop-checksum-current',
            relation: 'CurrentResult',
          },
        ],
        evidence: {
          _tag: 'Develop',
          previewId: 'preview-develop',
          inputCheckpointId: 'checkpoint-develop',
          relatedOutputIds: [],
        },
        diagnostics: [],
      },
    ],
  })

test('maps every semantic Process action with current facts, fresh identity, and one write', async () => {
  assert.equal(everySemanticProcessActionIsCovered, true)
  const project = semanticProcessProject()
  const evidence = semanticProcessEvidence()
  const requests: Array<typeof ProcessingProjectChangeRequest.Type> = []
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      openProject: () => Effect.succeed(project),
      projectEvidence: () => Effect.succeed(evidence),
      changeProject: (request) =>
        Effect.sync(() => {
          requests.push(
            Schema.decodeUnknownSync(ProcessingProjectChangeRequest)(request),
          )
          return project
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: project.projectId },
    libraryQuery: query('semantic-process'),
  })
  const before = await waitFor(
    runtime,
    (state) => state.process.project?.revision === project.revision,
  )
  for (const action of semanticProcessActions) {
    const result = await submit(runtime, { _tag: 'Process', action })
    assert.equal(result._tag, 'Project')
  }
  const after = await waitFor(
    runtime,
    (state) => state.process.state === 'current',
  )
  await runtime.dispose()

  assert.equal(requests.length, semanticProcessActions.length)
  assert.equal(
    requests.every((request) => request.expectedProjectRevision === 7),
    true,
  )
  assert.deepEqual(
    requests.map((request) => request.intent),
    [
      { _tag: 'ReplaceDraft', draft: semanticProcessDraft },
      { _tag: 'SyncDevelopPreview', expectedDraftRevision: 12 },
      {
        _tag: 'RunStage',
        stage: 'Calibration',
        from: { _tag: 'CurrentDraft' },
      },
      { _tag: 'UndoDraft', stage: 'Calibration' },
      { _tag: 'RedoDraft', stage: 'Registration' },
      { _tag: 'UndoCurrentResult', stage: 'Stacking' },
      { _tag: 'RedoCurrentResult', stage: 'Develop' },
      { _tag: 'SaveCurrentResult', stage: 'Stacking' },
      { _tag: 'OpenDevelop', assetId: 'asset-master' },
    ],
  )
  const identities = requests.map((request) => request.intentId)
  assert.equal(
    identities.every((identity) => identity.length > 0),
    true,
  )
  assert.equal(new Set(identities).size, semanticProcessActions.length)
  assert.equal(before.process.project, project)
  assert.equal(after.process.project, project)
})

test('keeps current Project truth while a semantic Process write is pending', async () => {
  const confirmed = semanticProcessProject()
  const changed = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...confirmed,
    revision: 8,
    updatedAt: '2026-08-11T00:00:08.000Z',
  })
  const evidence = projectEvidence()
  const writeStarted = Deferred.makeUnsafe<void>()
  const releaseWrite = Deferred.makeUnsafe<void>()
  let writes = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      openProject: () => Effect.succeed(confirmed),
      projectEvidence: () => Effect.succeed(evidence),
      changeProject: () =>
        Effect.sync(() => {
          writes += 1
        }).pipe(
          Effect.andThen(Deferred.succeed(writeStarted, undefined)),
          Effect.andThen(Deferred.await(releaseWrite)),
          Effect.as(changed),
        ),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: confirmed.projectId },
    libraryQuery: query('process-provisional'),
  })
  await waitFor(runtime, (state) => state.process.project === confirmed)
  const submission = submit(runtime, {
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
  })
  await runtime.runPromise(Deferred.await(writeStarted))
  const provisional = await waitFor(
    runtime,
    (state) => state.process.project?.revision === confirmed.revision,
  )
  await runtime.runPromise(Deferred.succeed(releaseWrite, undefined))
  const result = await submission
  const accepted = await waitFor(
    runtime,
    (state) => state.process.project?.revision === changed.revision,
  )
  await runtime.dispose()

  assert.equal(provisional.process.project, confirmed)
  assert.equal(result._tag, 'Project')
  assert.equal(accepted.process.project, changed)
  assert.equal(writes, 1)
})

test('stops semantic Process actions without current routed truth or Process Authority', async () => {
  const allowed = semanticProcessProject()
  const denied = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...allowed,
    authority: { _tag: 'Denied', reason: 'OwnerRequired' },
  })
  const staleBootstrap = BootstrapClientState.Stale({
    snapshot: currentBootstrap.snapshot,
    reason: 'stale',
  })
  const cases = [
    {
      name: 'no Project route',
      state: currentBootstrap,
      project: allowed,
      routeProjectId: undefined,
    },
    {
      name: 'mismatched routed Project',
      state: currentBootstrap,
      project: allowed,
      routeProjectId: ProcessingProjectId.make('project-other'),
    },
    {
      name: 'denied Process Authority',
      state: currentBootstrap,
      project: denied,
      routeProjectId: denied.projectId,
    },
    {
      name: 'stale projection',
      state: staleBootstrap,
      project: allowed,
      routeProjectId: allowed.projectId,
    },
  ] as const

  for (const value of cases) {
    let writes = 0
    const runtime = makeRuntime(
      makeRemote({
        states: Stream.make(value.state),
        openProject: () => Effect.succeed(value.project),
        projectEvidence: () => Effect.succeed(projectEvidence()),
        changeProject: () =>
          Effect.sync(() => {
            writes += 1
            return value.project
          }),
      }),
    )
    if (value.routeProjectId !== undefined) {
      await submit(runtime, {
        _tag: 'RouteChanged',
        route: {
          kind: 'process-project',
          projectId: value.routeProjectId,
        },
        libraryQuery: query(`process-${value.name}`),
      })
      if (value.project.projectId === value.routeProjectId)
        await waitFor(runtime, (state) => state.process.state === 'current')
    }
    const result = await submit(runtime, {
      _tag: 'Process',
      action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
    })
    await runtime.dispose()

    assert.equal(result._tag, 'Unavailable', value.name)
    assert.equal(writes, 0, value.name)
  }
})

test('stops incomplete or invalid semantic Process actions before transport', async () => {
  const current = semanticProcessProject()
  const withoutDevelop = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...current,
    stages: current.stages.filter((stage) => stage.stage !== 'Develop'),
  })
  const cases = [
    {
      name: 'missing Develop draft',
      project: withoutDevelop,
      action: ProcessAction.SyncDevelopPreview({}),
    },
    {
      name: 'missing matched saved Master evidence',
      project: current,
      action: ProcessAction.OpenSavedMasterInDevelop({}),
    },
    {
      name: 'invalid draft request',
      project: current,
      action: ProcessAction.ReplaceDraft({
        draft: {
          _tag: 'Develop',
          operation: {
            _tag: 'Stretch',
            method: 'asinh',
            amount: Number.POSITIVE_INFINITY,
          },
        },
      }),
    },
  ] as const satisfies ReadonlyArray<{
    readonly name: string
    readonly project: typeof OpenedProcessingProject.Type
    readonly action: ProcessAction
  }>

  for (const value of cases) {
    let writes = 0
    const runtime = makeRuntime(
      makeRemote({
        states: Stream.make(currentBootstrap),
        openProject: () => Effect.succeed(value.project),
        projectEvidence: () => Effect.succeed(projectEvidence()),
        changeProject: () =>
          Effect.sync(() => {
            writes += 1
            return value.project
          }),
      }),
    )
    await submit(runtime, {
      _tag: 'RouteChanged',
      route: {
        kind: 'process-project',
        projectId: value.project.projectId,
      },
      libraryQuery: query(`process-${value.name}`),
    })
    await waitFor(runtime, (state) => state.process.state === 'current')
    const result = await submit(runtime, {
      _tag: 'Process',
      action: value.action,
    })
    await runtime.dispose()

    assert.equal(result._tag, 'Unavailable', value.name)
    assert.equal(writes, 0, value.name)
  }
})

test('stops semantic Process actions while Project truth is loading or unavailable', async () => {
  const project = semanticProcessProject()
  const openStarted = Deferred.makeUnsafe<void>()
  const releaseOpen = Deferred.makeUnsafe<void>()
  let loadingWrites = 0
  const loadingRuntime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      openProject: () =>
        Deferred.succeed(openStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseOpen)),
          Effect.as(project),
        ),
      projectEvidence: () => Effect.succeed(projectEvidence()),
      changeProject: () =>
        Effect.sync(() => {
          loadingWrites += 1
          return project
        }),
    }),
  )
  await submit(loadingRuntime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: project.projectId },
    libraryQuery: query('process-loading'),
  })
  await loadingRuntime.runPromise(Deferred.await(openStarted))
  const loading = await submit(loadingRuntime, {
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
  })
  await loadingRuntime.dispose()

  let unavailableWrites = 0
  const unavailableRuntime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      openProject: () => Effect.fail(failure('open-project')),
      projectEvidence: () => Effect.succeed(projectEvidence()),
      changeProject: () =>
        Effect.sync(() => {
          unavailableWrites += 1
          return project
        }),
    }),
  )
  await submit(unavailableRuntime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: project.projectId },
    libraryQuery: query('process-unavailable'),
  })
  await waitFor(
    unavailableRuntime,
    (state) => state.process.state === 'unavailable',
  )
  const unavailableResult = await submit(unavailableRuntime, {
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
  })
  await unavailableRuntime.dispose()

  assert.equal(loading._tag, 'Unavailable')
  assert.equal(loadingWrites, 0)
  assert.equal(unavailableResult._tag, 'Unavailable')
  assert.equal(unavailableWrites, 0)
})

test('does not publish failed old-route Process reconciliation over a newer Project', async () => {
  const projectA = semanticProcessProject()
  const projectB = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...projectA,
    projectId: 'project-2',
    revision: 20,
    updatedAt: '2026-08-11T00:00:20.000Z',
  })
  const evidenceA = Schema.decodeUnknownSync(ProcessingProjectEvidence)({
    projectId: projectA.projectId,
    attempts: [],
  })
  const evidenceB = Schema.decodeUnknownSync(ProcessingProjectEvidence)({
    projectId: projectB.projectId,
    attempts: [],
  })
  const changeStarted = Deferred.makeUnsafe<void>()
  const releaseChange = Deferred.makeUnsafe<void>()
  let writes = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      openProject: (projectId) =>
        Effect.succeed(projectId === projectB.projectId ? projectB : projectA),
      projectEvidence: (projectId) =>
        Effect.succeed(
          projectId === projectB.projectId ? evidenceB : evidenceA,
        ),
      changeProject: () =>
        Effect.sync(() => {
          writes += 1
        }).pipe(
          Effect.andThen(Deferred.succeed(changeStarted, undefined)),
          Effect.andThen(Deferred.await(releaseChange)),
          Effect.andThen(Effect.fail(failure('change-project'))),
        ),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: projectA.projectId },
    libraryQuery: query('process-a'),
  })
  await waitFor(
    runtime,
    (state) => state.process.project?.projectId === projectA.projectId,
  )
  const oldChange = submit(runtime, {
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
  })
  await runtime.runPromise(Deferred.await(changeStarted))
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: projectB.projectId },
    libraryQuery: query('process-b'),
  })
  await waitFor(
    runtime,
    (state) => state.process.project?.projectId === projectB.projectId,
  )
  await runtime.runPromise(Deferred.succeed(releaseChange, undefined))
  const oldResult = await oldChange
  const final = await waitFor(
    runtime,
    (state) =>
      state.process.state === 'current' &&
      state.process.project?.projectId === projectB.projectId,
  )
  await runtime.dispose()

  assert.equal(oldResult._tag, 'Unavailable')
  assert.equal(final.process.project, projectB)
  assert.equal(final.process.evidence, evidenceB)
  assert.equal(writes, 1)
})

test('does not let an older same-route Process failure make a newer result unavailable', async () => {
  const confirmed = semanticProcessProject()
  const changed = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...confirmed,
    revision: 9,
    updatedAt: '2026-08-11T00:00:09.000Z',
  })
  const confirmedEvidence = projectEvidence()
  const changedEvidence = projectEvidence()
  const olderStarted = Deferred.makeUnsafe<void>()
  const newerStarted = Deferred.makeUnsafe<void>()
  const releaseOlder = Deferred.makeUnsafe<void>()
  const releaseNewer = Deferred.makeUnsafe<void>()
  let writes = 0
  let openCalls = 0
  let evidenceCalls = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      openProject: () =>
        ++openCalls === 1
          ? Effect.succeed(confirmed)
          : Effect.fail(failure('open-project')),
      projectEvidence: () =>
        ++evidenceCalls === 1
          ? Effect.succeed(confirmedEvidence)
          : evidenceCalls === 2
            ? Effect.succeed(changedEvidence)
            : Effect.fail(failure('project-evidence')),
      changeProject: () => {
        writes += 1
        return writes === 1
          ? Deferred.succeed(olderStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseOlder)),
              Effect.andThen(Effect.fail(failure('change-project'))),
            )
          : Deferred.succeed(newerStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseNewer)),
              Effect.as(changed),
            )
      },
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: confirmed.projectId },
    libraryQuery: query('process-overlap'),
  })
  await waitFor(runtime, (state) => state.process.project === confirmed)
  const older = submit(runtime, {
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
  })
  await runtime.runPromise(Deferred.await(olderStarted))
  const newer = submit(runtime, {
    _tag: 'Process',
    action: ProcessAction.RedoDraft({ stage: 'Calibration' }),
  })
  await runtime.runPromise(Deferred.await(newerStarted))
  await runtime.runPromise(Deferred.succeed(releaseNewer, undefined))
  const newerResult = await newer
  await waitFor(
    runtime,
    (state) => state.process.project?.revision === changed.revision,
  )
  await runtime.runPromise(Deferred.succeed(releaseOlder, undefined))
  const olderResult = await older
  const final = await waitFor(
    runtime,
    (state) =>
      state.process.state === 'current' &&
      state.process.project?.revision === changed.revision,
  )
  await runtime.dispose()

  assert.equal(newerResult._tag, 'Project')
  assert.equal(olderResult._tag, 'Unavailable')
  assert.equal(final.process.project, changed)
  assert.equal(final.process.evidence, changedEvidence)
  assert.equal(writes, 2)
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
      states: Stream.make(currentBootstrap),
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
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
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
      states: Stream.make(currentBootstrap),
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
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
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

test('keeps a newer bootstrap Process pair after an older write completes', async () => {
  const states = Effect.runSync(Queue.unbounded<BootstrapClientState>())
  const confirmed = semanticProcessProject()
  const changed = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...confirmed,
    revision: 8,
    updatedAt: '2026-08-11T00:00:08.000Z',
  })
  const refreshed = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...confirmed,
    revision: 9,
    updatedAt: '2026-08-11T00:00:09.000Z',
  })
  const confirmedEvidence = projectEvidence()
  const refreshedEvidence = semanticProcessEvidence()
  const changedEvidence = projectEvidence()
  const writeStarted = Deferred.makeUnsafe<void>()
  const releaseWrite = Deferred.makeUnsafe<void>()
  let openCalls = 0
  let evidenceCalls = 0
  let writes = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.fromQueue(states),
      openProject: () =>
        Effect.sync(() => (++openCalls === 1 ? confirmed : refreshed)),
      projectEvidence: () =>
        Effect.sync(() => {
          evidenceCalls += 1
          return evidenceCalls === 1
            ? confirmedEvidence
            : evidenceCalls === 2
              ? refreshedEvidence
              : changedEvidence
        }),
      changeProject: () =>
        Effect.sync(() => {
          writes += 1
        }).pipe(
          Effect.andThen(Deferred.succeed(writeStarted, undefined)),
          Effect.andThen(Deferred.await(releaseWrite)),
          Effect.as(changed),
        ),
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
    libraryQuery: query('process-bootstrap-wins'),
  })
  await waitFor(runtime, (state) => state.process.project === confirmed)
  const submission = submit(runtime, {
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
  })
  await runtime.runPromise(Deferred.await(writeStarted))
  await runtime.runPromise(
    Queue.offer(
      states,
      BootstrapClientState.Current({
        snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
          ...initialBootstrap,
          snapshotVersion: initialBootstrap.snapshotVersion + 1,
          eventCursor: initialBootstrap.eventCursor + 1,
        }),
      }),
    ),
  )
  await waitFor(runtime, (state) => state.process.project === refreshed)
  await runtime.runPromise(Deferred.succeed(releaseWrite, undefined))
  const result = await submission
  const final = await waitFor(
    runtime,
    (state) =>
      state.process.project === refreshed &&
      state.process.evidence === refreshedEvidence,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Project')
  assert.equal(final.process.project?.revision, 9)
  assert.equal(writes, 1)
  assert.equal(openCalls, 2)
  assert.equal(evidenceCalls, 3)
})

test('keeps a newer Process mutation after an older bootstrap load completes', async () => {
  const states = Effect.runSync(Queue.unbounded<BootstrapClientState>())
  const confirmed = semanticProcessProject()
  const loading = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...confirmed,
    revision: 8,
    updatedAt: '2026-08-11T00:00:08.000Z',
  })
  const changed = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...confirmed,
    revision: 9,
    updatedAt: '2026-08-11T00:00:09.000Z',
  })
  const confirmedEvidence = projectEvidence()
  const loadingEvidence = projectEvidence()
  const changedEvidence = semanticProcessEvidence()
  const loadStarted = Deferred.makeUnsafe<void>()
  const loadEvidenceStarted = Deferred.makeUnsafe<void>()
  const releaseLoad = Deferred.makeUnsafe<void>()
  let openCalls = 0
  let evidenceCalls = 0
  let writes = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.fromQueue(states),
      openProject: () => {
        openCalls += 1
        return openCalls === 1
          ? Effect.succeed(confirmed)
          : Deferred.succeed(loadStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseLoad)),
              Effect.as(loading),
            )
      },
      projectEvidence: () => {
        evidenceCalls += 1
        if (evidenceCalls === 1) return Effect.succeed(confirmedEvidence)
        if (evidenceCalls === 2)
          return Deferred.succeed(loadEvidenceStarted, undefined).pipe(
            Effect.as(loadingEvidence),
          )
        return Effect.succeed(changedEvidence)
      },
      changeProject: () =>
        Effect.sync(() => {
          writes += 1
          return changed
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
    libraryQuery: query('process-mutation-wins'),
  })
  await waitFor(runtime, (state) => state.process.project === confirmed)
  await runtime.runPromise(
    Queue.offer(
      states,
      BootstrapClientState.Current({
        snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
          ...initialBootstrap,
          snapshotVersion: initialBootstrap.snapshotVersion + 1,
          eventCursor: initialBootstrap.eventCursor + 1,
        }),
      }),
    ),
  )
  await runtime.runPromise(
    Effect.all([
      Deferred.await(loadStarted),
      Deferred.await(loadEvidenceStarted),
    ]),
  )
  const result = await submit(runtime, {
    _tag: 'Process',
    action: ProcessAction.RedoDraft({ stage: 'Calibration' }),
  })
  await waitFor(runtime, (state) => state.process.project === changed)
  await runtime.runPromise(Deferred.succeed(releaseLoad, undefined))
  const final = await waitFor(
    runtime,
    (state) =>
      state.process.project === changed &&
      state.process.evidence === changedEvidence,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Project')
  assert.equal(final.process.project?.revision, 9)
  assert.equal(writes, 1)
  assert.equal(openCalls, 2)
  assert.equal(evidenceCalls, 3)
})

test('reconciles the routed Project without publishing a mismatched change response', async () => {
  const confirmed = semanticProcessProject()
  const mismatched = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...confirmed,
    projectId: 'project-other',
    revision: 40,
    updatedAt: '2026-08-11T00:00:40.000Z',
  })
  const evidence = projectEvidence()
  let writes = 0
  let openCalls = 0
  const publishedProjectIds: Array<typeof ProcessingProjectId.Type> = []
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      openProject: () =>
        Effect.sync(() => {
          openCalls += 1
          return confirmed
        }),
      projectEvidence: () => Effect.succeed(evidence),
      changeProject: () =>
        Effect.sync(() => {
          writes += 1
          return mismatched
        }),
    }),
  )
  runtime.runFork(
    Effect.gen(function* () {
      const workspace = yield* NightbookWorkspaceRuntime
      yield* workspace.states.pipe(
        Stream.runForEach((state) =>
          Effect.sync(() => {
            if (state.process.project !== undefined)
              publishedProjectIds.push(state.process.project.projectId)
          }),
        ),
      )
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: confirmed.projectId },
    libraryQuery: query('process-mismatched-change'),
  })
  await waitFor(runtime, (state) => state.process.project === confirmed)
  const result = await submit(runtime, {
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
  })
  const final = await waitFor(
    runtime,
    (state) =>
      state.process.state === 'current' && state.process.project === confirmed,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Unavailable')
  assert.notEqual(final.process.project?.projectId, mismatched.projectId)
  assert.equal(publishedProjectIds.includes(mismatched.projectId), false)
  assert.equal(writes, 1)
  assert.equal(openCalls, 2)
})

test('reconciles matched truth without publishing mismatched changed evidence', async () => {
  const confirmed = semanticProcessProject()
  const changed = Schema.decodeUnknownSync(OpenedProcessingProject)({
    ...confirmed,
    revision: 8,
    updatedAt: '2026-08-11T00:00:08.000Z',
  })
  const confirmedEvidence = projectEvidence()
  const mismatchedEvidence = Schema.decodeUnknownSync(
    ProcessingProjectEvidence,
  )({ projectId: 'project-other', attempts: [] })
  const changedEvidence = semanticProcessEvidence()
  let evidenceCalls = 0
  let openCalls = 0
  let writes = 0
  const publishedEvidenceIds: Array<typeof ProcessingProjectId.Type> = []
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      openProject: () =>
        Effect.sync(() => (++openCalls === 1 ? confirmed : changed)),
      projectEvidence: () =>
        Effect.sync(() => {
          evidenceCalls += 1
          return evidenceCalls === 1
            ? confirmedEvidence
            : evidenceCalls === 2
              ? mismatchedEvidence
              : changedEvidence
        }),
      changeProject: () =>
        Effect.sync(() => {
          writes += 1
          return changed
        }),
    }),
  )
  runtime.runFork(
    Effect.gen(function* () {
      const workspace = yield* NightbookWorkspaceRuntime
      yield* workspace.states.pipe(
        Stream.runForEach((state) =>
          Effect.sync(() => {
            if (state.process.evidence !== undefined)
              publishedEvidenceIds.push(state.process.evidence.projectId)
          }),
        ),
      )
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: confirmed.projectId },
    libraryQuery: query('process-mismatched-evidence'),
  })
  await waitFor(runtime, (state) => state.process.project === confirmed)
  const result = await submit(runtime, {
    _tag: 'Process',
    action: ProcessAction.UndoDraft({ stage: 'Calibration' }),
  })
  const final = await waitFor(
    runtime,
    (state) =>
      state.process.project === changed &&
      state.process.evidence === changedEvidence,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Project')
  assert.notEqual(
    final.process.evidence?.projectId,
    mismatchedEvidence.projectId,
  )
  assert.equal(
    publishedEvidenceIds.includes(mismatchedEvidence.projectId),
    false,
  )
  assert.equal(writes, 1)
  assert.equal(openCalls, 2)
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

test('submits sequential semantic current-Asset reviews with fresh identities and no optimistic state', async () => {
  const reviewedDetail = Schema.decodeUnknownSync(LibraryAssetDetail)({
    ...detail,
    revision: 7,
    review: {
      revision: 3,
      decision: 'unreviewed',
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
  })
  const firstStarted = Effect.runSync(Deferred.make<void>())
  const releaseFirst = Effect.runSync(Deferred.make<void>())
  const secondStarted = Effect.runSync(Deferred.make<void>())
  const releaseSecond = Effect.runSync(Deferred.make<void>())
  const requests: Array<ReviewAssetRequest> = []
  let reviewCalls = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      page: () => Effect.succeed(page('review', 1)),
      listProjects: () => Effect.succeed([]),
      detail: () => Effect.succeed(reviewedDetail),
      review: (_assetId, request) =>
        Effect.gen(function* () {
          reviewCalls += 1
          requests.push(request)
          if (reviewCalls === 1) {
            yield* Deferred.succeed(firstStarted, undefined)
            yield* Deferred.await(releaseFirst)
            return {
              revision: AssetRevision.make(4),
              decision: 'accepted' as const,
              rating: 4,
              annotation: 'Clean stars.',
              updatedAt: '2026-08-11T00:00:01.000Z',
            }
          }
          yield* Deferred.succeed(secondStarted, undefined)
          yield* Deferred.await(releaseSecond)
          return {
            revision: AssetRevision.make(5),
            decision: 'rejected' as const,
            annotation: 'Tracking trail.',
            updatedAt: '2026-08-11T00:00:02.000Z',
          }
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'asset', assetId: reviewedDetail.assetId },
    libraryQuery: query('review'),
  })
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === reviewedDetail.assetId,
  )

  const firstReview = submit(runtime, {
    _tag: 'ReviewCurrentLibraryAsset',
    review: {
      decision: 'accepted',
      rating: 4,
      annotation: 'Clean stars.',
    },
  })
  await runtime.runPromise(Deferred.await(firstStarted))
  const firstPending = await waitFor(runtime, () => true)
  assert.equal(firstPending.libraryDetail.value?.review?.revision, 3)
  await runtime.runPromise(Deferred.succeed(releaseFirst, undefined))
  const firstResult = await firstReview
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.review?.revision === 4,
  )

  const secondReview = submit(runtime, {
    _tag: 'ReviewCurrentLibraryAsset',
    review: {
      decision: 'rejected',
      annotation: 'Tracking trail.',
    },
  })
  await runtime.runPromise(Deferred.await(secondStarted))
  const secondPending = await waitFor(runtime, () => true)
  assert.equal(secondPending.libraryDetail.value?.review?.revision, 4)
  await runtime.runPromise(Deferred.succeed(releaseSecond, undefined))
  const secondResult = await secondReview
  const rejected = await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.review?.revision === 5,
  )
  await runtime.dispose()

  assert.equal(firstResult._tag, 'Loaded')
  assert.equal(secondResult._tag, 'Loaded')
  assert.equal(reviewCalls, 2)
  assert.equal(requests.length, 2)
  assert.equal(requests[0]?.expectedAssetRevision, 7)
  assert.equal(requests[0]?.expectedReviewRevision, 3)
  assert.equal(requests[0]?.decision, 'accepted')
  assert.equal(requests[0]?.rating, 4)
  assert.equal(requests[0]?.annotation, 'Clean stars.')
  assert.equal(requests[1]?.expectedAssetRevision, 7)
  assert.equal(requests[1]?.expectedReviewRevision, 4)
  assert.equal(requests[1]?.decision, 'rejected')
  assert.equal(requests[1]?.annotation, 'Tracking trail.')
  const identities = requests.map(({ idempotencyKey }) => idempotencyKey)
  assert.equal(
    identities.every((identity) => identity.length > 0),
    true,
  )
  assert.equal(new Set(identities).size, 2)
  assert.equal(rejected.libraryDetail.value?.review?.decision, 'rejected')
})

test('stops malformed semantic review before transport with current routed truth', async () => {
  let reviewCalls = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      page: () => Effect.succeed(page('invalid-review', 1)),
      listProjects: () => Effect.succeed([]),
      detail: () => Effect.succeed(detail),
      review: () =>
        Effect.sync(() => {
          reviewCalls += 1
          return undefined
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'asset', assetId: detail.assetId },
    libraryQuery: query('invalid-review'),
  })
  await waitFor(
    runtime,
    (state) => state.libraryDetail.value?.assetId === detail.assetId,
  )
  const result = await submit(runtime, {
    _tag: 'ReviewCurrentLibraryAsset',
    review: { decision: 'accepted', rating: 6 },
  })
  await runtime.dispose()

  assert.equal(result._tag, 'Unavailable')
  assert.equal(reviewCalls, 0)
})

test('stops semantic review without current routed detail or mutation authority', async () => {
  const deniedBootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
      bootstrapFixtures.viewer,
    ),
  })
  const cases = [
    {
      name: 'no current Asset route',
      states: Stream.make(currentBootstrap),
      prepare: async (runtime: ReturnType<typeof makeRuntime>) => {
        await submit(runtime, {
          _tag: 'RouteChanged',
          route: { kind: 'workspace', workspace: 'library' },
          libraryQuery: query('library'),
        })
      },
      detail: () => Effect.succeed(detail),
    },
    {
      name: 'missing current detail',
      states: Stream.make(currentBootstrap),
      prepare: async (runtime: ReturnType<typeof makeRuntime>) => {
        await submit(runtime, {
          _tag: 'RouteChanged',
          route: { kind: 'asset', assetId: detail.assetId },
          libraryQuery: query('missing'),
        })
        await waitFor(
          runtime,
          (state) => state.libraryDetail.state === 'unavailable',
        )
      },
      detail: () => Effect.fail(failure('detail')),
    },
    {
      name: 'mismatched current detail',
      states: Stream.make(currentBootstrap),
      prepare: async (runtime: ReturnType<typeof makeRuntime>) => {
        await submit(runtime, {
          _tag: 'RouteChanged',
          route: { kind: 'asset', assetId: detail.assetId },
          libraryQuery: query('mismatch'),
        })
        await waitFor(
          runtime,
          (state) => state.libraryDetail.value !== undefined,
        )
      },
      detail: () => Effect.succeed(assetDetail('different-asset')),
    },
    {
      name: 'denied mutation authority',
      states: Stream.make(deniedBootstrap),
      prepare: async (runtime: ReturnType<typeof makeRuntime>) => {
        await submit(runtime, {
          _tag: 'RouteChanged',
          route: { kind: 'asset', assetId: detail.assetId },
          libraryQuery: query('denied'),
        })
        await waitFor(
          runtime,
          (state) => state.libraryDetail.value?.assetId === detail.assetId,
        )
      },
      detail: () => Effect.succeed(detail),
    },
  ]

  for (const value of cases) {
    let reviewCalls = 0
    const runtime = makeRuntime(
      makeRemote({
        states: value.states,
        page: () => Effect.succeed(page(value.name, 1)),
        listProjects: () => Effect.succeed([]),
        detail: value.detail,
        review: () =>
          Effect.sync(() => {
            reviewCalls += 1
            return undefined
          }),
      }),
    )
    await value.prepare(runtime)
    const result = await submit(runtime, {
      _tag: 'ReviewCurrentLibraryAsset',
      review: { decision: 'accepted' },
    })
    await runtime.dispose()

    assert.equal(result._tag, 'Unavailable', value.name)
    assert.equal(reviewCalls, 0, value.name)
  }
})

test('submits semantic existing-Project intake once with current revision and fresh identity without optimistic state', async () => {
  const listed = projects('project-1')[0]
  assert.notEqual(listed, undefined)
  if (listed === undefined) return
  const destination = {
    ...listed,
    revision: ProcessingProjectRevision.make(9),
  } satisfies ProcessingProjectList[number]
  const selection = {
    assetIds: [detail.assetId],
    captureSetIds: [CaptureSetId.make('capture-set-1')],
  }
  const requests: Array<typeof ProcessingProjectChangeRequest.Type> = []
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      page: () => Effect.succeed(page('intake', 1)),
      listProjects: () => Effect.succeed([destination]),
      addProjectSources: (request) =>
        Effect.sync(() => {
          requests.push(
            Schema.decodeUnknownSync(ProcessingProjectChangeRequest)(request),
          )
          return openedProject(10)
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('intake'),
  })
  const current = await waitFor(
    runtime,
    (state) =>
      state.process.state === 'current' &&
      state.process.projects[0]?.revision === destination.revision,
  )
  const result = await submit(runtime, {
    _tag: 'AddProjectSources',
    projectId: destination.projectId,
    selection,
  })
  const after = await waitFor(
    runtime,
    (state) => state.process.state === 'current',
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Project')
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.projectId, destination.projectId)
  assert.equal(requests[0]?.expectedProjectRevision, 9)
  assert.notEqual(requests[0]?.intentId, '')
  assert.deepEqual(requests[0]?.intent, { _tag: 'AddSources', selection })
  assert.equal(current.process.project, undefined)
  assert.equal(after.process.project, undefined)
})

test('creates a distinct identity for each semantic existing-Project intake', async () => {
  const destination = projects('project-1')[0]
  assert.notEqual(destination, undefined)
  if (destination === undefined) return
  const identities: string[] = []
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      page: () => Effect.succeed(page('intake-identities', 1)),
      listProjects: () => Effect.succeed([destination]),
      addProjectSources: (request) =>
        Effect.sync(() => {
          identities.push(request.intentId)
          return openedProject(2)
        }),
    }),
  )
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('intake-identities'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.process.state === 'current' && state.process.projects.length === 1,
  )
  const intent = NightbookWorkspaceIntent.AddProjectSources({
    projectId: destination.projectId,
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })

  await submit(runtime, intent)
  await submit(runtime, intent)
  await runtime.dispose()

  assert.equal(identities.length, 2)
  assert.notEqual(identities[0], '')
  assert.notEqual(identities[1], '')
  assert.notEqual(identities[0], identities[1])
})

test('stops invalid semantic existing-Project intake before transport', async () => {
  const destination = projects('project-1')[0]
  assert.notEqual(destination, undefined)
  if (destination === undefined) return
  let writes = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      page: () => Effect.succeed(page('invalid-intake', 1)),
      listProjects: () => Effect.succeed([destination]),
      addProjectSources: () =>
        Effect.sync(() => {
          writes += 1
          return openedProject(2)
        }),
    }),
  )
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('invalid-intake'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.process.state === 'current' && state.process.projects.length === 1,
  )
  const result = await submit(runtime, {
    _tag: 'AddProjectSources',
    projectId: destination.projectId,
    selection: { assetIds: [], captureSetIds: [] },
  })
  await runtime.dispose()

  assert.equal(result._tag, 'Unavailable')
  assert.equal(writes, 0)
})

test('stops semantic existing-Project intake without current destination truth or authority', async () => {
  const destination = projects('project-1')[0]
  assert.notEqual(destination, undefined)
  if (destination === undefined) return
  const deniedBootstrap = BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
      bootstrapFixtures.viewer,
    ),
  })
  const staleBootstrap = BootstrapClientState.Stale({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
      bootstrapFixtures.fresh,
    ),
    reason: 'Project projection is stale.',
  })
  const loadingList = await Effect.runPromise(Deferred.make<void>())
  const cases = [
    {
      name: 'destination missing',
      states: Stream.make(currentBootstrap),
      listProjects: () => Effect.succeed([]),
      ready: (state: NightbookWorkspaceState) =>
        state.projectionReceived && state.process.state === 'current',
      release: () => Effect.void,
    },
    {
      name: 'Project list loading',
      states: Stream.make(currentBootstrap),
      listProjects: () =>
        Deferred.await(loadingList).pipe(Effect.as([destination])),
      ready: (state: NightbookWorkspaceState) =>
        state.projectionReceived && state.process.state === 'loading',
      release: () => Deferred.succeed(loadingList, undefined),
    },
    {
      name: 'Project list unavailable',
      states: Stream.make(currentBootstrap),
      listProjects: () => Effect.fail(failure('list-projects')),
      ready: (state: NightbookWorkspaceState) =>
        state.projectionReceived && state.process.state === 'unavailable',
      release: () => Effect.void,
    },
    {
      name: 'stale projection',
      states: Stream.make(staleBootstrap),
      listProjects: () => Effect.succeed([destination]),
      ready: (state: NightbookWorkspaceState) =>
        state.projectionReceived &&
        state.process.state === 'current' &&
        state.process.projects.length === 1,
      release: () => Effect.void,
    },
    {
      name: 'mutation authority denied',
      states: Stream.make(deniedBootstrap),
      listProjects: () => Effect.succeed([destination]),
      ready: (state: NightbookWorkspaceState) =>
        state.projectionReceived &&
        state.process.state === 'current' &&
        state.process.projects.length === 1,
      release: () => Effect.void,
    },
  ]

  for (const value of cases) {
    let writes = 0
    const runtime = makeRuntime(
      makeRemote({
        states: value.states,
        page: () => Effect.succeed(page(value.name, 1)),
        listProjects: value.listProjects,
        addProjectSources: () =>
          Effect.sync(() => {
            writes += 1
            return openedProject(2)
          }),
      }),
    )
    await submit(runtime, {
      _tag: 'RouteChanged',
      route: { kind: 'workspace', workspace: 'library' },
      libraryQuery: query(value.name),
    })
    await waitFor(runtime, value.ready)
    const result = await submit(runtime, {
      _tag: 'AddProjectSources',
      projectId: destination.projectId,
      selection: { assetIds: [detail.assetId], captureSetIds: [] },
    })
    await runtime.runPromise(value.release())
    await runtime.dispose()

    assert.equal(result._tag, 'Unavailable', value.name)
    assert.equal(writes, 0, value.name)
  }
})

test('does not publish failed old-route intake reconciliation over a newer Project', async () => {
  const destination = projects('project-1')[0]
  assert.notEqual(destination, undefined)
  if (destination === undefined) return
  const projectA = openedProject(1)
  const projectB = {
    ...openedProject(2),
    projectId: ProcessingProjectId.make('project-b'),
    name: 'M31',
  }
  const evidenceA = projectEvidence()
  const evidenceB = {
    ...projectEvidence(),
    projectId: ProcessingProjectId.make('project-b'),
  }
  const addStarted = Effect.runSync(Deferred.make<void>())
  const releaseAdd = Effect.runSync(Deferred.make<void>())
  const openAStarted = Effect.runSync(Deferred.make<void>())
  const evidenceAStarted = Effect.runSync(Deferred.make<void>())
  const releaseAReads = Effect.runSync(Deferred.make<void>())
  let addWrites = 0
  const runtime = makeRuntime(
    makeRemote({
      states: Stream.make(currentBootstrap),
      page: () => Effect.succeed(page('route-safe-intake', 1)),
      listProjects: () => Effect.succeed([destination]),
      addProjectSources: () =>
        Effect.gen(function* () {
          addWrites += 1
          yield* Deferred.succeed(addStarted, undefined)
          yield* Deferred.await(releaseAdd)
          return yield* Effect.fail(failure('add-project-sources'))
        }),
      openProject: (projectId) =>
        projectId === projectB.projectId
          ? Effect.succeed(projectB)
          : Effect.gen(function* () {
              yield* Deferred.succeed(openAStarted, undefined)
              yield* Deferred.await(releaseAReads)
              return projectA
            }),
      projectEvidence: (projectId) =>
        projectId === projectB.projectId
          ? Effect.succeed(evidenceB)
          : Effect.gen(function* () {
              yield* Deferred.succeed(evidenceAStarted, undefined)
              yield* Deferred.await(releaseAReads)
              return evidenceA
            }),
    }),
  )
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('route-safe-intake'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.process.state === 'current' && state.process.projects.length === 1,
  )

  const addResult = submit(runtime, {
    _tag: 'AddProjectSources',
    projectId: destination.projectId,
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  await runtime.runPromise(Deferred.await(addStarted))
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: projectB.projectId },
    libraryQuery: query('project-b'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.process.project?.projectId === projectB.projectId &&
      state.process.evidence?.projectId === projectB.projectId,
  )
  await runtime.runPromise(Deferred.succeed(releaseAdd, undefined))
  await runtime.runPromise(
    Effect.all([
      Deferred.await(openAStarted),
      Deferred.await(evidenceAStarted),
    ]),
  )
  await runtime.runPromise(Deferred.succeed(releaseAReads, undefined))
  const result = await addResult
  const final = await waitFor(
    runtime,
    (state) =>
      state.process.project?.projectId === projectB.projectId &&
      state.process.evidence?.projectId === projectB.projectId,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Unavailable')
  assert.equal(addWrites, 1)
  assert.equal(final.process.state, 'current')
  assert.equal(final.process.project?.projectId, projectB.projectId)
  assert.equal(final.process.evidence?.projectId, projectB.projectId)
})

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
      states: Stream.make(currentBootstrap),
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
    _tag: 'ReviewCurrentLibraryAsset',
    review: { decision: 'accepted' },
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
      states: Stream.make(currentBootstrap),
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
    _tag: 'ReviewCurrentLibraryAsset',
    review: { decision: 'accepted' },
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
      states: Stream.make(currentBootstrap),
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
    _tag: 'ReviewCurrentLibraryAsset',
    review: { decision: 'accepted' },
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
      states: Stream.make(currentBootstrap),
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
    _tag: 'ReviewCurrentLibraryAsset',
    review: { decision: 'accepted' },
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
      states: Stream.make(currentBootstrap),
      page: () => Effect.succeed(page('library', 1)),
      listProjects: () => Effect.succeed([]),
      detail: () => Effect.succeed(asset),
      review: () =>
        Effect.gen(function* () {
          reviewCalls += 1
          const isOlder = reviewCalls === 1
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
    _tag: 'ReviewCurrentLibraryAsset',
    review: { decision: 'rejected' },
  })
  await runtime.runPromise(Deferred.await(olderStarted))
  const newerResult = submit(runtime, {
    _tag: 'ReviewCurrentLibraryAsset',
    review: { decision: 'accepted' },
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
