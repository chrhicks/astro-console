import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { Effect } from 'effect'
import { EventBusLive } from '../event/event-bus'
import { createAlpacaPlugin, toDiscoveredRig } from './alpaca-plugin'

const requests: { path: string; method: string }[] = []
let lastConnectRequests: { path: string; method: string }[] = []
let lastConnectMaxInFlightRequests = 0
let inFlightRequests = 0
let maxInFlightRequests = 0
let scenario: AlpacaScenario = { atParkValues: [] }
let port = 0
const plugin = createAlpacaPlugin()

interface AlpacaScenario {
  atParkDefault?: boolean
  atParkValues: boolean[]
  canUnpark?: boolean
  canUnparkSchemaError?: boolean
  responseDelayMs?: number
  slewingDefault?: boolean
  slewingValues?: boolean[]
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', `http://${request.headers.host}`)
    .pathname
  const method = request.method ?? 'GET'
  requests.push({ path, method })
  inFlightRequests += 1
  maxInFlightRequests = Math.max(maxInFlightRequests, inFlightRequests)
  const end = (body: object) => {
    const respond = () => {
      response.end(JSON.stringify(body))
      inFlightRequests -= 1
    }
    if (scenario.responseDelayMs) {
      setTimeout(respond, scenario.responseDelayMs)
      return
    }
    respond()
  }

  if (method === 'GET' && path === '/management/v1/configureddevices') {
    end({
      Value: [
        {
          DeviceName: 'Example Mount',
          DeviceType: 'Telescope',
          DeviceNumber: 0,
          UniqueID: 'mount-test',
        },
        {
          DeviceName: 'Example Camera',
          DeviceType: 'Camera',
          DeviceNumber: 0,
        },
      ],
      ErrorNumber: 0,
    })
    return
  }

  if (
    method === 'GET' &&
    path === '/api/v1/telescope/0/canunpark' &&
    scenario.canUnparkSchemaError
  ) {
    end({ Value: 'true', ErrorNumber: 0 })
    return
  }

  const scripted = getScriptedResponse(method, path)
  if (!scripted) {
    response.statusCode = 405
    end({ ErrorNumber: 1, ErrorMessage: `Unexpected ${request.method} ${path}` })
    return
  }
  end(scripted)
})
const discoverySocket = dgram.createSocket('udp4')

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  port = address.port

  discoverySocket.on('message', (message, info) => {
    if (message.toString() !== 'alpacadiscovery1') return
    discoverySocket.send(
      Buffer.from(JSON.stringify({ AlpacaPort: port })),
      info.port,
      info.address,
    )
  })
  await new Promise<void>((resolve) => discoverySocket.bind(32227, resolve))

  await Effect.runPromise(plugin.discover)
})

