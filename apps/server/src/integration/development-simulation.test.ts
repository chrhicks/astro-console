import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { ConfigProvider, Effect } from 'effect'
import { createLocalWebService } from '../app/origin-service.ts'
import { originServerConfig } from '../config/environment-config.ts'
import { developmentCaptureMetadata } from '../http/development-simulation.ts'
import { createAlpacaSimulator } from '../simulator/alpaca-simulator.ts'

test('pinned M101 capture metadata follows the next filename', () => {
  assert.deepEqual(developmentCaptureMetadata('m101-clouded-light.fits'), {
    _tag: 'Available',
    exposureSeconds: 15,
    capturedAt: '2026-06-22T02:59:31.277Z',
    filter: 'None',
    binning: 1,
    frameType: 'light',
  })
  assert.equal(
    developmentCaptureMetadata('ngc7000-first-light.fits')._tag,
    'Unavailable',
  )
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
})

test('development simulation is absent from a normal origin', async (t) => {
  const service = createLocalWebService()
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
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
  const service = createLocalWebService(
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
    service.close()
    await simulatorListener.close()
  })

  let projection = await fetch(`${origin}/api/simulation`).then((response) =>
    response.json(),
  )
  assert.equal(projection.notice, 'SIMULATION · NOT LIVE HARDWARE')
  assert.equal(projection.scenario, 'exposure-success')
  assert.equal(projection.evidence.nextFrame.filename, 'm101-good-light.fits')
  assert.deepEqual(projection.guide, {
    summary: 'One 15-second M101 exposure can enter Library.',
    driver: {
      _tag: 'Available',
      action: 'capture-test-frame',
      label: 'Capture test frame',
    },
  })
  assert.equal(
    projection.evidence.nextFrame.sha256,
    '3d4abc598e2168bddf9d43d7ce9acad788e5c288a7e6bc211013eea31d9d9e24',
  )
  assert.deepEqual(projection.evidence.nextFrame.capture, {
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
    scenario: 'focus-quality-degradation',
  })
  assert.equal(projection.scenario, 'focus-quality-degradation')
  assert.equal(projection.guide.driver._tag, 'Unavailable')
  assert.match(
    projection.guide.driver.reason,
    /Load changes simulator state only/,
  )
  assert.equal(projection.clock.nowMs, 0)
  assert.equal(projection.evidence.nextFrame.capture._tag, 'Unavailable')
  assert.match(
    projection.evidence.nextFrame.capture.reason,
    /NGC 7000 frames require 120 seconds/,
  )

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
  const service = createLocalWebService(
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
    service.close()
    await simulatorListener.close()
  })

  assert.equal((await fetch(`${origin}/api/simulation`)).status, 200)
  const response = await fetch(`${origin}/api/simulation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reset' }),
  })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).reason, 'ControlRequired')
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
  const service = createLocalWebService(
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
    service.close()
    if (malformed.listening)
      await new Promise<void>((resolve, reject) =>
        malformed.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      )
  })

  let response = await fetch(`${origin}/api/simulation`)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    mode: 'alpaca',
    notice: 'SIMULATION · NOT LIVE HARDWARE',
    state: 'unavailable',
    launchScenario: 'exposure-success',
    message: 'The development simulator is unavailable.',
  })

  await new Promise<void>((resolve, reject) =>
    malformed.close((error) =>
      error === undefined ? resolve() : reject(error),
    ),
  )
  response = await fetch(`${origin}/api/simulation`)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).state, 'unavailable')
})

async function post(origin: string, body: object) {
  const response = await fetch(`${origin}/api/simulation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 200)
  return response.json()
}
