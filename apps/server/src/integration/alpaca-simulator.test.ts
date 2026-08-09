import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BootstrapHttpSuccessEnvelope,
  CameraExposureObservation,
  LibraryAssetDetail,
  PreflightSnapshot,
  RunExecutionContext,
} from '@astro-console/v2-contracts'
import { Effect, Schema } from 'effect'
import { createLocalWebService } from '../app/origin-service.ts'
import { alpacaCameraProvider } from '../providers/alpaca-camera-provider.ts'
import { alpacaPreflightProvider } from '../providers/alpaca-preflight-provider.ts'
import {
  fitsToAlpacaImageBytes,
  readAlpacaImageBytesMetadata,
  readFitsImageFacts,
} from '../simulator/alpaca-imagebytes.ts'
import {
  createAlpacaSimulator,
  type AlpacaScenarioFrame,
  type AlpacaSimulationScenario,
} from '../simulator/alpaca-simulator.ts'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const preparedRealFrame = join(
  repositoryRoot,
  '.tmp/alpaca-simulation-corpus/m101-good-light.fits',
)
const preparedCorpusRoot = dirname(preparedRealFrame)
const preparedEvidenceFiles = [
  'm101-good-light.fits',
  'm101-clouded-light.fits',
  'ngc7000-first-light.fits',
  'ngc7000-dithered-light.fits',
  'ngc7000-frame-quality.csv',
]

test('FITS pixels become metadata-v1 UInt16 ImageBytes in ASCOM array order', () => {
  const fits = testFits(2, 3, [1, 2, 3, 4, 5, 6])
  const encoded = fitsToAlpacaImageBytes(fits, {
    clientTransactionId: 17,
    serverTransactionId: 29,
  })
  assert.deepEqual(encoded.fits, {
    width: 2,
    height: 3,
    bitpix: 16,
    dataStart: 2880,
    bscale: 1,
    bzero: 0,
  })
  assert.deepEqual(readAlpacaImageBytesMetadata(encoded.bytes), {
    metadataVersion: 1,
    errorNumber: 0,
    clientTransactionId: 17,
    serverTransactionId: 29,
    dataStart: 44,
    imageElementType: 2,
    transmissionElementType: 8,
    rank: 2,
    dimension1: 2,
    dimension2: 3,
    dimension3: 0,
  })
  const view = new DataView(encoded.bytes.buffer)
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) =>
      view.getUint16(44 + index * 2, true),
    ),
    [1, 3, 5, 2, 4, 6],
  )
})

