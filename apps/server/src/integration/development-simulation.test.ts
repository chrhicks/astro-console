import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { ConfigProvider, Effect, Schema } from 'effect'
import {
  DevelopmentSimulationControlFailure,
  DevelopmentSimulationProjection,
  DevelopmentSimulationUnavailable,
} from '@astro-console/protocol'
import { RunExecutionContext } from '../services/run-domain.ts'
import {
  openOriginTestApplication,
  originTestDatabase,
} from './origin-test-graph.ts'
import { originServerConfig } from '../config/environment-config.ts'
import { developmentCaptureMetadata } from '../http/development-simulation.ts'
import { createAlpacaSimulator } from '../simulator/alpaca-simulator.ts'

const CountRow = Schema.Struct({ count: Schema.Int })

test('pinned capture metadata follows the next filename', () => {
  assert.deepEqual(developmentCaptureMetadata('m101-clouded-light.fits'), {
    _tag: 'Available',
    exposureSeconds: 15,
    capturedAt: '2026-06-22T02:59:31.277Z',
    filter: 'None',
    binning: 1,
    frameType: 'light',
  })
  assert.deepEqual(developmentCaptureMetadata('ngc7000-first-light.fits'), {
    _tag: 'Available',
    exposureSeconds: 120,
    capturedAt: '2026-08-07T04:05:52.458Z',
    filter: 'None',
    binning: 1,
    frameType: 'light',
  })
})

test('development configuration accepts only a known loopback Alpaca simulation', async () => {
  const config = await Effect.runPromise(
    originServerConfig.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            ASTRO_SIMULATION_MODE: 'alpaca',
            ASTRO_SIMULATOR_ORIGIN: 'http://127.0.0.1:32324',
            ASTRO_SIMULATOR_SCENARIO: 'exposure-success',
            ASTRO_PREFLIGHT_PROVIDER: 'alpaca',
            ASTRO_PREFLIGHT_ALPACA_HOST: '127.0.0.1',
            ASTRO_PREFLIGHT_ALPACA_PORT: '32324',
            ASTRO_PREFLIGHT_ALPACA_CAMERA_DEVICE_NUMBER: '0',
            ASTRO_PREFLIGHT_ALPACA_CAMERA_UNIQUE_ID: 'sim-camera',
          }),
        ),
      ),
    ),
  )
  assert.deepEqual(config.simulation, {
    origin: 'http://127.0.0.1:32324',
    launchScenario: 'exposure-success',
  })

  const nonLoopback = await Effect.runPromiseExit(
    originServerConfig.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            ASTRO_SIMULATION_MODE: 'alpaca',
            ASTRO_SIMULATOR_ORIGIN: 'http://192.168.4.104:32324',
            ASTRO_SIMULATOR_SCENARIO: 'exposure-success',
          }),
        ),
      ),
    ),
  )
  assert.equal(nonLoopback._tag, 'Failure')

  const mismatchedProvider = await Effect.runPromiseExit(
    originServerConfig.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            ASTRO_SIMULATION_MODE: 'alpaca',
            ASTRO_SIMULATOR_ORIGIN: 'http://127.0.0.1:32324',
            ASTRO_SIMULATOR_SCENARIO: 'exposure-success',
            ASTRO_PREFLIGHT_PROVIDER: 'alpaca',
            ASTRO_PREFLIGHT_ALPACA_HOST: '127.0.0.1',
            ASTRO_PREFLIGHT_ALPACA_PORT: '32325',
            ASTRO_PREFLIGHT_ALPACA_CAMERA_DEVICE_NUMBER: '0',
            ASTRO_PREFLIGHT_ALPACA_CAMERA_UNIQUE_ID: 'sim-camera',
          }),
        ),
      ),
    ),
  )
  assert.equal(mismatchedProvider._tag, 'Failure')
})

