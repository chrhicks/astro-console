import * as dgram from 'node:dgram'
import * as dns from 'node:dns/promises'
import * as net from 'node:net'
import { networkInterfaces } from 'node:os'
import type { Logger } from './logging.js'
import { emitLog } from './logging.js'

const MDNS_SEESTAR_HOSTNAME = 'seestar.local'
const CONTROL_PORT = 4700
const MAX_DISCOVERED_DEVICES = 16

export interface DiscoveryOptions {
  port?: number
  timeoutMs?: number
  broadcastAddress?: string
  logger?: Logger
  sessionId?: string
  signal?: AbortSignal
}

export interface DiscoveredSeestar {
  host: string
  port: number
  result: Record<string, unknown>
}

/** Discover Seestar devices on the local network using UDP scan_iscope. */
export async function discoverSeestars(
  options: DiscoveryOptions = {},
): Promise<DiscoveredSeestar[]> {
  if (options.signal?.aborted) throw abortError()
  const discoveryPort = options.port ?? 4720
  const timeoutMs = options.timeoutMs ?? 3000
  const broadcastAddress = options.broadcastAddress ?? '255.255.255.255'
  const targetAddresses = resolveDiscoveryTargets(broadcastAddress)
  const mdnsTimeoutMs = Math.max(250, Math.min(1000, Math.floor(timeoutMs / 3)))
  const payload = Buffer.from(
    JSON.stringify({ id: 1, method: 'scan_iscope', params: '' }) + '\r\n',
  )

  const mdnsDevice = await probeMdnsSeestar({
    timeoutMs: mdnsTimeoutMs,
    logger: options.logger,
    sessionId: options.sessionId,
    signal: options.signal,
  })
  if (options.signal?.aborted) throw abortError()

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    const devices = new Map<string, DiscoveredSeestar>()
    if (mdnsDevice) {
      devices.set(mdnsDevice.host, mdnsDevice)
    }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      try {
        socket.close()
      } catch {
        // The socket may be cancelled before bind completes.
      }
    }

    emitLog(options.logger, {
      level: 'info',
      event: 'discovery.scan.started',
      component: 'discovery',
      phase: 'connect',
      sessionId: options.sessionId,
      summary: 'Started UDP scan for Seestar devices',
      data: {
        port: discoveryPort,
        timeoutMs,
        mdnsTimeoutMs,
        broadcastAddress,
        targetAddresses,
        usedMdnsProbe: true,
      },
    })

    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      emitLog(options.logger, {
        level: 'info',
        event: 'discovery.scan.completed',
        component: 'discovery',
        phase: 'connect',
        sessionId: options.sessionId,
        summary: `Completed UDP scan with ${devices.size} discovered device(s)`,
        data: { foundCount: devices.size },
      })
      resolve([...devices.values()])
    }

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      emitLog(options.logger, {
        level: 'error',
        event: 'discovery.scan.failed',
        component: 'discovery',
        phase: 'connect',
        sessionId: options.sessionId,
        summary: 'UDP discovery scan failed',
        error: err.message,
      })
      reject(err)
    }

    const onAbort = () => fail(abortError())
    timer = setTimeout(finish, timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })

    socket.on('error', (err) => {
      clearTimeout(timer)
      fail(err)
    })

    socket.on('message', (msg, rinfo) => {
      try {
        const parsed = JSON.parse(msg.toString('utf8'))
        if (typeof parsed !== 'object' || parsed === null) return
        const record = parsed as Record<string, unknown>
        if (record.method !== 'scan_iscope') return
        const result = record.result
        if (typeof result !== 'object' || result === null) return
        if (!devices.has(rinfo.address) && devices.size >= MAX_DISCOVERED_DEVICES)
          return
        devices.set(rinfo.address, {
          host: rinfo.address,
          port: 4700,
          result: result as Record<string, unknown>,
        })
        emitLog(options.logger, {
          level: 'info',
          event: 'discovery.device.found',
          component: 'discovery',
          phase: 'connect',
          sessionId: options.sessionId,
          host: rinfo.address,
          summary: 'Found Seestar on local network',
          data: {
            productModel: (result as Record<string, unknown>).product_model,
            sn: (result as Record<string, unknown>).sn,
            ssid: (result as Record<string, unknown>).ssid,
            tcpClientNum: (result as Record<string, unknown>).tcp_client_num,
          },
        })
      } catch {
        // Ignore non-Seestar or malformed UDP packets.
      }
    })

    socket.bind(() => {
      if (settled) return
      socket.setBroadcast(true)
      let pendingSends = targetAddresses.length
      let successfulSends = 0
      const failedTargets: Array<{ targetAddress: string; error: string }> = []

      if (pendingSends === 0) {
        emitLog(options.logger, {
          level: 'warn',
          event: 'discovery.scan.broadcast.skipped',
          component: 'discovery',
          phase: 'connect',
          sessionId: options.sessionId,
          summary: 'No broadcast targets were available for UDP discovery',
        })
      }

      for (const targetAddress of targetAddresses) {
        socket.send(payload, discoveryPort, targetAddress, (err) => {
          if (settled) return
          if (err) {
            failedTargets.push({
              targetAddress,
              error: err.message,
            })
            emitLog(options.logger, {
              level: 'warn',
              event: 'discovery.scan.broadcast.failed',
              component: 'discovery',
              phase: 'connect',
              sessionId: options.sessionId,
              host: targetAddress,
              summary: 'UDP discovery payload failed for one broadcast target',
              error: err.message,
            })
          } else {
            successfulSends += 1
          }

          pendingSends -= 1
          if (pendingSends === 0) {
            emitLog(options.logger, {
              level: 'debug',
              event: 'discovery.scan.broadcast.sent',
              component: 'discovery',
              phase: 'connect',
              sessionId: options.sessionId,
              summary: `Sent UDP discovery payload to ${targetAddresses.length} broadcast target(s)`,
              data: {
                targetAddresses,
                successfulSends,
                failedTargets,
              },
            })
          }
        })
      }
    })
  })
}

