import * as dgram from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { Schema } from 'effect'

const DISCOVERY_PORT = 32227
const PROBE_TIMEOUT_MS = 3000

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
): Promise<DiscoveredAlpacaConfiguration[]> {
  const hosts = await discoverHosts(timeoutMs)
  const rigs = await Promise.all(hosts.map(probeHost))
  return rigs.filter(
    (rig): rig is DiscoveredAlpacaConfiguration => rig !== null,
  )
}

async function probeHost(
  host: DiscoveredHost,
): Promise<DiscoveredAlpacaConfiguration | null> {
  try {
    const res = await fetch(
      `http://${host.host}:${host.port}/management/v1/configureddevices`,
      {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
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
    return null
  }
}

function discoverHosts(timeoutMs: number): Promise<DiscoveredHost[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    const hosts = new Map<string, DiscoveredHost>()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      socket.close()
      resolve([...hosts.values()])
    }
    const timer = setTimeout(finish, timeoutMs)
    socket.on('error', () => {
      clearTimeout(timer)
      finish()
    })
    socket.on('message', (message, info) => {
      try {
        const parsed = Schema.decodeUnknownSync(DiscoveryResponse)(
          JSON.parse(message.toString('utf8')) as unknown,
        )
        const key = `${info.address}:${parsed.AlpacaPort}`
        if (hosts.has(key)) return
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
      socket.setBroadcast(true)
      const payload = Buffer.from('alpacadiscovery1')
      broadcastTargets().forEach((target) =>
        socket.send(payload, DISCOVERY_PORT, target, () => {}),
      )
    })
  })
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