test(
  'the prepared checksum-pinned M101 frame produces full-size standards-shaped ImageBytes',
  { skip: !existsSync(preparedRealFrame) },
  async (t) => {
    const frame = await readFile(preparedRealFrame)
    assert.equal(
      createHash('sha256').update(frame).digest('hex'),
      '3d4abc598e2168bddf9d43d7ce9acad788e5c288a7e6bc211013eea31d9d9e24',
    )
    const facts = readFitsImageFacts(frame)
    assert.deepEqual(
      { width: facts.width, height: facts.height, bitpix: facts.bitpix },
      { width: 6024, height: 4024, bitpix: 16 },
    )
    const simulator = createAlpacaSimulator({
      corpusRoot: dirname(preparedRealFrame),
    })
    const listener = await simulator.listen()
    t.after(listener.close)
    const camera = cameraProvider(listener.port)
    await Effect.runPromise(camera.startExposure(0.001))
    const advanced = await fetch(`${listener.origin}/__sim/advance`, {
      method: 'POST',
      body: JSON.stringify({ milliseconds: 1001 }),
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(advanced.status, 200)
    const image = await Effect.runPromise(
      camera.readImageArray?.() ?? Effect.die('missing image reader'),
    )
    const metadata = readAlpacaImageBytesMetadata(image.bytes)
    assert.equal(metadata.dimension1, 6024)
    assert.equal(metadata.dimension2, 4024)
    assert.equal(image.bytes.byteLength, 44 + 6024 * 4024 * 2)
  },
)

test(
  'the supervised simulator exposure reaches retained Library review and does not replay after restart',
  { skip: !existsSync(preparedRealFrame) },
  async (t) => {
    const root = await mkdtemp(
      join(tmpdir(), 'astro-simulated-observe-library-'),
    )
    const databasePath = join(root, 'state.sqlite')
    const originalsRoot = join(root, 'originals')
    const previewsRoot = join(root, 'previews')
    const simulator = createAlpacaSimulator({
      corpusRoot: preparedCorpusRoot,
      initialScenario: 'exposure-success',
    })
    const simulatorListener = await simulator.listen()
    const providerConfig = {
      kind: 'alpaca' as const,
      rigId: 'simulated-m101-rig',
      host: '127.0.0.1',
      port: simulatorListener.port,
      devices: {
        camera: {
          deviceNumber: 0,
          uniqueId: 'sim-camera-asi2600mc-pro',
        },
      },
    }
    const camera = alpacaCameraProvider(providerConfig)
    const executionContext = RunExecutionContext.make({
      rigId: providerConfig.rigId,
      cameraDeviceId: 'sim-camera-asi2600mc-pro',
      completionBehavior: 'hold',
      unsafeBehavior: 'pauseAndPark',
    })
    const serviceOptions = {
      simulation: {
        origin: simulatorListener.origin,
        launchScenario: 'exposure-success' as const,
      },
      runExecutorProviderOrigin: simulatorListener.origin,
      runExecutionContext: executionContext,
      preflightProvider: alpacaPreflightProvider(providerConfig),
      cameraProvider: camera,
      capturedFrameStorage: { originalsRoot },
      frameInspectionStorage: { originalsRoot, previewsRoot },
    }
    let service = createLocalWebService(
      databasePath,
      undefined,
      undefined,
      undefined,
      serviceOptions,
    )
    let serviceListener = await service.listen()
    t.after(async () => {
      await serviceListener.close().catch(() => undefined)
      service.close()
      await simulatorListener.close()
      await rm(root, { recursive: true, force: true })
    })
    let base = `http://127.0.0.1:${serviceListener.port}`
    const initial = await serviceSnapshot(base)
    if (initial.plan === undefined)
      throw new Error('The simulated Observe fixture has no Plan.')
    const accept = await fetch(`${base}/api/plan/commands`, {
      method: 'POST',
      body: JSON.stringify({
        intent: {
          _tag: 'AcceptRunDefinition',
          planId: initial.plan.planId,
          expectedPlanRevision: initial.plan.revision,
          expectedLeaseRevision: initial.control.revision,
          idempotencyKey: 'simulated-m101-accept',
        },
      }),
    })
    assert.equal(accept.status, 202)
    const accepted = await serviceSnapshot(base)
    if (accepted.plan === undefined)
      throw new Error('The accepted simulated Plan is unavailable.')
    const control = await fetch(`${base}/api/commands/control`, {
      method: 'POST',
      body: JSON.stringify({
        commandId: 'simulated-m101-control',
        command: {
          _tag: 'TakeControl',
          expectedLeaseRevision: accepted.control.revision,
          idempotencyKey: 'simulated-m101-control',
        },
      }),
    })
    assert.equal(control.status, 202)
    const controlled = await serviceSnapshot(base)
    const startRun = await fetch(`${base}/api/plan/commands`, {
      method: 'POST',
      body: JSON.stringify({
        intent: {
          _tag: 'StartAcceptedRun',
          planId: accepted.plan.planId,
          expectedPlanRevision: accepted.plan.revision,
          expectedLeaseRevision: controlled.control.revision,
          idempotencyKey: 'simulated-m101-run',
        },
      }),
    })
    assert.equal(startRun.status, 202, await startRun.text())
    let current = await serviceSnapshot(base)
    if (current.activeRun._tag !== 'Active')
      throw new Error('The simulated Observe run did not start.')
    const refresh = await fetch(`${base}/api/observe/preflight`, {
      method: 'POST',
      body: JSON.stringify({
        runId: current.activeRun.run.runId,
        expectedRunRevision: current.activeRun.run.revision,
      }),
    })
    assert.equal(refresh.status, 200)
    await eventually(async () => {
      const state = await readSimulatorState(simulatorListener.origin)
      assert.equal(state.commandLog.length, 1)
      assert.equal(state.commandLog[0]?.name, 'startExposure')
    })
    await eventually(async () => {
      current = await serviceSnapshot(base)
      assert.equal(
        current.observe?.executorWork?.find(
          (work) => work.kind === 'StartExposure',
        )?.state,
        'observing',
      )
    })
    await postControl(simulatorListener.origin, '/__sim/advance', {
      milliseconds: 16_000,
    })
    let assetId = ''
    await eventually(async () => {
      current = await serviceSnapshot(base)
      assert.equal(
        current.observe?.phase,
        'verify',
        JSON.stringify({
          phase: current.observe?.phase,
          work: current.observe?.executorWork,
          facts: current.observe?.attemptFacts,
        }),
      )
      assetId = current.observe?.latestCapturedAssetId ?? ''
      assert.notEqual(assetId, '')
    })
    const detailResponse = await fetch(`${base}/api/library/assets/${assetId}`)
    assert.equal(detailResponse.status, 200)
    const detail = Schema.decodeUnknownSync(LibraryAssetDetail)(
      await detailResponse.json(),
    )
    if (detail.provenance === undefined)
      throw new Error('The retained frame has no capture provenance.')
    if (detail.inspection?._tag !== 'Available')
      throw new Error('The retained frame has no available inspection.')
    assert.deepEqual(detail.equipment, {
      rigId: providerConfig.rigId,
      cameraDeviceId: 'sim-camera-asi2600mc-pro',
    })
    assert.equal(detail.provenance.source, 'alpaca-imagearray')
    assert.equal(detail.inspection.rationale.decision, 'unreviewed')
    assert.equal(detail.review?.decision ?? 'unreviewed', 'unreviewed')
    assert.ok(
      detail.actions.some(
        (action) => action._tag === 'Eligible' && action.action === 'download',
      ),
    )
    const preview = await fetch(`${base}/api/library/assets/${assetId}/preview`)
    assert.equal(preview.status, 200)
    assert.deepEqual(
      [...new Uint8Array(await preview.arrayBuffer()).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    )
    const download = await fetch(
      `${base}/api/library/assets/${assetId}/download`,
    )
    assert.equal(download.status, 200)
    assert.match(
      download.headers.get('content-disposition') ?? '',
      new RegExp(`${assetId}\\.cameraRaw`),
    )
    assert.equal(
      (await download.arrayBuffer()).byteLength,
      44 + 6024 * 4024 * 2,
    )
    const beforeRestart = await readSimulatorState(simulatorListener.origin)
    assert.equal(beforeRestart.evidence.framesServed, 1)

    await serviceListener.close()
    service.close()
    service = createLocalWebService(
      databasePath,
      undefined,
      undefined,
      undefined,
      serviceOptions,
    )
    serviceListener = await service.listen()
    base = `http://127.0.0.1:${serviceListener.port}`
    const recovered = await serviceSnapshot(base)
    assert.equal(recovered.observe?.latestCapturedAssetId, assetId)
    assert.equal(
      (await fetch(`${base}/api/library/assets/${assetId}`)).status,
      200,
    )
    const afterRestart = await readSimulatorState(simulatorListener.origin)
    assert.equal(afterRestart.evidence.framesServed, 1)
    assert.equal(afterRestart.commandLog.length, 1)
  },
)

test(
  'real-frame scenarios progress target evidence, solve inputs, and pinned focus-quality facts',
  {
    skip: !preparedEvidenceFiles.every((filename) =>
      existsSync(join(preparedCorpusRoot, filename)),
    ),
  },
  async (t) => {
    const simulator = createAlpacaSimulator({ corpusRoot: preparedCorpusRoot })
    const listener = await simulator.listen()
    t.after(listener.close)
    const camera = cameraProvider(listener.port)

    let state = await postControl(listener.origin, '/__sim/scenario', {
      scenario: 'solve-success-no-solution',
    })
    assert.equal(state.evidence.nextFrame?.id, 'm101-good-light')
    assert.equal(state.evidence.nextFrame?.solveInput, 'expected-success')
    const solvedInput = await captureMetadata(camera, listener.origin)
    assert.deepEqual(
      [solvedInput.dimension1, solvedInput.dimension2],
      [6024, 4024],
    )
    state = await readSimulatorState(listener.origin)
    assert.equal(state.evidence.lastFrame?.id, 'm101-good-light')
    assert.equal(state.evidence.nextFrame?.id, 'm101-clouded-light')
    assert.equal(state.evidence.nextFrame?.solveInput, 'expected-no-solution')
    await captureMetadata(camera, listener.origin)
    state = await readSimulatorState(listener.origin)
    assert.equal(state.evidence.lastFrame?.id, 'm101-clouded-light')
    assert.equal(state.evidence.nextFrame, null)

    state = await postControl(listener.origin, '/__sim/scenario', {
      scenario: 'target-evidence-progression',
    })
    assert.equal(state.evidence.nextFrame?.targetStage, 'initial')
    const initialTarget = await captureMetadata(camera, listener.origin)
    assert.deepEqual(
      [initialTarget.dimension1, initialTarget.dimension2],
      [6248, 4176],
    )
    state = await readSimulatorState(listener.origin)
    assert.equal(state.evidence.lastFrame?.id, 'ngc7000-first-light')
    assert.equal(state.evidence.nextFrame?.targetStage, 'later-observation')
    await captureMetadata(camera, listener.origin)
    state = await readSimulatorState(listener.origin)
    assert.equal(state.evidence.lastFrame?.id, 'ngc7000-dithered-light')
    assert.equal(state.evidence.framesServed, 2)

    state = await postControl(listener.origin, '/__sim/scenario', {
      scenario: 'focus-quality-degradation',
    })
    const baseline = state.evidence.sequence[0]?.quality
    const later = state.evidence.sequence[1]?.quality
    assert.equal(baseline?.focusThreshold, 'severely-breached')
    assert.equal(later?.focusThreshold, 'severely-breached')
    assert.equal(baseline?.fwhmPx, 29.8566)
    assert.equal(later?.fwhmPx, 29.042)
    assert.ok((later?.roundness ?? 1) < (baseline?.roundness ?? 0))
    assert.equal(later?.trend, 'roundness-degraded-focus-still-severe')
    const report = await readFile(
      join(preparedCorpusRoot, 'ngc7000-frame-quality.csv'),
      'utf8',
    )
    assert.match(report, /1,.*0000\.fits,165,29\.8566,0\.929328,0\.00,0\.00/)
    assert.match(
      report,
      /7,.*0006\.fits,160,29\.0420,0\.913864,-10\.15,-22\.77/,
    )
  },
)

test('the simulator serves ready inventory and preserves an unavailable optional device', async (t) => {
  const fixture = await simulatorFixture(t)
  const provider = alpacaPreflightProvider({
    kind: 'alpaca',
    rigId: 'simulated-rig',
    host: '127.0.0.1',
    port: fixture.port,
    devices: {
      camera: { deviceNumber: 0, uniqueId: 'sim-camera-asi2600mc-pro' },
      telescope: { deviceNumber: 0, uniqueId: 'sim-telescope-am5n' },
      focuser: { deviceNumber: 0, uniqueId: 'sim-focuser-eafn' },
      filterWheel: { deviceNumber: 0, uniqueId: 'sim-filterwheel-0' },
    },
  })

  const ready = Schema.decodeUnknownSync(PreflightSnapshot)(
    await Effect.runPromise(provider.observe()),
  )
  assert.equal(ready.verdict, 'ready')
  assert.equal(ready.rig?.devices.length, 4)
  assert.equal(ready.rig?.devices[0]?.name, 'ASI2600MC Pro (simulated)')

  await fixture.scenario('optional-device-unavailable')
  const unavailable = Schema.decodeUnknownSync(PreflightSnapshot)(
    await Effect.runPromise(provider.observe()),
  )
  assert.equal(unavailable.verdict, 'unknown')
  assert.equal(unavailable.rig?.devices[2]?.kind, 'focuser')
  assert.equal(unavailable.rig?.devices[2]?.state, 'unavailable')
  assert.deepEqual(unavailable.rig?.devices[2]?.capabilities, [])
})

test('the simulator exposes standard camera stop capability without accepting the former typo', async (t) => {
  const fixture = await simulatorFixture(t)

  const supported = await fetch(
    `${fixture.origin}/api/v1/camera/0/canstopexposure`,
  )
  assert.equal(supported.status, 200)
  assert.deepEqual(await supported.json(), {
    Value: false,
    ClientTransactionID: 0,
    ServerTransactionID: 1,
    ErrorNumber: 0,
    ErrorMessage: '',
  })

  const typo = await fetch(`${fixture.origin}/api/v1/camera/0/cansubexposure`)
  assert.equal(typo.status, 404)
  assert.deepEqual(await typo.json(), {
    ClientTransactionID: 0,
    ServerTransactionID: 2,
    ErrorNumber: 1025,
    ErrorMessage: 'Unknown simulated property.',
  })
})

test('a deterministic exposure advances to a real ImageBytes response without sleeps', async (t) => {
  const fixture = await simulatorFixture(t)
  const camera = cameraProvider(fixture.port)
  await fixture.scenario('exposure-success')

  await Effect.runPromise(camera.startExposure(0.01))
  assert.equal((await readCameraState(camera)).cameraState, 'exposing')
  await fixture.advance(10)
  assert.equal((await readCameraState(camera)).cameraState, 'reading')
  await fixture.advance(1000)
  assert.equal((await readCameraState(camera)).cameraState, 'idle')

  const image = await Effect.runPromise(
    camera.readImageArray?.() ?? Effect.die('missing image reader'),
  )
  assert.equal(image.format, 'cameraRaw')
  assert.deepEqual(readAlpacaImageBytesMetadata(image.bytes), {
    metadataVersion: 1,
    errorNumber: 0,
    clientTransactionId: 0,
    serverTransactionId: 5,
    dataStart: 44,
    imageElementType: 2,
    transmissionElementType: 8,
    rank: 2,
    dimension1: 2,
    dimension2: 3,
    dimension3: 0,
  })
})

test('abort returns the camera to idle and does not publish an image', async (t) => {
  const fixture = await simulatorFixture(t)
  const camera = cameraProvider(fixture.port)
  await fixture.scenario('abort-exposure')

  await Effect.runPromise(camera.startExposure(10))
  await Effect.runPromise(camera.abortExposure())
  assert.equal((await readCameraState(camera)).cameraState, 'idle')
  await assert.rejects(
    Effect.runPromise(
      camera.readImageArray?.() ?? Effect.die('missing image reader'),
    ),
    /No image is ready/,
  )
})

test('provider and post-ack reconciliation errors remain distinct', async (t) => {
  const fixture = await simulatorFixture(t)
  const camera = cameraProvider(fixture.port)
  await fixture.scenario('provider-error')
  assert.deepEqual(await Effect.runPromise(camera.startExposure(15)), {
    _tag: 'Rejected',
    summary: 'Simulated camera provider error.',
  })

  await fixture.scenario('reconciliation-failure')
  await Effect.runPromise(camera.startExposure(15))
  await assert.rejects(
    Effect.runPromise(camera.readState()),
    /Camera state reconciliation failed/,
  )
})

test('image retrieval failure and declared oversize fail through the current adapter', async (t) => {
  const fixture = await simulatorFixture(t)
  const camera = cameraProvider(fixture.port)
  await fixture.scenario('retrieval-failure')
  await assert.rejects(
    Effect.runPromise(
      camera.readImageArray?.() ?? Effect.die('missing image reader'),
    ),
    /Simulated image retrieval failure/,
  )

  await fixture.scenario('retrieval-oversize')
  await assert.rejects(
    Effect.runPromise(
      camera.readImageArray?.() ?? Effect.die('missing image reader'),
    ),
    /outside the supported size/,
  )
})

test('simulated restart clears accepted work without replaying its command', async (t) => {
  const fixture = await simulatorFixture(t)
  const camera = cameraProvider(fixture.port)
  await fixture.scenario('restart-no-replay')
  await Effect.runPromise(camera.startExposure(15))
  const before = await fixture.state()
  assert.equal(before.generation, 1)
  assert.equal(before.commandLog.length, 1)
  assert.equal(before.cameraPhase, 'exposing')

  const after = await fixture.restart()
  assert.equal(after.generation, 2)
  assert.equal(after.cameraPhase, 'idle')
  assert.equal(after.imageReady, false)
  assert.equal(after.commandLog.length, 1)
  assert.equal(after.commandLog[0]?.generation, 1)
})

function cameraProvider(port: number) {
  return alpacaCameraProvider({
    kind: 'alpaca',
    rigId: 'simulated-rig',
    host: '127.0.0.1',
    port,
    devices: { camera: { deviceNumber: 0 } },
  })
}

async function serviceSnapshot(base: string) {
  const response = await fetch(`${base}/api/snapshot`)
  const body: unknown = await response.json()
  return Schema.decodeUnknownSync(BootstrapHttpSuccessEnvelope)(body).data
}

async function eventually(
  assertion: () => Promise<void>,
  attempts = 80,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw lastError
}

async function readCameraState(camera: ReturnType<typeof cameraProvider>) {
  return Schema.decodeUnknownSync(CameraExposureObservation)(
    await Effect.runPromise(camera.readState()),
  )
}

async function simulatorFixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'astro-alpaca-simulator-'))
  await writeFile(
    join(root, 'm101-good-light.fits'),
    testFits(2, 3, [1, 2, 3, 4, 5, 6]),
  )
  const simulator = createAlpacaSimulator({ corpusRoot: root })
  const listener = await simulator.listen()
  t.after(async () => {
    await listener.close()
    await rm(root, { recursive: true, force: true })
  })
  const post = async (path: string, body?: unknown) => {
    const response = await fetch(`${listener.origin}${path}`, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
          }),
    })
    assert.equal(response.status, 200)
    return simulatorSnapshot(await response.json())
  }
  return {
    origin: listener.origin,
    port: listener.port,
    scenario: (scenario: AlpacaSimulationScenario) =>
      post('/__sim/scenario', { scenario }),
    advance: (milliseconds: number) => post('/__sim/advance', { milliseconds }),
    restart: () => post('/__sim/restart'),
    state: async () => {
      const response = await fetch(`${listener.origin}/__sim/state`)
      assert.equal(response.status, 200)
      return simulatorSnapshot(await response.json())
    },
  }
}

