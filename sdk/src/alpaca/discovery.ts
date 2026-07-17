import * as dgram from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { Schema } from 'effect'

const DISCOVERY_PORT = 32227
const PROBE_TIMEOUT_MS = 3000
const MAX_DISCOVERED_HOSTS = 16
const PROBE_CONCURRENCY = 4

const ConfiguredDevicesResponse = Schema.Struct({
  Value: Schema.Array(
    Schema.Struct({
      DeviceName: Schema.String,
      DeviceType: Schema.String,
      DeviceNumber: Schema.Number,
      UniqueID: Schema.optional(Schema.String),
    }),
  ),
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})

const DiscoveryResponse = Schema.Struct({
  AlpacaPort: Schema.Number,
  FriendlyName: Schema.optional(Schema.String),
  ProductName: Schema.optional(Schema.String),
})

interface DiscoveredHost {
  host: string
  port: number
  friendlyName?: string
  productName?: string
}

export interface DiscoveredAlpacaConfiguration {
  host: string
  port: number
  friendlyName?: string
  productName?: string
  telescopeName: string
  telescopeDeviceNumber: number
  telescopeUniqueId?: string
  cameraDeviceNumber?: number
  focuserDeviceNumber?: number
  filterWheelDeviceNumber?: number
}

export async function discoverAlpacaRigs(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<DiscoveredAlpacaConfiguration[]> {
  if (signal?.aborted) throw abortError()
  const hosts = await discoverHosts(timeoutMs, signal)
  const rigs = await probeHosts(hosts, signal)
  return rigs.filter(
    (rig): rig is DiscoveredAlpacaConfiguration => rig !== null,
  )
}

async function probeHosts(
  hosts: DiscoveredHost[],
  signal?: AbortSignal,
): Promise<Array<DiscoveredAlpacaConfiguration | null>> {
  const rigs: Array<DiscoveredAlpacaConfiguration | null> = Array.from(
    { length: hosts.length },
    () => null,
  )
  let next = 0
  const workers = Array.from(
    { length: Math.min(PROBE_CONCURRENCY, hosts.length) },
    async () => {
      while (next < hosts.length) {
        if (signal?.aborted) throw abortError()
        const index = next++
        const host = hosts[index]
        if (host) rigs[index] = await probeHost(host, signal)
      }
    },
  )
  await Promise.all(workers)
  return rigs
}

async function probeHost(
  host: DiscoveredHost,
  signal?: AbortSignal,
): Promise<DiscoveredAlpacaConfiguration | null> {
  try {
    const res = await fetch(
      `http://${host.host}:${host.port}/management/v1/configureddevices`,
      {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)])
            : AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    )
    if (!res.ok) return null
    const body = Schema.decodeUnknownSync(ConfiguredDevicesResponse)(
      await res.json(),
    )
    if (body.ErrorNumber !== 0) return null
    const telescope = body.Value.find(
      (device) => device.DeviceType === 'Telescope',
    )
    if (!telescope) return null
    const camera = body.Value.find((device) => device.DeviceType === 'Camera')
    const focuser = body.Value.find((device) => device.DeviceType === 'Focuser')
    const filterWheel = body.Value.find(
      (device) => device.DeviceType === 'FilterWheel',
    )
    return {
      host: host.host,
      port: host.port,
      friendlyName: host.friendlyName,
      productName: host.productName,
      telescopeName: telescope.DeviceName,
      telescopeDeviceNumber: telescope.DeviceNumber,
      telescopeUniqueId: telescope.UniqueID || undefined,
      cameraDeviceNumber: camera?.DeviceNumber,
      focuserDeviceNumber: focuser?.DeviceNumber,
      filterWheelDeviceNumber: filterWheel?.DeviceNumber,
    }
  } catch {
    if (signal?.aborted) throw abortError()
    return null
  }
}

function discoverHosts(timeoutMs: number, signal?: AbortSignal): Promise<DiscoveredHost[]> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    const hosts = new Map<string, DiscoveredHost>()
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try {
        socket.close()
      } catch {}
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve([...hosts.values()])
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError())
    }
    timer = setTimeout(finish, timeoutMs)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    socket.on('error', finish)
    socket.on('message', (message, info) => {
      try {
        const parsed = Schema.decodeUnknownSync(DiscoveryResponse)(
          JSON.parse(message.toString('utf8')) as unknown,
        )
        const key = `${info.address}:${parsed.AlpacaPort}`
        if (hosts.has(key)) return
        if (hosts.size >= MAX_DISCOVERED_HOSTS) return
        hosts.set(key, {
          host: info.address,
          port: parsed.AlpacaPort,
          friendlyName: parsed.FriendlyName,
          productName: parsed.ProductName,
        })
      } catch {
        // Ignore unrelated or malformed UDP packets.
      }
    })
    socket.bind(() => {
      if (settled) return
      socket.setBroadcast(true)
      const payload = Buffer.from('alpacadiscovery1')
      broadcastTargets().forEach((target) =>
        socket.send(payload, DISCOVERY_PORT, target, () => {}),
      )
    })
  })
}

function abortError(): Error {
  return new Error('Alpaca discovery aborted')
}

function broadcastTargets(): string[] {
  const targets = new Set<string>(['255.255.255.255'])
  Object.values(networkInterfaces()).forEach((entries) =>
    entries?.forEach((entry) => {
      if (entry.family !== 'IPv4' || entry.internal) return
      const address = entry.address.split('.').map(Number)
      const mask = entry.netmask.split('.').map(Number)
      if (address.length !== 4 || mask.length !== 4) return
      targets.add(
        address
          .map((octet, index) => (octet & mask[index]) | (~mask[index] & 255))
          .join('.'),
      )
    }),
  )
  return [...targets]
}