test('mismatched simulation provider origin cannot create real executor work', async (t) => {
  let starts = 0
  const simulator = createAlpacaSimulator({
    corpusRoot: '/unused',
    initialScenario: 'exposure-success',
  })
  const simulatorListener = await simulator.listen()
  const service = await openOriginTestApplication(
    ':memory:',
    undefined,
    undefined,
    undefined,
    {
      simulation: {
        origin: simulatorListener.origin,
        launchScenario: 'exposure-success',
      },
      runExecutorProviderOrigin: 'http://127.0.0.1:1',
      runExecutionContext: RunExecutionContext.make({
        rigId: 'simulated-rig',
        cameraDeviceId: 'sim-camera',
        completionBehavior: 'hold',
        unsafeBehavior: 'pauseAndPark',
      }),
      cameraProvider: {
        startExposure: () => {
          starts += 1
          return Effect.succeed({ _tag: 'Acknowledged' as const })
        },
        abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
        readState: () =>
          Effect.succeed({
            observedAt: '2026-08-08T18:00:00.000Z',
            cameraState: 'idle',
          }),
      },
    },
  )
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    await service.close()
    await simulatorListener.close()
  })
  const base = `http://127.0.0.1:${listener.port}`
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  const accepted = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'AcceptRunDefinition',
        planId: snapshot.data.plan.planId,
        expectedPlanRevision: snapshot.data.plan.revision,
        expectedLeaseRevision: snapshot.data.control.revision,
        idempotencyKey: 'mismatched-simulator-provider',
      },
    }),
  })
  assert.equal(accepted.status, 409)
  assert.equal(starts, 0)
  assert.equal(
    Schema.decodeUnknownSync(CountRow)(
      originTestDatabase(service)
        .prepare(
          "SELECT count(*) AS count FROM run_executor_work WHERE kind='BeginRun'",
        )
        .get(),
    ).count,
    0,
  )
})

test('development simulation is absent from a normal origin', async (t) => {
  const service = await openOriginTestApplication()
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    await service.close()
  })

  assert.equal(
    (await fetch(`http://127.0.0.1:${listener.port}/api/simulation`)).status,
    404,
  )
})

test('origin projects and controls loopback simulation without exposing its control route', async (t) => {
  const simulator = createAlpacaSimulator({
    corpusRoot: '/unused',
    initialScenario: 'exposure-success',
  })
  const simulatorListener = await simulator.listen()
  const service = await openOriginTestApplication(
    ':memory:',
    undefined,
    undefined,
    undefined,
    {
      simulation: {
        origin: simulatorListener.origin,
        launchScenario: 'exposure-success',
      },
    },
  )
  const listener = await service.listen()
  const origin = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    await service.close()
    await simulatorListener.close()
  })

  let projection = Schema.decodeUnknownSync(DevelopmentSimulationProjection)(
    await fetch(`${origin}/api/simulation`).then((response) => response.json()),
  )
  assert.equal(projection.notice, 'SIMULATION · NOT LIVE HARDWARE')
  assert.equal(projection.scenario, 'exposure-success')
  const initialFrame = projection.evidence.nextFrame
  if (initialFrame === null)
    throw new Error('The exposure simulation has no next frame.')
  assert.equal(initialFrame.filename, 'm101-good-light.fits')
  assert.deepEqual(projection.guide, {
    summary:
      'One 15-second M101 exposure reaches Verify with a retained Library original and preview.',
    driver: {
      _tag: 'Available',
      action: 'capture-test-frame',
      label: 'Capture test frame',
    },
  })
  assert.equal(
    initialFrame.sha256,
    '3d4abc598e2168bddf9d43d7ce9acad788e5c288a7e6bc211013eea31d9d9e24',
  )
  assert.deepEqual(initialFrame.capture, {
    _tag: 'Available',
    exposureSeconds: 15,
    capturedAt: '2026-06-22T02:38:07.417Z',
    filter: 'None',
    binning: 1,
    frameType: 'light',
  })
  assert.equal(JSON.stringify(projection).includes('/Users/'), false)
  assert.equal(JSON.stringify(projection).includes('__sim'), false)

  projection = await post(origin, {
    action: 'advance',
    milliseconds: 1_000,
  })
  assert.equal(projection.clock.nowMs, 1_000)

  projection = await post(origin, {
    action: 'select',
    scenario: 'target-evidence-progression',
  })
  assert.equal(projection.guide.driver._tag, 'Unavailable')
  assert.match(
    projection.guide.driver.reason,
    /--scenario=target-evidence-progression/,
  )

  projection = await post(origin, {
    action: 'select',
    scenario: 'focus-quality-degradation',
  })
  assert.equal(projection.scenario, 'focus-quality-degradation')
  assert.equal(projection.guide.driver._tag, 'Unavailable')
  assert.match(
    projection.guide.driver.reason,
    /Restart with npm run dev:sim:inspect -- --scenario=focus-quality-degradation/,
  )
  assert.equal(projection.clock.nowMs, 0)
  const focusFrame = projection.evidence.nextFrame
  if (focusFrame === null)
    throw new Error('The focus simulation has no next frame.')
  assert.deepEqual(focusFrame.capture, {
    _tag: 'Available',
    exposureSeconds: 120,
    capturedAt: '2026-08-07T04:05:52.458Z',
    filter: 'None',
    binning: 1,
    frameType: 'light',
  })

  await post(origin, { action: 'advance', milliseconds: 1_000 })
  projection = await post(origin, { action: 'reset' })
  assert.equal(projection.scenario, 'focus-quality-degradation')
  assert.equal(projection.clock.nowMs, 0)

  assert.equal(
    (
      await fetch(`${origin}/api/simulation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'advance', milliseconds: 0 }),
      })
    ).status,
    400,
  )
})

test('read-only clients can inspect but cannot control development simulation', async (t) => {
  const simulator = createAlpacaSimulator({ corpusRoot: '/unused' })
  const simulatorListener = await simulator.listen()
  const service = await openOriginTestApplication(
    ':memory:',
    () => ({
      personId: 'owner-chicks',
      clientId: 'phone-monitor',
      capability: 'readOnly',
      role: 'owner',
    }),
    undefined,
    undefined,
    {
      simulation: {
        origin: simulatorListener.origin,
        launchScenario: 'ready-rig',
      },
    },
  )
  const listener = await service.listen()
  const origin = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    await service.close()
    await simulatorListener.close()
  })

  assert.equal((await fetch(`${origin}/api/simulation`)).status, 200)
  const response = await fetch(`${origin}/api/simulation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reset' }),
  })
  assert.equal(response.status, 403)
  assert.equal(
    Schema.decodeUnknownSync(DevelopmentSimulationControlFailure)(
      await response.json(),
    ).reason,
    'ControlRequired',
  )
})