type SimulatorSnapshot = {
  readonly scenario: AlpacaSimulationScenario
  readonly nowMs: number
  readonly generation: number
  readonly cameraPhase: 'idle' | 'exposing' | 'reading'
  readonly imageReady: boolean
  readonly evidence: {
    readonly sequenceLength: number
    readonly framesServed: number
    readonly sequence: ReadonlyArray<AlpacaScenarioFrame>
    readonly lastFrame: AlpacaScenarioFrame | null
    readonly nextFrame: AlpacaScenarioFrame | null
  }
  readonly commandLog: ReadonlyArray<{
    readonly name: string
    readonly generation: number
    readonly atMs: number
  }>
}

function simulatorSnapshot(value: unknown): SimulatorSnapshot {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('scenario' in value) ||
    typeof value.scenario !== 'string' ||
    !('nowMs' in value) ||
    typeof value.nowMs !== 'number' ||
    !('generation' in value) ||
    typeof value.generation !== 'number' ||
    !('cameraPhase' in value) ||
    (value.cameraPhase !== 'idle' &&
      value.cameraPhase !== 'exposing' &&
      value.cameraPhase !== 'reading') ||
    !('imageReady' in value) ||
    typeof value.imageReady !== 'boolean' ||
    !('evidence' in value) ||
    !isEvidenceState(value.evidence) ||
    !('commandLog' in value) ||
    !Array.isArray(value.commandLog) ||
    !value.commandLog.every(isCommandLogEntry) ||
    !isScenario(value.scenario)
  )
    throw new Error('The simulator returned an invalid state snapshot.')
  return {
    scenario: value.scenario,
    nowMs: value.nowMs,
    generation: value.generation,
    cameraPhase: value.cameraPhase,
    imageReady: value.imageReady,
    evidence: value.evidence,
    commandLog: value.commandLog,
  }
}

