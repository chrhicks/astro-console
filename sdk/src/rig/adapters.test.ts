import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { Effect, Stream } from 'effect'
import { createAlpacaRig } from './alpaca.js'
import {
  RigProtocolError,
  RigRejectedError,
  RigTransportError,
} from './contracts.js'
import { createSeestarRig } from './seestar.js'

interface AlpacaScenario {
  readonly atPark: readonly boolean[]
  readonly canUnpark?: boolean
  readonly invalidCanUnpark?: boolean
  readonly optionalTracking?: 'invalid' | 'rejected' | 'transport'
  readonly slewing?: readonly boolean[]
  readonly rejectPark?: boolean
}

const requests: Array<{ readonly method: string; readonly path: string }> = []
let scenario: AlpacaScenario = { atPark: [] }
let atPark: boolean[] = []
let slewing: boolean[] = []

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', `http://${request.headers.host}`)
    .pathname
  const method = request.method ?? 'GET'
  requests.push({ method, path })
  if (method === 'PUT') {
    response.end(
      JSON.stringify({
        ErrorNumber: path.endsWith('/park') && scenario.rejectPark ? 1 : 0,
        ErrorMessage: scenario.rejectPark ? 'park rejected' : undefined,
      }),
    )
    return
  }
  if (path.endsWith('/canunpark') && scenario.invalidCanUnpark) {
    response.end(JSON.stringify({ Value: 'true', ErrorNumber: 0 }))
    return
  }
  if (path.endsWith('/tracking') && scenario.optionalTracking === 'transport') {
    response.destroy()
    return
  }
  if (path.endsWith('/tracking') && scenario.optionalTracking === 'invalid') {
    response.end(JSON.stringify({ Value: 'true', ErrorNumber: 0 }))
    return
  }
  if (path.endsWith('/tracking') && scenario.optionalTracking === 'rejected') {
    response.end(JSON.stringify({ Value: undefined, ErrorNumber: 1 }))
    return
  }
  const value = alpacaValue(path)
  response.end(
    JSON.stringify({ Value: value, ErrorNumber: value === undefined ? 1 : 0 }),
  )
})

function alpacaValue(path: string): boolean | number | string | undefined {
  if (path.endsWith('/connected')) return true
  if (path.endsWith('/atpark')) return atPark.shift() ?? false
  if (path.endsWith('/canpark')) return true
  if (path.endsWith('/canunpark')) return scenario.canUnpark ?? false
  if (path.endsWith('/tracking')) return true
  if (path.endsWith('/sitelatitude') || path.endsWith('/sitelongitude'))
    return 1
  if (path.endsWith('/canslew') || path.endsWith('/canslewasync')) return true
  if (path.endsWith('/driverversion')) return '1.0'
  if (path.endsWith('/name')) return 'Test mount'
  if (path.endsWith('/slewing')) return slewing.shift() ?? false
  return undefined
}

let port = 0
let previousAlpacaTest = Promise.resolve()

function createFakeSeestarDevice(
  input: { readonly park?: boolean; readonly snapshot?: () => unknown } = {},
) {
  return {
    connect: async () => {},
    authenticate: async () => true,
    connectAndAuth: async () => true,
    disconnect: () => {},
    getSnapshot: async () =>
      input.snapshot?.() ?? { deviceState: null, viewState: null },
    moveToHorizon: async () => true,
    park: async () => input.park ?? true,
    preflightCheck: async () => ({
      host: '127.0.0.1',
      raw: {
        deviceState: null,
        viewState: null,
        setting: null,
        diskVolume: null,
        piInfo: null,
        time: null,
      },
      warnings: [],
    }),
    setTime: async () => true,
    setUserLocation: async () => true,
    setWheelPosition: async () => true,
    startAutoFocus: async () => true,
    startStack: async () => true,
    startView: async () => true,
    startViewDetailed: async () => true,
    stopStack: async () => true,
    stopView: async () => true,
    subscribeToLifecycleEvents: () => () => {},
    testConnection: async () => {},
  }
}

function alpacaTest(name: string, run: () => Promise<void>) {
  test(name, async () => {
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = previousAlpacaTest
    previousAlpacaTest = current
    await previous
    try {
      await run()
    } finally {
      release?.()
    }
  })
}