after(async () => {
  await new Promise<void>((resolve) => discoverySocket.close(resolve))
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function connectMount(nextScenario: AlpacaScenario) {
  scenario = {
    ...nextScenario,
    atParkValues: [...nextScenario.atParkValues],
    slewingValues: [...(nextScenario.slewingValues ?? [])],
  }
  requests.length = 0
  maxInFlightRequests = 0
  const session = await Effect.runPromise(
    plugin
      .connect({
        pluginKind: 'alpaca-rig',
        deviceId: 'alpaca:telescope:mount-test',
      })
      .pipe(Effect.provide(EventBusLive)),
  )
  lastConnectRequests = [...requests]
  lastConnectMaxInFlightRequests = maxInFlightRequests
  requests.length = 0
  maxInFlightRequests = 0
  return session
}

function getScriptedResponse(method: string, path: string) {
  if (method === 'PUT' && [
    '/api/v1/telescope/0/connected',
    '/api/v1/telescope/0/park',
    '/api/v1/telescope/0/unpark',
    '/api/v1/telescope/0/slewtocoordinatesasync',
    '/api/v1/camera/0/connected',
  ].includes(path)) {
    return { ErrorNumber: 0 }
  }
  if (method !== 'GET') return null
  const value = getScriptedValue(path)
  return value === undefined ? null : { Value: value, ErrorNumber: 0 }
}

function getScriptedValue(path: string): boolean | number | string | undefined {
  switch (path) {
    case '/api/v1/telescope/0/atpark':
      return scenario.atParkValues.shift() ?? scenario.atParkDefault
    case '/api/v1/telescope/0/slewing':
      return scenario.slewingValues?.shift() ?? scenario.slewingDefault
    case '/api/v1/telescope/0/connected':
    case '/api/v1/telescope/0/canpark':
    case '/api/v1/telescope/0/tracking':
    case '/api/v1/telescope/0/canslew':
    case '/api/v1/telescope/0/canslewasync':
      return true
    case '/api/v1/telescope/0/canunpark':
      return scenario.canUnpark ?? false
    case '/api/v1/telescope/0/sitelatitude':
    case '/api/v1/telescope/0/sitelongitude':
      return 0
    case '/api/v1/telescope/0/driverversion':
      return '1.0'
    case '/api/v1/telescope/0/name':
      return 'Example Mount'
    case '/api/v1/camera/0/connected':
      return true
    case '/api/v1/camera/0/camerastate':
      return 0
    case '/api/v1/camera/0/imageready':
      return false
    case '/api/v1/camera/0/canstopexposure':
      return true
    case '/api/v1/camera/0/lastexposureduration':
      return 1
  }
}

test('maps vendor discovery facts to the desktop device identity', () => {
  const rig = toDiscoveredRig({
    host: '192.0.2.10',
    port: 11111,
    friendlyName: 'Observatory',
    telescopeName: 'Example Mount',
    telescopeDeviceNumber: 2,
    telescopeUniqueId: 'mount-1',
    cameraDeviceNumber: 3,
  })

  assert.equal(rig.pluginKind, 'alpaca-rig')
  assert.equal(rig.deviceId, 'alpaca:telescope:mount-1')
  assert.equal(rig.displayName, 'Example Mount')
  assert.equal(rig.cameraDeviceNumber, 3)
})

test('serializes connect and camera state reads for one Alpaca server', async () => {
  const session = await connectMount({
    atParkValues: [false, false],
    responseDelayMs: 5,
  })
  const camera = session.rig.camera

  assert.equal(lastConnectMaxInFlightRequests, 1)
  assert.deepEqual(lastConnectRequests, [
    { path: '/api/v1/telescope/0/connected', method: 'GET' },
    { path: '/api/v1/telescope/0/atpark', method: 'GET' },
    { path: '/api/v1/telescope/0/canpark', method: 'GET' },
    { path: '/api/v1/telescope/0/canunpark', method: 'GET' },
    { path: '/api/v1/telescope/0/tracking', method: 'GET' },
    { path: '/api/v1/telescope/0/sitelatitude', method: 'GET' },
    { path: '/api/v1/telescope/0/sitelongitude', method: 'GET' },
    { path: '/api/v1/telescope/0/canslew', method: 'GET' },
    { path: '/api/v1/telescope/0/canslewasync', method: 'GET' },
    { path: '/api/v1/telescope/0/driverversion', method: 'GET' },
    { path: '/api/v1/telescope/0/name', method: 'GET' },
    { path: '/api/v1/camera/0/connected', method: 'GET' },
    { path: '/api/v1/camera/0/camerastate', method: 'GET' },
    { path: '/api/v1/camera/0/imageready', method: 'GET' },
    { path: '/api/v1/camera/0/canstopexposure', method: 'GET' },
  ])
  assert.ok(camera)
  await Effect.runPromise(
    camera.getExposureState({ signal: new AbortController().signal }),
  )

  assert.equal(maxInFlightRequests, 1)
  assert.deepEqual(requests, [
    { path: '/api/v1/camera/0/camerastate', method: 'GET' },
    { path: '/api/v1/camera/0/imageready', method: 'GET' },
    { path: '/api/v1/camera/0/lastexposureduration', method: 'GET' },
  ])

  requests.length = 0
  maxInFlightRequests = 0
  await Effect.runPromise(session.rig.refresh)

  assert.equal(maxInFlightRequests, 1)
  assert.deepEqual(requests, [
    { path: '/api/v1/telescope/0/atpark', method: 'GET' },
    { path: '/api/v1/telescope/0/tracking', method: 'GET' },
  ])

  await Effect.runPromise(session.disconnect)
})

test('park skips the command and polling when the mount is parked with stale slewing', async () => {
  const session = await connectMount({ atParkValues: [true, true], slewingDefault: true })
  const mount = session.rig.mount

  assert.ok(mount?.park)
  await Effect.runPromise(mount.park({ signal: new AbortController().signal }))

  assert.deepEqual(requests, [
    { path: '/api/v1/telescope/0/atpark', method: 'GET' },
  ])

  await Effect.runPromise(session.disconnect)
})

test('connect omits unpark when canunpark is false', async () => {
  const session = await connectMount({ atParkValues: [], canUnpark: false })

  assert.equal(session.rig.mount?.unpark, undefined)

  await Effect.runPromise(session.disconnect)
})

test('connect fails on an invalid canunpark response and a fresh connect can succeed', async () => {
  scenario = { atParkValues: [], canUnparkSchemaError: true }
  requests.length = 0

  await assert.rejects(
    Effect.runPromise(
      plugin
        .connect({
          pluginKind: 'alpaca-rig',
          deviceId: 'alpaca:telescope:mount-test',
        })
        .pipe(Effect.provide(EventBusLive)),
    ),
    /Alpaca connect failed/,
  )

  const session = await connectMount({ atParkValues: [], canUnpark: true })
  assert.ok(session.rig.mount?.unpark)

  await Effect.runPromise(session.disconnect)
})

test('unpark commands a parked mount without slewing', async () => {
  const session = await connectMount({
    atParkValues: [true, true, false],
    canUnpark: true,
    slewingDefault: false,
  })
  const mount = session.rig.mount

  assert.ok(mount?.unpark)
  await Effect.runPromise(mount.unpark({ signal: new AbortController().signal }))

  assert.deepEqual(requests, [
    { path: '/api/v1/telescope/0/atpark', method: 'GET' },
    { path: '/api/v1/telescope/0/unpark', method: 'PUT' },
    { path: '/api/v1/telescope/0/atpark', method: 'GET' },
    { path: '/api/v1/telescope/0/slewing', method: 'GET' },
  ])
  assert.equal(
    requests.some((request) => request.path.includes('/slewtocoordinates')),
    false,
  )

  await Effect.runPromise(session.disconnect)
})

test('pointing waits for a stable unparked state before it slews', async () => {
  const session = await connectMount({
    atParkDefault: false,
    atParkValues: [true, true, false, false, false],
    canUnpark: true,
    slewingDefault: false,
    slewingValues: [true, true, false, false, false],
  })
  const pointing = session.rig.pointing

  assert.ok(pointing)
  await Effect.runPromise(
    pointing.prepare(
      { lat: 0, lon: 0 },
      { signal: new AbortController().signal },
    ),
  )
  await Effect.runPromise(
    pointing.pointToCoordinates(
      { targetType: 'dso', raHours: 1, decDeg: 2 },
      { signal: new AbortController().signal },
    ),
  )

  const unpark = requests.findIndex((request) =>
    request.path.endsWith('/unpark'),
  )
  const stable = requests.findIndex(
    (request, index) =>
      index > unpark &&
      request.path.endsWith('/slewing') &&
      requests[index - 1]?.path.endsWith('/atpark'),
  )
  const slew = requests.findIndex((request) =>
    request.path.endsWith('/slewtocoordinatesasync'),
  )
  assert.ok(unpark >= 0)
  assert.ok(stable > unpark)
  assert.ok(slew > stable)

  await Effect.runPromise(session.disconnect)
})

test('pointing fails without a slew when the mount cannot unpark', async () => {
  const session = await connectMount({ atParkValues: [true, true], slewingDefault: true })
  const pointing = session.rig.pointing

  assert.ok(pointing)
  await assert.rejects(
    Effect.runPromise(
      pointing.prepare(
        { lat: 0, lon: 0 },
        { signal: new AbortController().signal },
      ),
    ),
    /Mount is parked and cannot unpark; no slew was sent/,
  )
  assert.equal(
    requests.some((request) =>
      request.path.endsWith('/slewtocoordinatesasync'),
    ),
    false,
  )

  await Effect.runPromise(session.disconnect)
})

test('pointing fails without a slew when slewing never settles', async () => {
  const session = await connectMount({
    atParkValues: [],
    atParkDefault: false,
    slewingDefault: true,
  })
  const pointing = session.rig.pointing

  assert.ok(pointing)
  await assert.rejects(
    Effect.runPromise(
      pointing.prepare(
        { lat: 0, lon: 0 },
        { signal: new AbortController().signal },
      ),
    ),
    /Mount did not settle before slew; no slew was sent/,
  )
  assert.equal(
    requests.some((request) =>
      request.path.endsWith('/slewtocoordinatesasync'),
    ),
    false,
  )

  await Effect.runPromise(session.disconnect)
})

test('park commands an unparked mount then polls until it is parked', async () => {
  const session = await connectMount({ atParkValues: [false, false, true] })
  const mount = session.rig.mount

  assert.ok(mount?.park)
  await Effect.runPromise(mount.park({ signal: new AbortController().signal }))

  assert.deepEqual(requests, [
    { path: '/api/v1/telescope/0/atpark', method: 'GET' },
    { path: '/api/v1/telescope/0/park', method: 'PUT' },
    { path: '/api/v1/telescope/0/atpark', method: 'GET' },
  ])

  await Effect.runPromise(session.disconnect)
})
