import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { Effect } from 'effect'
import { EventBusLive } from '../event/event-bus'
import { createAlpacaPlugin, toDiscoveredRig } from './alpaca-plugin'

const requests: { path: string; method: string }[] = []
let scenario: AlpacaScenario = { atParkValues: [] }
let port = 0
const plugin = createAlpacaPlugin()

interface AlpacaScenario {
  atParkDefault?: boolean
  atParkValues: boolean[]
  canUnpark?: boolean
  slewingDefault?: boolean
  slewingValues?: boolean[]
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', `http://${request.headers.host}`)
    .pathname
  const method = request.method ?? 'GET'
  requests.push({ path, method })

  if (method === 'GET' && path === '/management/v1/configureddevices') {
    response.end(
      JSON.stringify({
        Value: [
          {
            DeviceName: 'Example Mount',
            DeviceType: 'Telescope',
            DeviceNumber: 0,
            UniqueID: 'mount-test',
          },
        ],
        ErrorNumber: 0,
      }),
    )
    return
  }

  const scripted = getScriptedResponse(method, path)
  if (!scripted) {
    response.statusCode = 405
    response.end(JSON.stringify({ ErrorNumber: 1, ErrorMessage: `Unexpected ${request.method} ${path}` }))
    return
  }
  response.end(JSON.stringify(scripted))
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
  const session = await Effect.runPromise(
    plugin
      .connect({
        pluginKind: 'alpaca-rig',
        deviceId: 'alpaca:telescope:mount-test',
      })
      .pipe(Effect.provide(EventBusLive)),
  )
  requests.length = 0
  return session
}

function getScriptedResponse(method: string, path: string) {
  if (method === 'PUT' && [
    '/api/v1/telescope/0/connected',
    '/api/v1/telescope/0/park',
    '/api/v1/telescope/0/unpark',
    '/api/v1/telescope/0/slewtocoordinatesasync',
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
