import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BootstrapHttpSuccessEnvelope,
  LibraryAssetDetail,
} from '@astro-console/protocol'
import { AcquireEvidence, AcquireSession } from '../services/acquire-domain.ts'
import { RunExecutionContext } from '../services/run-domain.ts'
import { Effect, Schema } from 'effect'
import {
  openOriginTestApplication,
  originTestDatabase,
} from './origin-test-graph.ts'
import { alpacaCameraProvider } from '../providers/alpaca-camera-provider.ts'
import { alpacaPreflightProvider } from '../providers/alpaca-preflight-provider.ts'
import { createAlpacaSimulator } from '../simulator/alpaca-simulator.ts'
import { ingestCapturedFrame } from '../services/captured-frame-intake.ts'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const corpusRoot = join(repositoryRoot, '.tmp/alpaca-simulation-corpus')
const required = [
  'm101-good-light.fits',
  'm101-clouded-light.fits',
  'ngc7000-first-light.fits',
  'ngc7000-dithered-light.fits',
]
const hasCorpus = required.every((filename) =>
  existsSync(join(corpusRoot, filename)),
)
const DetailRow = Schema.Struct({
  asset_id: Schema.String,
  detail: Schema.String,
})
const SolveBindingRow = Schema.Struct({ evidence: Schema.String })
const SolveBinding = Schema.Struct({ pixelPayloadSha256: Schema.String })
const ConfiguredSolveBinding = Schema.Struct({
  runId: Schema.String,
  sourceChecksum: Schema.String,
  pixelPayloadSha256: Schema.String,
})
const AcquireSessionRow = Schema.Struct({ session: Schema.String })
const SimulatorState = Schema.Struct({
  commandLog: Schema.Array(Schema.Struct({ name: Schema.String })),
  evidence: Schema.Struct({
    framesServed: Schema.Int,
    lastFrame: Schema.NullOr(Schema.Struct({ filename: Schema.String })),
  }),
})

