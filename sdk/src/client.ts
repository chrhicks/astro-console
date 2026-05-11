import * as net from "node:net";
import type { JsonRpcRequest, JsonRpcResponse } from "./types.js";
import type { Logger } from "./logging.js";
import { createNoopLogger, emitLog } from "./logging.js";

interface ClientObservabilityOptions {
  logger?: Logger;
  sessionId?: string;
  traceProtocol?: boolean;
  deviceModel?: string;
  deviceSn?: string;
}

/**
 * Low-level TCP JSON-RPC client for Seestar S30.
 * Handles framing (\r\n terminated JSON), message IDs, and synchronous response waiting.
 */
export class SeestarClient {
  private socket: net.Socket | null = null;
  private nextId = 1;
  private responseQueue = new Map<number, JsonRpcResponse>();
  private inflightRequests = new Map<number, { method: string; startedAt: number }>();
  private receiveBuffer = "";
  private connected = false;
  private logger: Logger;
  private sessionId?: string;
  private traceProtocol: boolean;
  private deviceModel?: string;
  private deviceSn?: string;

  constructor(
    private host: string,
    private port: number,
    private timeoutMs = 10000,
    observability: ClientObservabilityOptions = {}
  ) {
    this.logger = observability.logger ?? createNoopLogger();
    this.sessionId = observability.sessionId;
    this.traceProtocol = observability.traceProtocol ?? false;
    this.deviceModel = observability.deviceModel;
    this.deviceSn = observability.deviceSn;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const onError = (err: Error) => {
        cleanup();
        emitLog(this.logger, {
          level: "error",
          event: "connection.tcp.connect.failed",
          component: "connection",
          phase: "connect",
          sessionId: this.sessionId,
          host: this.host,
          deviceModel: this.deviceModel,
          deviceSn: this.deviceSn,
          durationMs: Date.now() - startedAt,
          summary: "Failed to connect to device control port",
          error: err.message,
          data: { port: this.port, timeoutMs: this.timeoutMs },
        });
        reject(err);
      };
      const onConnect = () => {
        cleanup();
        this.connected = true;
        emitLog(this.logger, {
          level: "info",
          event: "connection.tcp.connect.succeeded",
          component: "connection",
          phase: "connect",
          sessionId: this.sessionId,
          host: this.host,
          deviceModel: this.deviceModel,
          deviceSn: this.deviceSn,
          durationMs: Date.now() - startedAt,
          summary: "Connected to device control port",
          data: { port: this.port, timeoutMs: this.timeoutMs },
        });
        resolve();
      };
      const cleanup = () => {
        this.socket?.off("error", onError);
        this.socket?.off("connect", onConnect);
      };

      emitLog(this.logger, {
        level: "info",
        event: "connection.tcp.connect.started",
        component: "connection",
        phase: "connect",
        sessionId: this.sessionId,
        host: this.host,
        deviceModel: this.deviceModel,
        deviceSn: this.deviceSn,
        summary: "Connecting to device control port",
        data: { port: this.port, timeoutMs: this.timeoutMs },
      });

      this.socket = net.createConnection({ host: this.host, port: this.port });
      this.socket.setTimeout(this.timeoutMs);
      this.socket.once("connect", onConnect);
      this.socket.once("error", onError);
      this.socket.on("data", (data) => this.onData(data));
      this.socket.on("close", () => {
        this.connected = false;
        emitLog(this.logger, {
          level: "info",
          event: "connection.tcp.closed",
          component: "connection",
          phase: "connect",
          sessionId: this.sessionId,
          host: this.host,
          deviceModel: this.deviceModel,
          deviceSn: this.deviceSn,
          summary: "TCP connection to device closed",
          data: { port: this.port },
        });
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.receiveBuffer = "";
    this.inflightRequests.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Send a message and do not wait for a response. Returns the message id. */
  send(method: string, params?: unknown): number {
    if (!this.socket) throw new Error("Not connected");
    const id = this.nextId++;
    const msg: JsonRpcRequest = { id, method, params };
    const payload = JSON.stringify(msg) + "\r\n";
    this.inflightRequests.set(id, { method, startedAt: Date.now() });
    this.socket.write(payload);
    emitLog(this.logger, {
      level: "debug",
      event: "rpc.request.sent",
      component: "rpc",
      sessionId: this.sessionId,
      host: this.host,
      deviceModel: this.deviceModel,
      deviceSn: this.deviceSn,
      rpcId: id,
      method,
      summary: "Sent RPC request",
      data: this.traceProtocol ? { paramsPreview: previewValue(params, method) } : undefined,
    });
    return id;
  }

  /** Send a message and block until the matching response arrives. */
  async sendSync(
    method: string,
    params?: unknown,
    timeout = this.timeoutMs
  ): Promise<JsonRpcResponse> {
    const id = this.send(method, params);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.responseQueue.has(id)) {
        const resp = this.responseQueue.get(id)!;
        this.responseQueue.delete(id);
        return resp;
      }
      await sleep(50);
    }
    this.inflightRequests.delete(id);
    emitLog(this.logger, {
      level: "error",
      event: "rpc.request.timeout",
      component: "rpc",
      sessionId: this.sessionId,
      host: this.host,
      deviceModel: this.deviceModel,
      deviceSn: this.deviceSn,
      rpcId: id,
      method,
      durationMs: Date.now() - start,
      summary: "Timed out waiting for RPC response",
    });
    throw new Error(`Timeout waiting for response to ${method} (id=${id})`);
  }

  setDeviceIdentity(deviceModel?: string, deviceSn?: string): void {
    this.deviceModel = deviceModel;
    this.deviceSn = deviceSn;
  }

  private onData(data: Buffer): void {
    this.receiveBuffer += data.toString("utf-8");
    let idx: number;
    while ((idx = this.receiveBuffer.indexOf("\r\n")) >= 0) {
      const line = this.receiveBuffer.slice(0, idx);
      this.receiveBuffer = this.receiveBuffer.slice(idx + 2);
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed.Event === "string") {
          emitLog(this.logger, {
            level: "debug",
            event: "rpc.push.received",
            component: "rpc",
            sessionId: this.sessionId,
            host: this.host,
            deviceModel: this.deviceModel,
            deviceSn: this.deviceSn,
            summary: "Received unsolicited device event",
            data: {
              eventName: parsed.Event,
              preview: this.traceProtocol ? previewValue(parsed, undefined) : undefined,
            },
          });
          continue;
        }

        if (typeof parsed.id !== "number") continue;
        const response = parsed as unknown as JsonRpcResponse;
        const inflight = this.inflightRequests.get(response.id);
        this.inflightRequests.delete(response.id);
        emitLog(this.logger, {
          level: "debug",
          event: "rpc.response.received",
          component: "rpc",
          sessionId: this.sessionId,
          host: this.host,
          deviceModel: this.deviceModel,
          deviceSn: this.deviceSn,
          rpcId: response.id,
          method: response.method || inflight?.method,
          durationMs: inflight ? Date.now() - inflight.startedAt : undefined,
          summary: "Received RPC response",
          data: {
            code: response.code,
            resultPreview: this.traceProtocol ? previewValue(response.result, response.method) : undefined,
          },
        });
        this.responseQueue.set(response.id, response);
      } catch {
        emitLog(this.logger, {
          level: "warn",
          event: "rpc.response.parse_failed",
          component: "rpc",
          sessionId: this.sessionId,
          host: this.host,
          deviceModel: this.deviceModel,
          deviceSn: this.deviceSn,
          summary: "Failed to parse line-delimited device message",
          data: { linePreview: line.slice(0, 200) },
        });
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function previewValue(value: unknown, method?: string): unknown {
  if (method === "verify_client" && typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return {
      dataLength: typeof record.data === "string" ? record.data.length : undefined,
      sign: "[redacted]",
    };
  }
  if (
    (method === "pi_set_ap" || method === "pi_station_select") &&
    typeof value === "object" &&
    value !== null
  ) {
    const record = value as Record<string, unknown>;
    return {
      ...record,
      passwd: record.passwd ? "[redacted]" : undefined,
    };
  }
  return value;
}
