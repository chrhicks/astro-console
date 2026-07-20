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
  readonly cameraEndpoints?: boolean
  readonly focuser?: {
    readonly absolute: boolean
    readonly maxStep: number
    readonly position: number
    readonly moving: boolean
  }
  readonly filterWheel?: {
    readonly names: readonly string[]
    readonly focusOffsets: readonly number[]
    readonly position: number
    readonly positionResponses?: readonly (number | 'rejected')[]
  }
}

const requests: Array<{ readonly method: string; readonly path: string }> = []
let scenario: AlpacaScenario = { atPark: [] }
let atPark: boolean[] = []
let slewing: boolean[] = []
let filterWheelPositionResponses: Array<number | 'rejected'> = []
let filterWheelPositionSet = false

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', `http://${request.headers.host}`)
    .pathname
  const method = request.method ?? 'GET'
  requests.push({ method, path })
  if (method === 'PUT') {
    if (path.endsWith('/filterwheel/0/position')) filterWheelPositionSet = true
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
  if (path.endsWith('/filterwheel/0/position') && filterWheelPositionSet) {
    const value = filterWheelPositionResponses.shift()
    if (value === 'rejected') {
      response.end(JSON.stringify({ ErrorNumber: 1 }))
      return
    }
    if (value !== undefined) {
      response.end(JSON.stringify({ Value: value, ErrorNumber: 0 }))
      return
    }
  }
  const value = alpacaValue(path)
  response.end(
    JSON.stringify({ Value: value, ErrorNumber: value === undefined ? 1 : 0 }),
  )
})