test(
  'deep-sky simulation reaches explicit correction, later verification, retained Capture, and restart without replay',
  { skip: !hasCorpus },
  async (t) => {
    const fixture = await deepSkyFixture(t, 'target-evidence-progression')
    const mismatched = await fetch(`${fixture.base()}/api/simulation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'select', scenario: 'exposure-success' }),
    }).then((response) => response.json())
    assert.equal(mismatched.guide.driver._tag, 'Unavailable')
    assert.match(mismatched.guide.driver.reason, /--scenario=exposure-success/)
    await fetch(`${fixture.base()}/api/simulation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'select',
        scenario: 'target-evidence-progression',
      }),
    })
    let snapshot = await fixture.start('target-success')
    assert.equal(snapshot.observe?.phase, 'acquire')
    assert.equal(snapshot.observe?.acquire?.phase, 'solving')

    const duplicateStatuses = await Promise.all(
      ['target-success-initial-a', 'target-success-initial-b'].map(
        (idempotencyKey) =>
          acquireResponse(fixture.base(), snapshot, {
            _tag: 'CaptureTargetAcquisitionEvidence',
            idempotencyKey,
          }).then((response) => response.status),
      ),
    )
    assert.equal(duplicateStatuses.filter((status) => status === 200).length, 1)
    assert.equal(
      duplicateStatuses.every(
        (status) => status === 200 || status === 409 || status === 503,
      ),
      true,
    )
    snapshot = await fixture.snapshot()
    assert.equal(snapshot.observe?.acquire?.phase, 'awaitingApproval')
    const proposal = snapshot.observe?.acquire?.pendingProposal
    assert.ok(proposal !== undefined)
    const magnitude = Math.hypot(
      proposal.correction.rightAscensionArcsec,
      proposal.correction.declinationArcsec,
    )
    assert.ok(magnitude > 5 && magnitude < 180)

    await acquire(fixture.base(), snapshot, {
      _tag: 'ApprovePointingCorrection',
      proposalId: proposal.proposalId,
      idempotencyKey: 'target-success-correction',
    })
    snapshot = await fixture.snapshot()
    assert.equal(snapshot.observe?.acquire?.phase, 'verifying')

    await acquire(fixture.base(), snapshot, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      idempotencyKey: 'target-success-verification',
    })
    await eventually(async () => {
      snapshot = await fixture.snapshot()
      assert.equal(snapshot.observe?.phase, 'capture')
      assert.equal(snapshot.observe?.acquire?.phase, 'completed')
      assert.equal(
        snapshot.observe?.executorWork?.find(
          (work) => work.kind === 'StartExposure',
        )?.state,
        'observing',
      )
    })

    await fetch(`${fixture.simulatorOrigin}/__sim/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ milliseconds: 121_000 }),
    })
    let finalAssetId = ''
    await eventually(async () => {
      snapshot = await fixture.snapshot()
      assert.equal(snapshot.observe?.phase, 'completed')
      finalAssetId = snapshot.observe?.latestCapturedAssetId ?? ''
      assert.notEqual(finalAssetId, '')
    })
    const detail = Schema.decodeUnknownSync(LibraryAssetDetail)(
      await fetch(`${fixture.base()}/api/library/assets/${finalAssetId}`).then(
        (response) => response.json(),
      ),
    )
    assert.equal(detail.capture?.exposureSeconds, 120)
    assert.equal(detail.inspection?._tag, 'Available')
    const finalBytes = await readFile(
      join(fixture.originalsRoot, `${finalAssetId}.cameraRaw`),
    )
    const finalPixelSha = createHash('sha256')
      .update(finalBytes.subarray(44))
      .digest('hex')
    assert.equal(
      finalPixelSha,
      '8ca691238864ace5b13d98de3bbda96dcf9b536b75ee0415d8ed2c4d836708a3',
    )
    assert.notEqual(
      finalPixelSha,
      '00c1ac20810456955dfb0cdf9f4632372b5a82b422e9328892168ae6c1bb843a',
    )
    const acquireAsset = Schema.decodeUnknownSync(DetailRow)(
      originTestDatabase(fixture.service)
        .prepare(
          "SELECT asset_id,detail FROM library_assets WHERE asset_id<>? AND role='original' ORDER BY captured_at LIMIT 1",
        )
        .get(finalAssetId),
    )
    const acquireDetailResponse = await fetch(
      `${fixture.base()}/api/library/assets/${acquireAsset.asset_id}`,
    )
    const acquireText = await acquireDetailResponse.text()
    assert.equal(acquireDetailResponse.status, 200, acquireText)
    const acquireDetail = Schema.decodeUnknownSync(LibraryAssetDetail)(
      JSON.parse(acquireText),
    )
    assert.equal(acquireDetail.provenance?.source, 'alpaca-imagearray')
    assert.deepEqual(
      Schema.decodeUnknownSync(Schema.Array(SolveBindingRow))(
        originTestDatabase(fixture.service)
          .prepare('SELECT evidence FROM plate_solve_runs ORDER BY rowid')
          .all(),
      ).map((row) =>
        Schema.decodeUnknownSync(SolveBinding)(JSON.parse(row.evidence)),
      ),
      [
        {
          pixelPayloadSha256:
            '00c1ac20810456955dfb0cdf9f4632372b5a82b422e9328892168ae6c1bb843a',
        },
        {
          pixelPayloadSha256:
            '8ca691238864ace5b13d98de3bbda96dcf9b536b75ee0415d8ed2c4d836708a3',
        },
      ],
    )
    const before = await simulatorState(fixture.simulatorOrigin)
    assert.deepEqual(
      before.commandLog.map(({ name }) => name),
      [
        'slewToCoordinates',
        'startExposure',
        'slewToCoordinates',
        'startExposure',
        'startExposure',
      ],
    )
    assert.equal(
      before.evidence.lastFrame?.filename,
      'ngc7000-dithered-light.fits',
    )
    await fixture.restart()
    snapshot = await fixture.snapshot()
    assert.equal(snapshot.observe?.phase, 'completed')
    assert.equal(snapshot.observe?.latestCapturedAssetId, finalAssetId)
    const after = await simulatorState(fixture.simulatorOrigin)
    assert.deepEqual(after.commandLog, before.commandLog)
  },
)

test(
  'a preclaimed target effect remains unavailable across restart without an Alpaca write',
  { skip: !hasCorpus },
  async (t) => {
    const fixture = await deepSkyFixture(t, 'target-evidence-progression')
    let snapshot = await fixture.start('target-preclaimed')
    if (snapshot.activeRun._tag !== 'Active')
      throw new Error('Run is unavailable.')
    const runId = snapshot.activeRun.run.runId
    originTestDatabase(fixture.service)
      .prepare('INSERT INTO acquire_work (attempt_id,state) VALUES (?,?)')
      .run(`${runId}:deepSkyPlateSolve-initial-1:slew`, 'claimed')
    const acquireRevision = snapshot.observe?.acquire?.revision
    const runRevision = snapshot.activeRun.run.revision
    let response = await acquireResponse(fixture.base(), snapshot, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      idempotencyKey: 'target-preclaimed-first',
    })
    assert.equal(response.status, 503)
    assert.deepEqual(
      (await simulatorState(fixture.simulatorOrigin)).commandLog,
      [],
    )
    await fixture.restart()
    snapshot = await fixture.snapshot()
    response = await acquireResponse(fixture.base(), snapshot, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      idempotencyKey: 'target-preclaimed-after-restart',
    })
    assert.equal(response.status, 503)
    assert.deepEqual(
      (await simulatorState(fixture.simulatorOrigin)).commandLog,
      [],
    )
    assert.equal(snapshot.observe?.acquire?.revision, acquireRevision)
    assert.equal(
      snapshot.activeRun._tag === 'Active'
        ? snapshot.activeRun.run.revision
        : undefined,
      runRevision,
    )
  },
)

test(
  'configured Acquire retains ImageBytes, invokes the local solver, and reconciles restart without replay',
  { skip: !hasCorpus },
  async (t) => {
    const solverInputs: string[] = []
    const centers = [
      [314.549719973157, 44.1274205290256],
      [314.553878955801, 44.1274120130098],
    ] as const
    const fixture = await deepSkyFixture(
      t,
      'target-evidence-progression',
      async ({ args }) => {
        const input = args.at(-1)
        if (input === undefined) throw new Error('Solver input is unavailable.')
        assert.ok(input.endsWith('retained-imagebytes.fits'))
        assert.equal(
          (await readFile(input)).subarray(0, 6).toString(),
          'SIMPLE',
        )
        solverInputs.push(input)
        const center = centers[solverInputs.length - 1]
        assert.ok(center !== undefined)
        return {
          exitCode: 0,
          stdout: `Field center: (${center[0]}, ${center[1]})`,
          stderr: '',
        }
      },
    )
    let snapshot = await fixture.start('configured-target')
    originTestDatabase(fixture.service)
      .prepare(
        'INSERT OR REPLACE INTO plate_solve_runs (attempt_id,source_asset_id,evidence) VALUES (?,?,?)',
      )
      .run(
        'deepSkyPlateSolve-initial-1',
        'asset-capture-prior-run',
        JSON.stringify({
          runId: 'run-from-prior-session',
          providerResult: { _tag: 'Aborted', summary: 'stale prior result' },
        }),
      )
    await acquire(fixture.base(), snapshot, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      idempotencyKey: 'configured-target-initial',
    })
    snapshot = await fixture.snapshot()
    assert.equal(snapshot.observe?.acquire?.phase, 'awaitingApproval')
    const proposal = snapshot.observe?.acquire?.pendingProposal
    assert.ok(proposal !== undefined)
    assert.ok(
      Math.hypot(
        proposal.correction.rightAscensionArcsec,
        proposal.correction.declinationArcsec,
      ) > 5,
    )
    await acquire(fixture.base(), snapshot, {
      _tag: 'ApprovePointingCorrection',
      proposalId: proposal.proposalId,
      idempotencyKey: 'configured-target-correction',
    })
    snapshot = await fixture.snapshot()
    await acquire(fixture.base(), snapshot, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      idempotencyKey: 'configured-target-verification',
    })
    await eventually(async () => {
      snapshot = await fixture.snapshot()
      assert.equal(snapshot.observe?.acquire?.phase, 'completed')
      assert.equal(snapshot.observe?.phase, 'capture')
      assert.equal(
        snapshot.observe?.executorWork?.find(
          (work) => work.kind === 'StartExposure',
        )?.state,
        'observing',
      )
    })
    assert.equal(solverInputs.length, 2)
    const retained = Schema.decodeUnknownSync(Schema.Array(DetailRow))(
      originTestDatabase(fixture.service)
        .prepare(
          "SELECT asset_id,detail FROM library_assets WHERE format='cameraRaw'",
        )
        .all(),
    )
    assert.equal(retained.length, 2)
    const bindings = Schema.decodeUnknownSync(Schema.Array(SolveBindingRow))(
      originTestDatabase(fixture.service)
        .prepare('SELECT evidence FROM plate_solve_runs ORDER BY rowid')
        .all(),
    ).map(({ evidence }) =>
      Schema.decodeUnknownSync(ConfiguredSolveBinding)(JSON.parse(evidence)),
    )
    assert.equal(bindings.length, 2)
    assert.equal(
      bindings.every(
        ({ runId }) =>
          runId ===
          (snapshot.activeRun._tag === 'Active'
            ? snapshot.activeRun.run.runId
            : ''),
      ),
      true,
    )
    assert.equal(
      bindings.every(({ sourceChecksum }) =>
        /^[a-f0-9]{64}$/.test(sourceChecksum),
      ),
      true,
    )
    assert.deepEqual(
      bindings.map(({ pixelPayloadSha256 }) => pixelPayloadSha256),
      [
        '00c1ac20810456955dfb0cdf9f4632372b5a82b422e9328892168ae6c1bb843a',
        '8ca691238864ace5b13d98de3bbda96dcf9b536b75ee0415d8ed2c4d836708a3',
      ],
    )
    await fetch(`${fixture.simulatorOrigin}/__sim/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ milliseconds: 121_000 }),
    })
    let finalAssetId = ''
    await eventually(async () => {
      snapshot = await fixture.snapshot()
      assert.equal(snapshot.observe?.phase, 'completed')
      finalAssetId = snapshot.observe?.latestCapturedAssetId ?? ''
      assert.notEqual(finalAssetId, '')
    })
    const finalBytes = await readFile(
      join(fixture.originalsRoot, `${finalAssetId}.cameraRaw`),
    )
    assert.equal(
      createHash('sha256').update(finalBytes.subarray(44)).digest('hex'),
      '8ca691238864ace5b13d98de3bbda96dcf9b536b75ee0415d8ed2c4d836708a3',
    )
    const before = await simulatorState(fixture.simulatorOrigin)
    await fixture.restart()
    snapshot = await fixture.snapshot()
    assert.equal(snapshot.observe?.acquire?.phase, 'completed')
    assert.equal(snapshot.observe?.phase, 'completed')
    assert.equal(snapshot.observe?.latestCapturedAssetId, finalAssetId)
    assert.deepEqual(
      (await simulatorState(fixture.simulatorOrigin)).commandLog,
      before.commandLog,
    )
  },
)