export async function discoverSeestarHost(
  options: DiscoveryOptions = {},
): Promise<string> {
  const devices = await discoverSeestars(options)
  const first = devices[0]
  if (!first) {
    throw new Error('No Seestar devices discovered on the local network')
  }
  return first.host
}

function resolveDiscoveryTargets(globalBroadcastAddress: string): string[] {
  const targets = new Set<string>()

  for (const interfaceEntries of Object.values(networkInterfaces())) {
    if (!interfaceEntries) continue
    for (const entry of interfaceEntries) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      const broadcast = calculateBroadcastAddress(entry.address, entry.netmask)
      if (broadcast) targets.add(broadcast)
    }
  }

  if (globalBroadcastAddress && !targets.has(globalBroadcastAddress)) {
    targets.add(globalBroadcastAddress)
  }

  return [...targets]
}

async function probeMdnsSeestar(options: {
  timeoutMs: number
  logger?: Logger
  sessionId?: string
  signal?: AbortSignal
}): Promise<DiscoveredSeestar | null> {
  emitLog(options.logger, {
    level: 'debug',
    event: 'discovery.mdns.started',
    component: 'discovery',
    phase: 'connect',
    sessionId: options.sessionId,
    summary: `Probing ${MDNS_SEESTAR_HOSTNAME} over mDNS`,
    data: { timeoutMs: options.timeoutMs },
  })

  try {
    const resolved = await withTimeout(
      dns.lookup(MDNS_SEESTAR_HOSTNAME, { family: 4 }),
      options.timeoutMs,
      `mDNS lookup timed out for ${MDNS_SEESTAR_HOSTNAME}`,
      options.signal,
    )

    await probeTcpPort(
      resolved.address,
      CONTROL_PORT,
      options.timeoutMs,
      options.signal,
    )

    emitLog(options.logger, {
      level: 'info',
      event: 'discovery.mdns.succeeded',
      component: 'discovery',
      phase: 'connect',
      sessionId: options.sessionId,
      host: resolved.address,
      summary: `Resolved ${MDNS_SEESTAR_HOSTNAME} to reachable Seestar host`,
    })

    return {
      host: resolved.address,
      port: CONTROL_PORT,
      result: {
        source: 'mdns',
        hostname: MDNS_SEESTAR_HOSTNAME,
      },
    }
  } catch (error) {
    emitLog(options.logger, {
      level: 'debug',
      event: 'discovery.mdns.failed',
      component: 'discovery',
      phase: 'connect',
      sessionId: options.sessionId,
      summary: `mDNS probe failed for ${MDNS_SEESTAR_HOSTNAME}`,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function probeTcpPort(
  host: string,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      cleanup()
      socket.destroy()
      reject(new Error(`TCP probe timed out for ${host}:${port}`))
    }, timeoutMs)

    const onAbort = () => {
      cleanup()
      socket.destroy()
      reject(abortError())
    }

    socket.once('connect', () => {
      cleanup()
      socket.destroy()
      resolve()
    })

    socket.once('error', (error) => {
      cleanup()
      socket.destroy()
      reject(error)
    })
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(message))
    }, timeoutMs)

    const onAbort = () => {
      cleanup()
      reject(abortError())
    }

    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(): Error {
  return new Error('Discovery aborted')
}

function calculateBroadcastAddress(
  address: string,
  netmask: string,
): string | null {
  const addressOctets = parseIpv4Octets(address)
  const netmaskOctets = parseIpv4Octets(netmask)
  if (!addressOctets || !netmaskOctets) return null

  const broadcastOctets = addressOctets.map((octet, index) => {
    const maskOctet = netmaskOctets[index] ?? 0
    return (octet & maskOctet) | (~maskOctet & 255)
  })

  return broadcastOctets.join('.')
}

function parseIpv4Octets(value: string): number[] | null {
  const octets = value.split('.').map((part) => Number(part))
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null
  }
  return octets
}