function alpacaValue(path: string): boolean | number | string | readonly string[] | readonly number[] | undefined {
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
  if (path.endsWith('/camerastate')) return scenario.cameraEndpoints ? 0 : undefined
  if (path.endsWith('/imageready'))
    return scenario.cameraEndpoints ? false : undefined
  if (path.endsWith('/canstopexposure'))
    return scenario.cameraEndpoints ? true : undefined
  if (path.endsWith('/absolute')) return scenario.focuser?.absolute
  if (path.endsWith('/maxstep')) return scenario.focuser?.maxStep
  if (path.endsWith('/focuser/0/position')) return scenario.focuser?.position
  if (path.endsWith('/ismoving')) return scenario.focuser?.moving
  if (path.endsWith('/filterwheel/0/names')) return scenario.filterWheel?.names
  if (path.endsWith('/filterwheel/0/focusoffsets')) return scenario.filterWheel?.focusOffsets
  if (path.endsWith('/filterwheel/0/position'))
    return scenario.filterWheel?.position
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

async function connect(
  next: AlpacaScenario,
  components: {
    readonly camera?: boolean
    readonly focuser?: boolean
    readonly filterWheel?: boolean
  } = {},
) {
  scenario = next
  atPark = [...next.atPark]
  slewing = [...(next.slewing ?? [])]
  filterWheelPositionResponses = [...(next.filterWheel?.positionResponses ?? [])]
  filterWheelPositionSet = false
  requests.length = 0
  const rig = await Effect.runPromise(
    createAlpacaRig({
      rigId: 'test',
      host: '127.0.0.1',
      port,
      displayName: 'Test mount',
      telescopeDeviceNumber: 0,
      cameraDeviceNumber: components.camera ? 0 : undefined,
      focuserDeviceNumber: components.focuser ? 0 : undefined,
      filterWheelDeviceNumber: components.filterWheel ? 0 : undefined,
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
  'Alpaca adapter omits optional components until their endpoints respond',
  async () => {
    const unsupported = await connect(
      { atPark: [] },
      { camera: true, focuser: true, filterWheel: true },
    )
    assert.equal(unsupported.camera, undefined)
    assert.equal(unsupported.focuser, undefined)
    assert.equal(unsupported.filterWheel, undefined)
    await Effect.runPromise(unsupported.disconnect)

    const supported = await connect(
      {
        atPark: [],
        cameraEndpoints: true,
        focuser: { absolute: true, maxStep: 2600, position: 1300, moving: false },
        filterWheel: {
          names: ['Dark', 'IR', 'LP'],
          focusOffsets: [0, 0, 0],
          position: 0,
        },
      },
      { camera: true, focuser: true, filterWheel: true },
    )
    assert.ok(supported.camera)
    assert.ok(supported.focuser)
    assert.ok(supported.filterWheel)
    assert.deepEqual(supported.focuser.state, {
      absolute: true,
      maxStep: 2600,
      position: 1300,
      moving: false,
    })
    assert.deepEqual(supported.filterWheel.state, {
      names: ['Dark', 'IR', 'LP'],
      focusOffsets: [0, 0, 0],
      position: 0,
    })
    await Effect.runPromise(supported.disconnect)

    const compact = await connect(
      {
        atPark: [],
        focuser: { absolute: true, maxStep: 480, position: 17, moving: true },
        filterWheel: {
          names: ['Lum', 'Ha'],
          focusOffsets: [0, -30],
          position: 1,
        },
      },
      { focuser: true, filterWheel: true },
    )
    assert.deepEqual(compact.focuser?.state, {
      absolute: true,
      maxStep: 480,
      position: 17,
      moving: true,
    })
    assert.deepEqual(compact.filterWheel?.state, {
      names: ['Lum', 'Ha'],
      focusOffsets: [0, -30],
      position: 1,
    })
    await Effect.runPromise(compact.disconnect)
  },
)

alpacaTest(
  'Alpaca filter wheel waits for the requested position before committing state',
  async () => {
    const rig = await connect(
      {
        atPark: [],
        filterWheel: {
          names: ['Dark', 'IR', 'LP'],
          focusOffsets: [0, 0, 0],
          position: 0,
          positionResponses: [-1, 2],
        },
      },
      { filterWheel: true },
    )
    const filterWheel = rig.filterWheel

    assert.ok(filterWheel)
    await Effect.runPromise(filterWheel.setPosition(2))

    assert.equal(filterWheel.state.position, 2)
    assert.deepEqual(requests, [
      { method: 'PUT', path: '/api/v1/filterwheel/0/position' },
      { method: 'GET', path: '/api/v1/filterwheel/0/position' },
      { method: 'GET', path: '/api/v1/filterwheel/0/position' },
    ])
    await Effect.runPromise(rig.disconnect)
  },
)

alpacaTest(
  'Alpaca filter wheel preserves state when position polling fails',
  async () => {
    const rig = await connect(
      {
        atPark: [],
        filterWheel: {
          names: ['Dark', 'IR', 'LP'],
          focusOffsets: [0, 0, 0],
          position: 0,
          positionResponses: [-1, 'rejected'],
        },
      },
      { filterWheel: true },
    )
    const filterWheel = rig.filterWheel

    assert.ok(filterWheel)
    await assert.rejects(
      Effect.runPromise(filterWheel.setPosition(2)),
      (error: unknown) =>
        error instanceof RigRejectedError && error.operation === 'filterWheel.setPosition',
    )
    assert.equal(filterWheel.state.position, 0)
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

test('Seestar adapter exposes unpark only as a closed-mount horizon move', async () => {
  let closed = true
  let moves = 0
  let signal: AbortSignal | undefined
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => ({
        ...createFakeSeestarDevice({
          snapshot: () => ({
            deviceState: { mount: { close: closed } },
            viewState: null,
          }),
        }),
        moveToHorizon: async (wait) => {
          moves++
          signal = wait.signal
          closed = false
          return true
        },
      }),
    }),
  )
  const unpark = rig.mount?.unpark
  const controller = new AbortController()

  assert.ok(unpark)
  await Effect.runPromise(unpark({ signal: controller.signal }))
  await Effect.runPromise(unpark())

  assert.equal(moves, 1)
  assert.equal(signal, controller.signal)
  await Effect.runPromise(rig.disconnect)
})

test('Seestar unpark maps a rejected horizon move to RigRejectedError', async () => {
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => ({
        ...createFakeSeestarDevice({
          snapshot: () => ({
            deviceState: { mount: { close: true } },
            viewState: null,
          }),
        }),
        moveToHorizon: async () => false,
      }),
    }),
  )
  const unpark = rig.mount?.unpark

  assert.ok(unpark)
  await assert.rejects(
    Effect.runPromise(unpark()),
    (error: unknown) =>
      error instanceof RigRejectedError && error.operation === 'mount.unpark',
  )
  await Effect.runPromise(rig.disconnect)
})