test(
  'configured Acquire reconciles a preclaimed slew with GET-only reads and never replays the PUT',
  { skip: !hasCorpus },
  async (t) => {
    const fixture = await deepSkyFixture(
      t,
      'target-evidence-progression',
      async () => ({ exitCode: 1, stdout: '', stderr: '' }),
    )
    let snapshot = await fixture.start('configured-preclaimed')
    if (snapshot.activeRun._tag !== 'Active')
      throw new Error('Run is unavailable.')
    const runId = snapshot.activeRun.run.runId
    originTestDatabase(fixture.service)
      .prepare(
        "INSERT INTO configured_acquire_work (effect_id,kind,payload,state) VALUES (?,?,?,'claimed')",
      )
      .run(
        `${runId}:deepSkyPlateSolve-initial-1:slew`,
        'slew',
        JSON.stringify({
          rightAscensionHours: 20.9702585970534,
          declinationDegrees: 44.1274120130098,
        }),
      )
    let response = await acquireResponse(fixture.base(), snapshot, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      idempotencyKey: 'configured-preclaimed-first',
    })
    assert.equal(response.status, 503)
    assert.deepEqual(
      (await simulatorState(fixture.simulatorOrigin)).commandLog,
      [],
    )
    await fixture.restart()
    snapshot = await fixture.snapshot()
    response = await acquireResponse(fixture.base(), snapshot, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      idempotencyKey: 'configured-preclaimed-restart',
    })
    assert.equal(response.status, 503)
    assert.deepEqual(
      (await simulatorState(fixture.simulatorOrigin)).commandLog,
      [],
    )
  },
)