test.before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  port = address.port
})

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function connect(next: AlpacaScenario) {
  scenario = next
  atPark = [...next.atPark]
  slewing = [...(next.slewing ?? [])]
  requests.length = 0
  const rig = await Effect.runPromise(
    createAlpacaRig({
      rigId: 'test',
      host: '127.0.0.1',
      port,
      displayName: 'Test mount',
      telescopeDeviceNumber: 0,
    }),
  )
  requests.length = 0
  return rig
}

alpacaTest(
  'Alpaca adapter exposes only probed callable capabilities',
  async () => {
    const rig = await connect({ atPark: [false], canUnpark: false })
    assert.ok(rig.mount?.park)
    assert.ok(rig.mount?.slewToCoordinates)
    assert.equal(rig.mount?.unpark, undefined)
    assert.equal(rig.camera, undefined)
    assert.equal(rig.nativeCapture, undefined)
    await Effect.runPromise(rig.disconnect)
  },
)

alpacaTest(
  'Alpaca adapter classifies invalid capability payloads and reconnects cleanly',
  async () => {
    await assert.rejects(
      connect({ atPark: [false], invalidCanUnpark: true }),
      (error: unknown) =>
        error instanceof RigProtocolError && error.operation === 'connect',
    )
    const rig = await connect({ atPark: [false], canUnpark: true })
    assert.ok(rig.mount?.unpark)
    await Effect.runPromise(rig.disconnect)
  },
)

alpacaTest(
  'Alpaca optional properties fall back only for provider rejections',
  async () => {
    const rig = await connect({
      atPark: [false],
      optionalTracking: 'rejected',
    })
    assert.equal(rig.snapshot.mount.tracking, undefined)
    await Effect.runPromise(rig.disconnect)
  },
)

alpacaTest(
  'Alpaca optional properties preserve malformed provider failures',
  async () => {
    await assert.rejects(
      connect({ atPark: [false], optionalTracking: 'invalid' }),
      (error: unknown) =>
        error instanceof RigProtocolError && error.operation === 'connect',
    )
  },
)

alpacaTest(
  'Alpaca optional properties preserve transport failures',
  async () => {
    await assert.rejects(
      connect({ atPark: [false], optionalTracking: 'transport' }),
      (error: unknown) =>
        error instanceof RigTransportError && error.operation === 'connect',
    )
  },
)

alpacaTest(
  'Alpaca unpark issues only unpark and waits for a settled mount',
  async () => {
    const rig = await connect({
      atPark: [true, true, false],
      canUnpark: true,
      slewing: [false],
    })
    assert.ok(rig.mount?.unpark)
    await Effect.runPromise(rig.mount.unpark())
    assert.deepEqual(requests, [
      { method: 'GET', path: '/api/v1/telescope/0/atpark' },
      { method: 'PUT', path: '/api/v1/telescope/0/unpark' },
      { method: 'GET', path: '/api/v1/telescope/0/atpark' },
      { method: 'GET', path: '/api/v1/telescope/0/slewing' },
    ])
    await Effect.runPromise(rig.disconnect)
  },
)

alpacaTest(
  'Alpaca slew prepares, unparks, and settles before issuing slew',
  async () => {
    const rig = await connect({
      atPark: [true, true, false],
      canUnpark: true,
      slewing: [false],
    })
    assert.ok(rig.mount?.slewToCoordinates)
    await Effect.runPromise(
      rig.mount.slewToCoordinates({ raHours: 1, decDeg: 2 }),
    )
    const unpark = requests.findIndex((request) =>
      request.path.endsWith('/unpark'),
    )
    const settled = requests.findIndex(
      (request, index) =>
        index > unpark &&
        request.path.endsWith('/slewing') &&
        requests[index - 1]?.path.endsWith('/atpark'),
    )
    const slew = requests.findIndex((request) =>
      request.path.endsWith('/slewtocoordinatesasync'),
    )
    assert.ok(unpark >= 0)
    assert.ok(settled > unpark)
    assert.ok(slew > settled)
    await Effect.runPromise(rig.disconnect)
  },
)

alpacaTest(
  'Alpaca park waits until the terminal parked state is confirmed',
  async () => {
    const rig = await connect({ atPark: [false, false, true] })
    assert.ok(rig.mount?.park)
    await Effect.runPromise(rig.mount.park())
    assert.deepEqual(requests, [
      { method: 'GET', path: '/api/v1/telescope/0/atpark' },
      { method: 'PUT', path: '/api/v1/telescope/0/park' },
      { method: 'GET', path: '/api/v1/telescope/0/atpark' },
    ])
    await Effect.runPromise(rig.disconnect)
  },
)