function isEvidenceState(
  value: unknown,
): value is SimulatorSnapshot['evidence'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sequenceLength' in value &&
    typeof value.sequenceLength === 'number' &&
    'framesServed' in value &&
    typeof value.framesServed === 'number' &&
    'sequence' in value &&
    Array.isArray(value.sequence) &&
    value.sequence.every(isScenarioFrame) &&
    'lastFrame' in value &&
    (value.lastFrame === null || isScenarioFrame(value.lastFrame)) &&
    'nextFrame' in value &&
    (value.nextFrame === null || isScenarioFrame(value.nextFrame))
  )
}

function isScenarioFrame(value: unknown): value is AlpacaScenarioFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'filename' in value &&
    typeof value.filename === 'string' &&
    'purpose' in value &&
    typeof value.purpose === 'string' &&
    (!('targetStage' in value) || typeof value.targetStage === 'string') &&
    (!('solveInput' in value) || typeof value.solveInput === 'string') &&
    (!('quality' in value) || isQuality(value.quality))
  )
}

function isQuality(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'source' in value &&
    value.source === 'ngc7000-frame-quality.csv' &&
    'stars' in value &&
    typeof value.stars === 'number' &&
    'fwhmPx' in value &&
    typeof value.fwhmPx === 'number' &&
    'roundness' in value &&
    typeof value.roundness === 'number' &&
    'dxPx' in value &&
    typeof value.dxPx === 'number' &&
    'dyPx' in value &&
    typeof value.dyPx === 'number' &&
    'focusThreshold' in value &&
    value.focusThreshold === 'severely-breached' &&
    'trend' in value &&
    typeof value.trend === 'string'
  )
}