test(
  'configured Acquire resumes a receipt-proven retained frame after the retrieval crash gap',
  { skip: !hasCorpus },
  async (t) => {
    const fixture = await deepSkyFixture(
      t,
      'target-evidence-progression',
      async () => ({
        exitCode: 0,
        stdout: 'Field center: (314.549719973157, 44.1274205290256)',
        stderr: '',
      }),
    )
    let snapshot = await fixture.start('configured-retained-gap')
    if (snapshot.activeRun._tag !== 'Active')
      throw new Error('Run is unavailable.')
    const runId = snapshot.activeRun.run.runId
    const attemptId = 'deepSkyPlateSolve-initial-1'
    const started = await fetch(
      `${fixture.simulatorOrigin}/api/v1/camera/0/startexposure`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: new URLSearchParams({ Duration: '5', Light: 'true' }),
      },
    )
    assert.equal(started.status, 200)
    await fetch(`${fixture.simulatorOrigin}/__sim/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ milliseconds: 6_000 }),
    })
    const imageResponse = await fetch(
      `${fixture.simulatorOrigin}/api/v1/camera/0/imagearray`,
      { headers: { accept: 'application/imagebytes' } },
    )
    const imageBuffer = await imageResponse.arrayBuffer()
    const image = new Uint8Array(imageBuffer)
    const digest = createHash('sha256')
      .update(`${runId}:${attemptId}`)
      .digest('hex')
      .slice(0, 32)
    const assetId = `asset-capture-${digest}`
    assert.equal(
      Effect.runSync(
        ingestCapturedFrame(
          { originalsRoot: fixture.originalsRoot },
          {
            assetId,
            frameId: `frame-${digest}`,
            capturedAt: '2026-08-09T12:00:00.000Z',
            format: 'cameraRaw',
            equipment: {
              rigId: 'simulated-deep-sky-rig',
              cameraDeviceId: 'sim-camera-asi2600mc-pro',
            },
            capture: {
              exposureSeconds: 5,
              filter: 'No filter',
              binning: 1,
              frameType: 'light',
            },
            lineage: {
              runId,
              sequenceId: 'sequence-ngc7000-acquire',
              acquisitionId: attemptId,
            },
            idempotencyKey: `configured-acquire:${runId}:${attemptId}`,
          },
          image,
        ).pipe(Effect.provide(fixture.service.context)),
      ).outcome,
      'accepted',
    )
    originTestDatabase(fixture.service)
      .prepare(
        "INSERT INTO configured_acquire_work (effect_id,kind,payload,state) VALUES (?,?,?,'retrieving')",
      )
      .run(
        `${runId}:${attemptId}:exposure`,
        'exposure',
        JSON.stringify({ durationSeconds: 5 }),
      )
    const before = await simulatorState(fixture.simulatorOrigin)
    assert.equal(before.evidence.framesServed, 1)
    await fixture.restart()
    snapshot = await fixture.snapshot()
    await acquire(fixture.base(), snapshot, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      idempotencyKey: 'configured-retained-gap-resume',
    })
    const after = await simulatorState(fixture.simulatorOrigin)
    assert.equal(after.evidence.framesServed, 1)
    assert.deepEqual(
      after.commandLog.map(({ name }) => name),
      ['startExposure', 'slewToCoordinates'],
    )
    assert.equal(
      (await fixture.snapshot()).observe?.acquire?.phase,
      'awaitingApproval',
    )
  },
)

test(
  'clouded evidence enters Recover and one changed solve series reaches Capture',
  { skip: !hasCorpus },
  async (t) => {
    const fixture = await deepSkyFixture(t, 'solve-success-no-solution')
    let snapshot = await fixture.start('target-recovery')
    for (const suffix of ['one', 'two']) {
      await acquire(fixture.base(), snapshot, {
        _tag: 'CaptureTargetAcquisitionEvidence',
        idempotencyKey: `target-recovery-${suffix}`,
      })
      snapshot = await fixture.snapshot()
    }
    assert.equal(snapshot.observe?.acquire?.phase, 'paused')
    assert.equal(
      snapshot.observe?.acquire?.recovery?.remainingRecoverySeries,
      1,
    )
    const pausedAcquireRevision = snapshot.observe?.acquire?.revision
    const pausedRunRevision =
      snapshot.activeRun._tag === 'Active'
        ? snapshot.activeRun.run.revision
        : undefined
    for (const action of ['SkipAcquireTarget', 'AbortAcquire'] as const) {
      const denied = await acquireResponse(fixture.base(), snapshot, {
        _tag: action,
        idempotencyKey: `target-recovery-denied-${action}`,
      })
      assert.equal(denied.status, 409)
    }
    snapshot = await fixture.snapshot()
    assert.equal(snapshot.observe?.acquire?.phase, 'paused')
    assert.equal(snapshot.observe?.acquire?.revision, pausedAcquireRevision)
    assert.equal(
      snapshot.activeRun._tag === 'Active'
        ? snapshot.activeRun.run.revision
        : undefined,
      pausedRunRevision,
    )
    assert.equal(
      snapshot.observe?.acquire?.actions.some(
        ({ action }) =>
          action === 'SkipAcquireTarget' || action === 'AbortAcquire',
      ),
      false,
    )

    await acquire(fixture.base(), snapshot, {
      _tag: 'RetryPlateSolveWithParameters',
      parameters: {
        exposureSeconds: 15,
        binning: 1,
        solverProfile: 'deep-sky-recovery-15s',
      },
      idempotencyKey: 'target-recovery-series',
    })
    snapshot = await fixture.snapshot()
    assert.equal(snapshot.observe?.acquire?.phase, 'solving')
    await acquire(fixture.base(), snapshot, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      idempotencyKey: 'target-recovery-good-frame',
    })
    await eventually(async () => {
      snapshot = await fixture.snapshot()
      assert.equal(snapshot.observe?.acquire?.phase, 'completed')
      assert.equal(snapshot.observe?.phase, 'capture')
      assert.equal(
        snapshot.observe?.executorWork?.find(
          (work) => work.kind === 'StartExposure',
        )?.state,
        'observing',
      )
    })
    const storedSession = Schema.decodeUnknownSync(AcquireSession)(
      JSON.parse(
        Schema.decodeUnknownSync(AcquireSessionRow)(
          originTestDatabase(fixture.service)
            .prepare('SELECT session FROM acquire_sessions')
            .get(),
        ).session,
      ),
    )
    const slewAcknowledgements = storedSession.evidence.filter(
      AcquireEvidence.guards.TargetSlewAcknowledged,
    )
    assert.equal(slewAcknowledgements.length, 2)
    assert.equal(
      slewAcknowledgements[0]?.attemptId,
      'deepSkyPlateSolve-initial-1',
    )
    assert.match(slewAcknowledgements[1]?.attemptId ?? '', /^recovery-solve-/)
    assert.equal(
      slewAcknowledgements.some(({ attemptId }) =>
        attemptId.includes('-retry'),
      ),
      false,
    )
    assert.deepEqual(
      (await simulatorState(fixture.simulatorOrigin)).commandLog.map(
        ({ name }) => name,
      ),
      [
        'slewToCoordinates',
        'startExposure',
        'startExposure',
        'slewToCoordinates',
        'startExposure',
        'startExposure',
      ],
    )
  },
)

async function deepSkyFixture(
  t: TestContext,
  scenario: 'target-evidence-progression' | 'solve-success-no-solution',
  solveExecute?: NonNullable<
    import('../workers/plate-solve-worker.ts').PlateSolveWorkerConfig['execute']
  >,
) {
  const root = await mkdtemp(join(tmpdir(), `astro-${scenario}-`))
  const databasePath = join(root, 'state.sqlite')
  const originalsRoot = join(root, 'originals')
  const previewsRoot = join(root, 'previews')
  const simulator = createAlpacaSimulator({
    corpusRoot,
    initialScenario: scenario,
    autoAdvanceMsPerRequest: 1_000,
  })
  const simulatorListener = await simulator.listen()
  const providerConfig = {
    kind: 'alpaca' as const,
    rigId: 'simulated-deep-sky-rig',
    host: '127.0.0.1',
    port: simulatorListener.port,
    devices: {
      camera: {
        deviceNumber: 0,
        uniqueId: 'sim-camera-asi2600mc-pro',
      },
      telescope: {
        deviceNumber: 0,
        uniqueId: 'sim-telescope-am5n',
      },
      focuser: { deviceNumber: 0, uniqueId: 'sim-focuser-eafn' },
      filterWheel: { deviceNumber: 0, uniqueId: 'sim-filterwheel-0' },
    },
  }
  const camera = alpacaCameraProvider(providerConfig)
  const serviceOptions = {
    simulation: {
      origin: simulatorListener.origin,
      launchScenario: scenario,
      corpusRoot,
    },
    runExecutorProviderOrigin: simulatorListener.origin,
    runExecutionContext: RunExecutionContext.make({
      rigId: providerConfig.rigId,
      cameraDeviceId: 'sim-camera-asi2600mc-pro',
      mountDeviceId: 'sim-telescope-am5n',
      latitudeDegrees: 39.755,
      longitudeDegrees: -74.2677777778,
      elevationMeters: 0,
      completionBehavior: 'hold',
      unsafeBehavior: 'pauseAndPark',
    }),
    preflightProvider: alpacaPreflightProvider(providerConfig),
    cameraProvider: camera,
    capturedFrameStorage: { originalsRoot },
    frameInspectionStorage: { originalsRoot, previewsRoot },
    ...(solveExecute === undefined
      ? {}
      : {
          configuredTargetProvider: {
            ...providerConfig,
            site: {
              latitudeDegrees: 39.755,
              longitudeDegrees: -74.2677777778,
              elevationMeters: 0,
            },
          },
          plateSolveWorker: {
            originalsRoot,
            executable: '/usr/bin/solve-field',
            indexesRoot: '/var/lib/astro-console/astrometry-indexes',
            timeoutMs: 90_000,
            solverVersion: '0.93',
            scaleLowDeg: 20,
            scaleHighDeg: 30,
            searchRadiusDeg: 15,
            execute: solveExecute,
          },
        }),
  }
  let service = await openOriginTestApplication(
    databasePath,
    undefined,
    undefined,
    undefined,
    serviceOptions,
  )
  let listener = await service.listen()
  let origin = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close().catch(() => undefined)
    await service.close()
    await simulatorListener.close()
    await rm(root, { recursive: true, force: true })
  })
  return {
    get service() {
      return service
    },
    simulatorOrigin: simulatorListener.origin,
    originalsRoot,
    base: () => origin,
    snapshot: () => serviceSnapshot(origin),
    start: async (key: string) => {
      let snapshot = await serviceSnapshot(origin)
      if (snapshot.plan === undefined) throw new Error('Plan is unavailable.')
      const saveResponse = await fetch(`${origin}/api/plan/commands`, {
        method: 'POST',
        body: JSON.stringify({
          intent: {
            _tag: 'SaveDraft',
            planId: snapshot.plan.planId,
            expectedPlanRevision: snapshot.plan.revision,
            idempotencyKey: `${key}-save`,
            sequences: snapshot.plan.sequences.map(
              ({ viability: _viability, ...sequence }) => sequence,
            ),
          },
        }),
      })
      assert.equal(saveResponse.status, 202, await saveResponse.text())
      snapshot = await serviceSnapshot(origin)
      if (snapshot.plan === undefined) throw new Error('Plan is unavailable.')
      const plan = snapshot.plan
      const acceptResponse = await fetch(`${origin}/api/plan/commands`, {
        method: 'POST',
        body: JSON.stringify({
          intent: {
            _tag: 'AcceptRunDefinition',
            planId: plan.planId,
            expectedPlanRevision: plan.revision,
            expectedLeaseRevision: snapshot.control.revision,
            idempotencyKey: `${key}-accept`,
          },
        }),
      })
      assert.equal(acceptResponse.status, 202, await acceptResponse.text())
      snapshot = await serviceSnapshot(origin)
      assert.equal(
        (
          await fetch(`${origin}/api/commands/control`, {
            method: 'POST',
            body: JSON.stringify({
              commandId: `${key}-control`,
              command: {
                _tag: 'TakeControl',
                expectedLeaseRevision: snapshot.control.revision,
                idempotencyKey: `${key}-control`,
              },
            }),
          })
        ).status,
        202,
      )
      snapshot = await serviceSnapshot(origin)
      assert.equal(
        (
          await fetch(`${origin}/api/plan/commands`, {
            method: 'POST',
            body: JSON.stringify({
              intent: {
                _tag: 'StartAcceptedRun',
                planId: plan.planId,
                expectedPlanRevision: plan.revision,
                expectedLeaseRevision: snapshot.control.revision,
                idempotencyKey: `${key}-start`,
              },
            }),
          })
        ).status,
        202,
      )
      snapshot = await serviceSnapshot(origin)
      if (snapshot.activeRun._tag !== 'Active')
        throw new Error('Run is unavailable.')
      assert.equal(
        (
          await fetch(`${origin}/api/observe/preflight`, {
            method: 'POST',
            body: JSON.stringify({
              runId: snapshot.activeRun.run.runId,
              expectedRunRevision: snapshot.activeRun.run.revision,
            }),
          })
        ).status,
        200,
      )
      await eventually(async () => {
        snapshot = await serviceSnapshot(origin)
        assert.equal(snapshot.observe?.phase, 'acquire')
      })
      return snapshot
    },
    restart: async () => {
      await listener.close()
      await service.close()
      service = await openOriginTestApplication(
        databasePath,
        undefined,
        undefined,
        undefined,
        serviceOptions,
      )
      listener = await service.listen()
      origin = `http://127.0.0.1:${listener.port}`
    },
  }
}