alpacaTest(
  'Alpaca provider rejections are RigRejectedError values',
  async () => {
    const rig = await connect({ atPark: [false, false], rejectPark: true })
    assert.ok(rig.mount?.park)
    await assert.rejects(
      Effect.runPromise(rig.mount.park()),
      (error: unknown) =>
        error instanceof RigRejectedError && error.operation === 'mount.park',
    )
    await Effect.runPromise(rig.disconnect)
  },
)

test('Seestar adapter maps connection failures to RigTransportError', async () => {
  await assert.rejects(
    Effect.runPromise(
      createSeestarRig({
        rigId: 'test',
        host: '127.0.0.1',
        displayName: 'Test Seestar',
        pemPath: '/missing.pem',
      }),
    ),
    (error: unknown) =>
      error instanceof RigTransportError && error.operation === 'connect',
  )
})

test('Seestar adapter maps rejected commands to RigRejectedError', async () => {
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => createFakeSeestarDevice({ park: false }),
    }),
  )
  assert.ok(rig.mount?.park)
  await assert.rejects(
    Effect.runPromise(rig.mount.park()),
    (error: unknown) =>
      error instanceof RigRejectedError && error.operation === 'mount.park',
  )
  await Effect.runPromise(rig.disconnect)
})

test('Seestar adapter maps malformed mount snapshots to RigProtocolError', async () => {
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () =>
        createFakeSeestarDevice({
          snapshot: () =>
            JSON.parse(
              '{"deviceState":{"mount":{"close":"false"}},"viewState":null}',
            ),
        }),
    }),
  )
  await assert.rejects(
    Effect.runPromise(rig.refresh),
    (error: unknown) =>
      error instanceof RigProtocolError && error.operation === 'refresh',
  )
  await Effect.runPromise(rig.disconnect)
})

test('Seestar disconnect waits for keepalive cleanup and closes its event stream', async () => {
  let startKeepalive: (() => void) | undefined
  const keepaliveStarted = new Promise<void>((resolve) => {
    startKeepalive = resolve
  })
  let releaseKeepalive: (() => void) | undefined
  const keepaliveBlocked = new Promise<void>((resolve) => {
    releaseKeepalive = resolve
  })
  let signalDisconnect: (() => void) | undefined
  const disconnectCalled = new Promise<void>((resolve) => {
    signalDisconnect = resolve
  })
  let disconnected = false
  let unsubscribed = false
  let reconnects = 0
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      keepaliveIntervalMs: 0,
      deviceFactory: () => ({
        connect: async () => {},
        authenticate: async () => true,
        connectAndAuth: async () => {
          reconnects += 1
          return true
        },
        disconnect: () => {
          disconnected = true
          signalDisconnect?.()
        },
        getSnapshot: async () => ({ deviceState: null, viewState: null }),
        moveToHorizon: async () => true,
        park: async () => true,
        preflightCheck: async () => ({
          host: '127.0.0.1',
          raw: {
            deviceState: null,
            viewState: null,
            setting: null,
            diskVolume: null,
            piInfo: null,
            time: null,
          },
          warnings: [],
        }),
        setTime: async () => true,
        setUserLocation: async () => true,
        setWheelPosition: async () => true,
        startAutoFocus: async () => true,
        startStack: async () => true,
        startView: async () => true,
        startViewDetailed: async () => true,
        stopStack: async () => true,
        stopView: async () => true,
        subscribeToLifecycleEvents: () => () => {
          unsubscribed = true
        },
        testConnection: async () => {
          startKeepalive?.()
          await keepaliveBlocked
          throw new Error('connection closed')
        },
      }),
    }),
  )
  const drained = Effect.runPromise(Stream.runDrain(rig.events ?? Stream.empty))
  await keepaliveStarted
  const disconnect = Effect.runPromise(rig.disconnect)
  let disconnectCompleted = false
  void disconnect.then(() => {
    disconnectCompleted = true
  })
  await disconnectCalled
  assert.equal(disconnected, true)
  assert.equal(unsubscribed, true)
  assert.equal(disconnectCompleted, false)
  releaseKeepalive?.()
  await disconnect
  await drained
  assert.equal(reconnects, 0)
})