function isCommandLogEntry(
  value: unknown,
): value is SimulatorSnapshot['commandLog'][number] {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'generation' in value &&
    typeof value.generation === 'number' &&
    'atMs' in value &&
    typeof value.atMs === 'number'
  )
}

function isScenario(value: string): value is AlpacaSimulationScenario {
  return [
    'ready-rig',
    'optional-device-unavailable',
    'exposure-success',
    'abort-exposure',
    'provider-error',
    'reconciliation-failure',
    'retrieval-failure',
    'retrieval-oversize',
    'restart-no-replay',
    'target-evidence-progression',
    'solve-success-no-solution',
    'focus-quality-degradation',
  ].some((scenario) => scenario === value)
}

async function captureMetadata(
  camera: ReturnType<typeof cameraProvider>,
  origin: string,
) {
  await Effect.runPromise(camera.startExposure(0.001))
  await postControl(origin, '/__sim/advance', { milliseconds: 1001 })
  const image = await Effect.runPromise(
    camera.readImageArray?.() ?? Effect.die('missing image reader'),
  )
  return readAlpacaImageBytesMetadata(image.bytes)
}

async function postControl(origin: string, path: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
  })
  assert.equal(response.status, 200)
  return simulatorSnapshot(await response.json())
}

async function readSimulatorState(origin: string) {
  const response = await fetch(`${origin}/__sim/state`)
  assert.equal(response.status, 200)
  return simulatorSnapshot(await response.json())
}

function testFits(
  width: number,
  height: number,
  pixels: ReadonlyArray<number>,
) {
  assert.equal(pixels.length, width * height)
  const header = [
    card('SIMPLE', 'T'),
    card('BITPIX', '16'),
    card('NAXIS', '2'),
    card('NAXIS1', String(width)),
    card('NAXIS2', String(height)),
    card('BSCALE', '1'),
    card('BZERO', '0'),
    'END'.padEnd(80, ' '),
  ].join('')
  const bytes = new Uint8Array(2880 + pixels.length * 2)
  bytes.set(new TextEncoder().encode(header))
  const view = new DataView(bytes.buffer)
  pixels.forEach((value, index) =>
    view.setInt16(2880 + index * 2, value, false),
  )
  return bytes
}

function card(key: string, value: string) {
  return `${key.padEnd(8, ' ')}= ${value.padStart(20, ' ')}`.padEnd(80, ' ')
}