test('Seestar adapter preserves preflight telemetry in rig snapshots', async () => {
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => ({
        ...createFakeSeestarDevice(),
        preflightCheck: async () => ({
          host: '127.0.0.1',
          batteryPercent: 83,
          deviceTempC: 32,
          batteryTempC: 29,
          storageFreeMb: 4096,
          storageTotalMb: 8192,
          deviceTime: { year: 1970, mon: 1, day: 1, hour: 0, min: 0, sec: 0 },
          deviceTimeLooksStale: true,
          raw: {
            deviceState: null,
            viewState: null,
            setting: null,
            diskVolume: null,
            piInfo: null,
            time: null,
          },
          warnings: ['Device clock appears stale at 1970-01-01 00:00:00'],
        }),
      }),
    }),
  )

  assert.deepEqual(rig.snapshot.telemetry, {
    batteryPercent: 83,
    deviceTempC: 32,
    batteryTempC: 29,
    storageFreeMb: 4096,
    storageTotalMb: 8192,
    deviceTime: { year: 1970, mon: 1, day: 1, hour: 0, min: 0, sec: 0 },
    deviceTimeLooksStale: true,
  })
  await Effect.runPromise(rig.disconnect)
})

test('Seestar prepare refreshes synchronized clock telemetry and warnings', async () => {
  let preflightCalls = 0
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => ({
        ...createFakeSeestarDevice(),
        preflightCheck: async () => {
          preflightCalls++
          const stale = preflightCalls === 1
          return {
            host: '127.0.0.1',
            deviceTime: stale
              ? { year: 2020, mon: 6, day: 29, hour: 7, min: 36, sec: 53 }
              : { year: 2026, mon: 7, day: 17, hour: 12, min: 0, sec: 0 },
            deviceTimeLooksStale: stale,
            raw: {
              deviceState: null,
              viewState: null,
              setting: null,
              diskVolume: null,
              piInfo: null,
              time: null,
            },
            warnings: stale ? ['Device clock appears stale'] : [],
          }
        },
      }),
    }),
  )
  const prepare = rig.pointing?.prepare

  try {
    assert.ok(prepare)
    await Effect.runPromise(prepare({ lat: 39.755, lon: -74.2679 }))

    assert.equal(preflightCalls, 2)
    assert.equal(rig.snapshot.telemetry?.deviceTimeLooksStale, true)
    const refreshed = await Effect.runPromise(rig.refresh)
    assert.deepEqual(refreshed.telemetry?.deviceTime, {
      year: 2026,
      mon: 7,
      day: 17,
      hour: 12,
      min: 0,
      sec: 0,
    })
    assert.equal(refreshed.telemetry?.deviceTimeLooksStale, false)
    assert.deepEqual(refreshed.warnings, [])
  } finally {
    await Effect.runPromise(rig.disconnect)
  }
})

test('Seestar observer synchronization refreshes telemetry without issuing movement commands', async () => {
  let preflightCalls = 0
  let synchronizedLocation: { lat: number; lon: number } | undefined
  let synchronizedTime = 0
  const movementCommands: string[] = []
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => ({
        ...createFakeSeestarDevice(),
        preflightCheck: async () => {
          preflightCalls++
          const stale = preflightCalls === 1
          return {
            host: '127.0.0.1',
            location: { lat: 39.755, lon: -74.2679 },
            deviceTime: stale
              ? { year: 2020, mon: 6, day: 29, hour: 7, min: 36, sec: 53 }
              : { year: 2026, mon: 7, day: 17, hour: 12, min: 0, sec: 0 },
            deviceTimeLooksStale: stale,
            raw: {
              deviceState: null,
              viewState: null,
              setting: null,
              diskVolume: null,
              piInfo: null,
              time: null,
            },
            warnings: stale ? ['Device clock appears stale'] : [],
          }
        },
        setTime: async () => {
          synchronizedTime++
          return true
        },
        setUserLocation: async (lat, lon) => {
          synchronizedLocation = { lat, lon }
          return true
        },
        moveToHorizon: async () => {
          movementCommands.push('moveToHorizon')
          return true
        },
        park: async () => {
          movementCommands.push('park')
          return true
        },
        startView: async () => {
          movementCommands.push('startView')
          return true
        },
      }),
    }),
  )
  const synchronizeObserver = rig.synchronizeObserver

  try {
    assert.ok(synchronizeObserver)
    const synchronized = await Effect.runPromise(
      synchronizeObserver({ observerLocation: rig.observerLocation }),
    )

    assert.equal(synchronizedTime, 1)
    assert.deepEqual(synchronizedLocation, { lat: 39.755, lon: -74.2679 })
    assert.equal(preflightCalls, 2)
    assert.deepEqual(synchronized.snapshot.telemetry?.deviceTime, {
      year: 2026,
      mon: 7,
      day: 17,
      hour: 12,
      min: 0,
      sec: 0,
    })
    assert.equal(synchronized.snapshot.telemetry?.deviceTimeLooksStale, false)
    assert.deepEqual(synchronized.snapshot.warnings, [])
    assert.deepEqual(movementCommands, [])
  } finally {
    await Effect.runPromise(rig.disconnect)
  }
})