async function acquire(
  base: string,
  snapshot: Awaited<ReturnType<typeof serviceSnapshot>>,
  input: Record<string, unknown>,
) {
  const response = await acquireResponse(base, snapshot, input)
  assert.equal(response.status, 200, await response.text())
}

async function acquireResponse(
  base: string,
  snapshot: Awaited<ReturnType<typeof serviceSnapshot>>,
  input: Record<string, unknown>,
) {
  if (
    snapshot.activeRun._tag !== 'Active' ||
    snapshot.observe?.acquire === undefined
  )
    throw new Error('Acquire is unavailable.')
  const response = await fetch(`${base}/api/acquire/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        ...input,
        expectedLeaseRevision: snapshot.control.revision,
        expectedRunRevision: snapshot.activeRun.run.revision,
        expectedAcquireRevision: snapshot.observe.acquire.revision,
      },
    }),
  })
  return response
}

async function serviceSnapshot(base: string) {
  const response = await fetch(`${base}/api/snapshot`)
  return Schema.decodeUnknownSync(BootstrapHttpSuccessEnvelope)(
    await response.json(),
  ).data
}

async function simulatorState(origin: string) {
  return Schema.decodeUnknownSync(SimulatorState)(
    await fetch(`${origin}/__sim/state`).then((response) => response.json()),
  )
}

async function eventually(assertion: () => Promise<void>) {
  let cause: unknown
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      await assertion()
      return
    } catch (error) {
      cause = error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw cause
}