test('origin keeps explicit simulation context when the simulator is malformed or unavailable', async (t) => {
  const malformed = createServer((_request, response) => {
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ unexpected: true }))
  })
  const malformedPort = await new Promise<number>((resolve, reject) => {
    malformed.once('error', reject)
    malformed.listen(0, '127.0.0.1', () => {
      malformed.off('error', reject)
      const address = malformed.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Malformed simulator did not bind a TCP port.'))
        return
      }
      resolve(address.port)
    })
  })
  const service = await openOriginTestApplication(
    ':memory:',
    undefined,
    undefined,
    undefined,
    {
      simulation: {
        origin: `http://127.0.0.1:${malformedPort}`,
        launchScenario: 'exposure-success',
      },
    },
  )
  const listener = await service.listen()
  const origin = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    await service.close()
    if (malformed.listening)
      await new Promise<void>((resolve, reject) =>
        malformed.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      )
  })

  let response = await fetch(`${origin}/api/simulation`)
  assert.equal(response.status, 503)
  assert.deepEqual(
    Schema.decodeUnknownSync(DevelopmentSimulationUnavailable)(
      await response.json(),
    ),
    {
      mode: 'alpaca',
      notice: 'SIMULATION · NOT LIVE HARDWARE',
      state: 'unavailable',
      launchScenario: 'exposure-success',
      message: 'The development simulator is unavailable.',
    },
  )

  await new Promise<void>((resolve, reject) =>
    malformed.close((error) =>
      error === undefined ? resolve() : reject(error),
    ),
  )
  response = await fetch(`${origin}/api/simulation`)
  assert.equal(response.status, 503)
  assert.equal(
    Schema.decodeUnknownSync(DevelopmentSimulationUnavailable)(
      await response.json(),
    ).state,
    'unavailable',
  )
})

async function post(origin: string, body: object) {
  const response = await fetch(`${origin}/api/simulation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 200)
  return Schema.decodeUnknownSync(DevelopmentSimulationProjection)(
    await response.json(),
  )
}
