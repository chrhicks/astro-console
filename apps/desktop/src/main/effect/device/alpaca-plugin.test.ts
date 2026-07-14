import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { Effect } from 'effect'
import { EventBusLive } from '../event/event-bus'
import { createAlpacaPlugin, toDiscoveredRig } from './alpaca-plugin'

const requests: { path: string; method: string }[] = []
let atParkValues: boolean[] = []
let atParkDefault = false
let canUnpark = false
let port = 0
let slewingDefault = false
let slewingValues: boolean[] = []
const plugin = createAlpacaPlugin()
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', `http://${request.headers.host}`)
    .pathname
  requests.push({ path, method: request.method ?? 'GET' })

  if (path === '/management/v1/configureddevices') {
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

  if (request.method === 'PUT') {
    response.end(JSON.stringify({ ErrorNumber: 0 }))
    return
  }

  const value = path.endsWith('/atpark')
    ? (atParkValues.shift() ?? atParkDefault)
    : path.endsWith('/slewing')
      ? (slewingValues.shift() ?? slewingDefault)
      : path.endsWith('/connected') ||
          path.endsWith('/canpark') ||
          path.endsWith('/tracking')
        ? true
        : path.endsWith('/canunpark')
          ? canUnpark
          : path.endsWith('/canslew') || path.endsWith('/canslewasync')
            ? true
            : path.endsWith('/sitelatitude') || path.endsWith('/sitelongitude')
              ? 0
              : path.endsWith('/driverversion')
                ? '1.0'
                : 'Example Mount'
  response.end(JSON.stringify({ Value: value, ErrorNumber: 0 }))
})
const discoverySocket = dgram.createSocket('udp4')

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  port = address.port

  discoverySocket.on('message', (_message, info) => {
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

async function connectMount(
  values: boolean[],
  options: {
    atParkDefault?: boolean
    canUnpark?: boolean
    slewingDefault?: boolean
    slewingValues?: boolean[]
  } = {},
) {
  atParkValues = values
  atParkDefault = options.atParkDefault ?? false
  canUnpark = options.canUnpark ?? false
  slewingDefault = options.slewingDefault ?? false
  slewingValues = options.slewingValues ?? []
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
  const session = await connectMount([true, true], { slewingDefault: true })
  const mount = session.rig.mount

  assert.ok(mount?.park)
  await Effect.runPromise(mount.park({ signal: new AbortController().signal }))

  assert.deepEqual(requests, [
    { path: '/api/v1/telescope/0/atpark', method: 'GET' },
  ])

  await Effect.runPromise(session.disconnect)
})

test('pointing waits for a stable unparked state before it slews', async () => {
  const session = await connectMount([true, true, false, false, false], {
    canUnpark: true,
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
  const session = await connectMount([true, true], { slewingDefault: true })
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
  const session = await connectMount([false], {
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
  const session = await connectMount([false, false, true])
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
