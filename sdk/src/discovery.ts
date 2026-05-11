import * as dgram from "node:dgram";
import type { Logger } from "./logging.js";
import { emitLog } from "./logging.js";

export interface DiscoveryOptions {
  port?: number;
  timeoutMs?: number;
  broadcastAddress?: string;
  logger?: Logger;
  sessionId?: string;
}

export interface DiscoveredSeestar {
  host: string;
  port: number;
  result: Record<string, unknown>;
}

/** Discover Seestar devices on the local network using UDP scan_iscope. */
export async function discoverSeestars(
  options: DiscoveryOptions = {}
): Promise<DiscoveredSeestar[]> {
  const discoveryPort = options.port ?? 4720;
  const timeoutMs = options.timeoutMs ?? 3000;
  const broadcastAddress = options.broadcastAddress ?? "255.255.255.255";
  const payload = Buffer.from(
    JSON.stringify({ id: 1, method: "scan_iscope", params: "" }) + "\r\n"
  );

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const devices = new Map<string, DiscoveredSeestar>();
    let settled = false;

    emitLog(options.logger, {
      level: "info",
      event: "discovery.scan.started",
      component: "discovery",
      phase: "connect",
      sessionId: options.sessionId,
      summary: "Started UDP scan for Seestar devices",
      data: {
        port: discoveryPort,
        timeoutMs,
        broadcastAddress,
      },
    });

    const finish = () => {
      if (settled) return;
      settled = true;
      socket.close();
      emitLog(options.logger, {
        level: "info",
        event: "discovery.scan.completed",
        component: "discovery",
        phase: "connect",
        sessionId: options.sessionId,
        summary: `Completed UDP scan with ${devices.size} discovered device(s)`,
        data: { foundCount: devices.size },
      });
      resolve([...devices.values()]);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.close();
      emitLog(options.logger, {
        level: "error",
        event: "discovery.scan.failed",
        component: "discovery",
        phase: "connect",
        sessionId: options.sessionId,
        summary: "UDP discovery scan failed",
        error: err.message,
      });
      reject(err);
    };

    const timer = setTimeout(finish, timeoutMs);

    socket.on("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });

    socket.on("message", (msg, rinfo) => {
      try {
        const parsed = JSON.parse(msg.toString("utf8")) as Record<string, unknown>;
        if (parsed.method !== "scan_iscope") return;
        const result = parsed.result;
        if (typeof result !== "object" || result === null) return;
        devices.set(rinfo.address, {
          host: rinfo.address,
          port: 4700,
          result: result as Record<string, unknown>,
        });
        emitLog(options.logger, {
          level: "info",
          event: "discovery.device.found",
          component: "discovery",
          phase: "connect",
          sessionId: options.sessionId,
          host: rinfo.address,
          summary: "Found Seestar on local network",
          data: {
            productModel: (result as Record<string, unknown>).product_model,
            sn: (result as Record<string, unknown>).sn,
            ssid: (result as Record<string, unknown>).ssid,
            tcpClientNum: (result as Record<string, unknown>).tcp_client_num,
          },
        });
      } catch {
        // Ignore non-Seestar or malformed UDP packets.
      }
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(payload, discoveryPort, broadcastAddress, (err) => {
        if (err) {
          clearTimeout(timer);
          fail(err);
        }
      });
    });
  });
}

export async function discoverSeestarHost(
  options: DiscoveryOptions = {}
): Promise<string> {
  const devices = await discoverSeestars(options);
  const first = devices[0];
  if (!first) {
    throw new Error("No Seestar devices discovered on the local network");
  }
  return first.host;
}