test('Seestar observer synchronization syncs host time when no location is available', async () => {
  let preflightCalls = 0
  let synchronizedTime = 0
  let synchronizedLocation = 0
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => ({
        ...createFakeSeestarDevice(),
        preflightCheck: async () => {
          preflightCalls++
          return {
            host: '127.0.0.1',
            raw: {
              deviceState: null,
              viewState: null,
              setting: null,
              diskVolume: null,
              piInfo: null,
              time: null,
            },
            warnings: ['User location is not available in device state'],
          }
        },
        setTime: async () => {
          synchronizedTime++
          return true
        },
        setUserLocation: async () => {
          synchronizedLocation++
          return true
        },
      }),
    }),
  )
  const synchronizeObserver = rig.synchronizeObserver

  try {
    assert.ok(synchronizeObserver)
    const synchronized = await Effect.runPromise(synchronizeObserver({}))

    assert.equal(synchronizedTime, 1)
    assert.equal(synchronizedLocation, 0)
    assert.equal(preflightCalls, 2)
    assert.equal(synchronized.observerLocation, undefined)
  } finally {
    await Effect.runPromise(rig.disconnect)
  }
})

test('Seestar observer synchronization maps rejected and failed host-time syncs', async () => {
  const rejectedRig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => ({ ...createFakeSeestarDevice(), setTime: async () => false }),
    }),
  )
  const rejectedSync = rejectedRig.synchronizeObserver

  try {
    assert.ok(rejectedSync)
    await assert.rejects(
      Effect.runPromise(rejectedSync({})),
      (error: unknown) =>
        error instanceof RigRejectedError && error.operation === 'observer.synchronize',
    )
  } finally {
    await Effect.runPromise(rejectedRig.disconnect)
  }

  const failedRig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => ({
        ...createFakeSeestarDevice(),
        setTime: async () => {
          throw new Error('connection closed')
        },
      }),
    }),
  )
  const failedSync = failedRig.synchronizeObserver

  try {
    assert.ok(failedSync)
    await assert.rejects(
      Effect.runPromise(failedSync({})),
      (error: unknown) =>
        error instanceof RigTransportError && error.operation === 'observer.synchronize.setTime',
    )
  } finally {
    await Effect.runPromise(failedRig.disconnect)
  }
})

test('Seestar prepare preserves stale telemetry and warnings when location synchronization fails', async () => {
  let preflightCalls = 0
  const rig = await Effect.runPromise(
    createSeestarRig({
      rigId: 'test',
      host: '127.0.0.1',
      displayName: 'Test Seestar',
      pemPath: '/unused.pem',
      deviceFactory: () => ({
        ...createFakeSeestarDevice(),
        preflightCheck: async () => {
          preflightCalls++
          return {
            host: '127.0.0.1',
            deviceTime: { year: 2020, mon: 6, day: 29, hour: 7, min: 36, sec: 53 },
            deviceTimeLooksStale: true,
            raw: {
              deviceState: null,
              viewState: null,
              setting: null,
              diskVolume: null,
              piInfo: null,
              time: null,
            },
            warnings: ['Device clock appears stale'],
          }
        },
        setUserLocation: async () => false,
      }),
    }),
  )
  const prepare = rig.pointing?.prepare

  try {
    assert.ok(prepare)
    await assert.rejects(
      Effect.runPromise(prepare({ lat: 39.755, lon: -74.2679 })),
      (error: unknown) =>
        error instanceof RigRejectedError && error.operation === 'pointing.prepare',
    )

    assert.equal(preflightCalls, 1)
    const refreshed = await Effect.runPromise(rig.refresh)
    assert.equal(refreshed.telemetry?.deviceTimeLooksStale, true)
    assert.deepEqual(refreshed.warnings, ['Device clock appears stale'])
  } finally {
    await Effect.runPromise(rig.disconnect)
  }
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
