import { app, WebContents } from "electron";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import {
  SeestarDevice,
  discoverSeestars,
  type LogEvent,
  type Logger,
} from "../../../../sdk/dist/index.js";
import type {
  DesktopCommandRequest,
  ConnectRequest,
  DesktopDiscoveredDevice,
  DesktopLogEntry,
  DesktopPreviewFrame,
  DesktopPreviewState,
  DesktopStatus,
} from "../shared/api";

const LOG_LIMIT = 250;
const PREVIEW_MODE = "rtsp-mjpeg" as const;
const PREVIEW_FRAME_RATE = 5;
const PREVIEW_JPEG_QUALITY = 3;
const MAX_PREVIEW_BUFFER_BYTES = 2 * 1024 * 1024;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

export class SeestarDesktopService {
  private device: SeestarDevice | null = null;
  private logs: DesktopLogEntry[] = [];
  private status: DesktopStatus = {
    connected: false,
    authenticated: false,
    deviceState: null,
    viewState: null,
    preview: createDefaultPreviewState(),
  };
  private subscribers = new Set<WebContents>();
  private previewProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private previewBuffer = Buffer.alloc(0);
  private previewStopRequested = false;
  private previewLastStderr: string | undefined;
  private logger: Logger = {
    log: (event) => {
      this.applyLogSideEffects(event);
      const entry = toDesktopLogEntry(event);
      this.logs = [...this.logs.slice(-(LOG_LIMIT - 1)), entry];
      for (const subscriber of this.subscribers) {
        if (!subscriber.isDestroyed()) {
          subscriber.send("seestar:log", entry);
        }
      }
    },
  };

  attachRenderer(webContents: WebContents): void {
    this.subscribers.add(webContents);
    webContents.once("destroyed", () => {
      this.subscribers.delete(webContents);
    });
  }

  async discover(): Promise<DesktopDiscoveredDevice[]> {
    const devices = await discoverSeestars({ timeoutMs: 2500, logger: this.logger });
    return devices.map((device) => ({
      host: device.host,
      port: device.port,
      productModel: asString(device.result.product_model),
      serialNumber: asString(device.result.sn),
      ssid: asString(device.result.ssid),
    }));
  }

  async connect(input: ConnectRequest): Promise<DesktopStatus> {
    const host = input.host.trim();
    if (!host) {
      throw new Error("Host is required to connect to a Seestar device");
    }

    this.disconnectDevice();

    const device = new SeestarDevice({
      host,
      pemPath: this.resolvePemPath(),
      timeoutMs: 10000,
      discoveryTimeoutMs: 2500,
      traceProtocol: false,
      logger: this.logger,
    });

    try {
      await device.connect();
      const authenticated = await device.authenticate();
      if (!authenticated) {
        device.disconnect();
        throw new Error("Authentication failed. Verify the PEM key and device firmware.");
      }

      this.device = device;
      this.status = {
        connected: true,
        authenticated: true,
        host,
        deviceState: null,
        viewState: null,
        preview: createDefaultPreviewState(),
        lastUpdatedAt: new Date().toISOString(),
      };
      return this.refreshState();
    } catch (error) {
      this.status = {
        connected: false,
        authenticated: false,
        host,
        deviceState: null,
        viewState: null,
        preview: createDefaultPreviewState(),
        lastError: toErrorMessage(error),
        lastUpdatedAt: new Date().toISOString(),
      };
      this.emitStatus();
      throw error;
    }
  }

  async disconnect(): Promise<DesktopStatus> {
    this.disconnectDevice();
    this.status = {
      connected: false,
      authenticated: false,
      deviceState: null,
      viewState: null,
      preview: createDefaultPreviewState(),
      lastUpdatedAt: new Date().toISOString(),
    };
    this.emitStatus();
    return this.getStatus();
  }

  async refreshState(): Promise<DesktopStatus> {
    if (!this.device || !this.device.isConnected()) {
      this.stopPreviewProcess();
      this.status = {
        ...this.status,
        connected: false,
        authenticated: false,
        deviceState: null,
        viewState: null,
        preview: createDefaultPreviewState(),
        lastUpdatedAt: new Date().toISOString(),
      };
      this.emitStatus();
      return this.getStatus();
    }

    try {
      const [deviceState, viewState] = await Promise.all([
        this.device.getDeviceState(),
        this.device.getViewState(),
      ]);
      this.status = {
        ...this.status,
        connected: this.device.isConnected(),
        authenticated: true,
        deviceState: (deviceState ?? null) as Record<string, unknown> | null,
        viewState: (viewState ?? null) as Record<string, unknown> | null,
        lastError: undefined,
        lastUpdatedAt: new Date().toISOString(),
      };
      this.emitStatus();
      return this.getStatus();
    } catch (error) {
      this.disconnectDevice();
      this.status = {
        ...this.status,
        connected: false,
        authenticated: false,
        deviceState: null,
        viewState: null,
        preview: createDefaultPreviewState(),
        lastError: toErrorMessage(error),
        lastUpdatedAt: new Date().toISOString(),
      };
      this.emitStatus();
      throw error;
    }
  }

  async startPreview(): Promise<DesktopStatus> {
    if (!this.device || !this.device.isConnected()) {
      throw new Error("Connect to a Seestar device before starting live preview");
    }

    const host = this.status.host?.trim();
    if (!host) {
      throw new Error("No Seestar host is available for RTSP preview");
    }

    const viewMode = this.readViewMode();
    if (viewMode !== "scenery") {
      throw new Error("Start Scenery view before starting live preview");
    }

    this.stopPreviewProcess();

    const rtspUrl = buildRtspUrl(host);
    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-rtsp_transport",
      "tcp",
      "-fflags",
      "nobuffer",
      "-flags",
      "low_delay",
      "-i",
      rtspUrl,
      "-an",
      "-vf",
      `fps=${PREVIEW_FRAME_RATE}`,
      "-q:v",
      String(PREVIEW_JPEG_QUALITY),
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ];

    const previewProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.previewProcess = previewProcess;
    this.previewBuffer = Buffer.alloc(0);
    this.previewStopRequested = false;
    this.previewLastStderr = undefined;
    this.status = {
      ...this.status,
      preview: {
        active: true,
        mode: PREVIEW_MODE,
        rtspUrl,
      },
      lastUpdatedAt: new Date().toISOString(),
    };
    this.emitStatus();

    previewProcess.stdout.on("data", (chunk: Buffer) => {
      if (this.previewProcess !== previewProcess) return;
      this.consumePreviewChunk(chunk);
    });
    previewProcess.stderr.setEncoding("utf8");
    previewProcess.stderr.on("data", (chunk: string) => {
      if (this.previewProcess !== previewProcess) return;
      this.consumePreviewStderr(chunk);
    });
    previewProcess.once("error", (error) => {
      if (this.previewProcess !== previewProcess) return;
      this.handlePreviewFailure(toErrorMessage(error));
    });
    previewProcess.once("exit", (code, signal) => {
      if (this.previewProcess !== previewProcess) return;
      if (this.previewStopRequested) return;
      this.handlePreviewFailure(describePreviewExit(code, signal, this.previewLastStderr));
    });

    return this.getStatus();
  }

  async stopPreview(): Promise<DesktopStatus> {
    this.stopPreviewProcess();
    this.status = {
      ...this.status,
      preview: createDefaultPreviewState(),
      lastUpdatedAt: new Date().toISOString(),
    };
    this.emitStatus();
    return this.getStatus();
  }

  getStatus(): DesktopStatus {
    return {
      ...this.status,
      preview: { ...this.status.preview },
    };
  }

  getLogs(): DesktopLogEntry[] {
    return [...this.logs];
  }

  dispose(): void {
    this.disconnectDevice();
  }

  async runCommand(input: DesktopCommandRequest): Promise<DesktopStatus> {
    const device = this.requireConnectedDevice();
    let stopPreview = false;

    switch (input.action) {
      case "open-arm":
        await this.expectAccepted(device.moveToHorizon(), "Device rejected move-to-horizon request");
        break;
      case "park":
        await this.expectAccepted(device.park(), "Device rejected park request");
        stopPreview = true;
        break;
      case "start-view": {
        const mode = input.mode;
        if (!mode) {
          throw new Error("View mode is required to start a view");
        }
        await this.expectAccepted(device.startView(mode), `Device rejected ${mode} view request`);
        stopPreview = mode !== "scenery";
        break;
      }
      case "stop-view":
        await this.expectAccepted(device.stopView(), "Device rejected stop-view request");
        stopPreview = true;
        break;
      case "start-stack":
        await this.expectAccepted(device.startStack(true), "Device rejected start-stack request");
        break;
      case "stop-stack":
        await this.expectAccepted(device.stopStack(), "Device rejected stop-stack request");
        break;
      case "autofocus":
        await this.expectAccepted(device.startAutoFocus(), "Device rejected autofocus request");
        break;
      default:
        throw new Error(`Unsupported device command: ${String(input.action)}`);
    }

    if (stopPreview) {
      this.stopPreviewProcess();
      this.status = {
        ...this.status,
        preview: createDefaultPreviewState(),
      };
    }

    return this.refreshState();
  }

  private disconnectDevice(): void {
    this.stopPreviewProcess();
    if (!this.device) return;
    this.device.disconnect();
    this.device = null;
  }

  private requireConnectedDevice(): SeestarDevice {
    if (!this.device || !this.device.isConnected()) {
      throw new Error("Connect to a Seestar device before sending commands");
    }
    return this.device;
  }

  private async expectAccepted(work: Promise<boolean>, message: string): Promise<void> {
    const ok = await work;
    if (!ok) {
      throw new Error(message);
    }
  }

  private resolvePemPath(): string {
    return path.resolve(app.getAppPath(), "seestar_3.1.2_fw_7.32_interop.pem");
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const subscriber of this.subscribers) {
      if (!subscriber.isDestroyed()) {
        subscriber.send("seestar:status", status);
      }
    }
  }

  private applyLogSideEffects(event: LogEvent): void {
    if (event.event !== "connection.tcp.closed" && event.event !== "connection.tcp.error") {
      return;
    }

    this.stopPreviewProcess();
    this.device = null;
    this.status = {
      ...this.status,
      connected: false,
      authenticated: false,
      deviceState: null,
      viewState: null,
      preview: createDefaultPreviewState(),
      lastError: event.event === "connection.tcp.error" ? event.error ?? event.summary : undefined,
      lastUpdatedAt: new Date().toISOString(),
    };
    this.emitStatus();
  }

  private readViewMode(): string | undefined {
    const viewState = asRecord(this.status.viewState);
    const view = asRecord(viewState?.View);
    return asString(view?.mode);
  }

  private stopPreviewProcess(): void {
    if (!this.previewProcess) return;

    const previewProcess = this.previewProcess;
    this.previewProcess = null;
    this.previewStopRequested = true;
    this.previewBuffer = Buffer.alloc(0);
    this.previewLastStderr = undefined;
    previewProcess.removeAllListeners();
    previewProcess.stdout.removeAllListeners();
    previewProcess.stderr.removeAllListeners();
    previewProcess.kill("SIGTERM");
  }

  private consumePreviewStderr(chunk: string): void {
    const lines = chunk
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      this.previewLastStderr = lines[lines.length - 1];
    }
  }

  private consumePreviewChunk(chunk: Buffer): void {
    this.previewBuffer = Buffer.concat([this.previewBuffer, chunk]);

    if (this.previewBuffer.length > MAX_PREVIEW_BUFFER_BYTES) {
      const start = this.previewBuffer.lastIndexOf(JPEG_SOI);
      this.previewBuffer = start >= 0 ? this.previewBuffer.subarray(start) : Buffer.alloc(0);
    }

    while (true) {
      const start = this.previewBuffer.indexOf(JPEG_SOI);
      if (start === -1) {
        this.previewBuffer = Buffer.alloc(0);
        return;
      }

      if (start > 0) {
        this.previewBuffer = this.previewBuffer.subarray(start);
      }

      const end = this.previewBuffer.indexOf(JPEG_EOI, JPEG_SOI.length);
      if (end === -1) {
        return;
      }

      const frame = this.previewBuffer.subarray(0, end + JPEG_EOI.length);
      this.previewBuffer = this.previewBuffer.subarray(end + JPEG_EOI.length);
      this.emitPreviewFrame(frame);
    }
  }

  private emitPreviewFrame(frame: Buffer): void {
    const ts = new Date().toISOString();
    this.status = {
      ...this.status,
      preview: {
        ...this.status.preview,
        active: true,
        mode: PREVIEW_MODE,
        lastFrameAt: ts,
        lastError: undefined,
      },
    };

    const payload: DesktopPreviewFrame = {
      ts,
      dataUrl: `data:image/jpeg;base64,${frame.toString("base64")}`,
    };

    for (const subscriber of this.subscribers) {
      if (!subscriber.isDestroyed()) {
        subscriber.send("seestar:preview-frame", payload);
      }
    }
  }

  private handlePreviewFailure(message: string): void {
    this.previewProcess = null;
    this.previewStopRequested = false;
    this.previewBuffer = Buffer.alloc(0);
    this.previewLastStderr = undefined;
    this.status = {
      ...this.status,
      preview: {
        ...createDefaultPreviewState(),
        lastError: message,
      },
      lastUpdatedAt: new Date().toISOString(),
    };
    this.emitStatus();
  }
}

function createDefaultPreviewState(): DesktopPreviewState {
  return {
    active: false,
    mode: PREVIEW_MODE,
  };
}

function buildRtspUrl(host: string): string {
  return `rtsp://${host}:4554/stream`;
}

function describePreviewExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string | undefined
): string {
  if (stderr) return stderr;
  if (signal) return `RTSP preview stopped (${signal})`;
  if (typeof code === "number") return `RTSP preview exited with code ${code}`;
  return "RTSP preview ended unexpectedly";
}

function toDesktopLogEntry(event: LogEvent): DesktopLogEntry {
  return {
    ts: event.ts,
    level: event.level,
    event: event.event,
    component: event.component,
    summary: formatLogSummary(event),
    details: formatLogDetails(event),
    error: event.error,
    host: event.host,
    data: event.data,
  };
}

function formatLogSummary(event: LogEvent): string | undefined {
  const data = asRecord(event.data);
  const pushEventName = asString(data?.eventName);

  switch (event.event) {
    case "rpc.request.sent":
      return describeRpcSummary("Sent", event.method, event.rpcId, "request");
    case "rpc.response.received":
      return describeRpcSummary("Received", event.method, event.rpcId, "response");
    case "rpc.request.timeout":
      return describeRpcTimeout(event.method, event.rpcId);
    case "rpc.request.disconnected":
      return describeRpcDisconnect(event.method, event.rpcId);
    case "rpc.push.received":
      return pushEventName ? `Received ${pushEventName} device event` : event.summary;
    case "rpc.push.wait.started":
      return pushEventName ? `Waiting for ${pushEventName} device event` : event.summary;
    case "rpc.push.wait.matched":
      return pushEventName ? `Matched ${pushEventName} device event` : event.summary;
    case "rpc.push.wait.timeout":
      return pushEventName ? `Timed out waiting for ${pushEventName} device event` : event.summary;
    case "auth.challenge.received": {
      const challengeLength = asNumber(data?.challengeLength);
      return challengeLength === undefined
        ? event.summary
        : `Received authentication challenge (${challengeLength} chars)`;
    }
    default:
      return event.summary;
  }
}

function formatLogDetails(event: LogEvent): string | undefined {
  const data = asRecord(event.data);
  const details: string[] = [];
  const code = asNumber(data?.code);

  if (event.method) {
    details.push(`method ${event.method}`);
  }
  if (typeof event.rpcId === "number") {
    details.push(`rpc #${event.rpcId}`);
  }
  if (code !== undefined) {
    details.push(`code ${code}`);
  }
  if (typeof event.durationMs === "number") {
    details.push(`${event.durationMs} ms`);
  }

  const pushEventName = asString(data?.eventName);
  if (pushEventName) {
    details.push(`event ${pushEventName}`);
  }

  const pushState = asString(data?.state);
  if (pushState) {
    details.push(`state ${pushState}`);
  }

  const pushError = asString(data?.error);
  if (pushError) {
    details.push(`error ${pushError}`);
  }

  const challengeLength = asNumber(data?.challengeLength);
  if (challengeLength !== undefined && event.event !== "auth.challenge.received") {
    details.push(`challenge ${challengeLength} chars`);
  }

  return details.length > 0 ? details.join(" • ") : undefined;
}

function describeRpcSummary(
  verb: "Sent" | "Received",
  method: string | undefined,
  rpcId: number | undefined,
  noun: "request" | "response"
): string {
  const name = method ? `${method} ${noun}` : `RPC ${noun}`;
  return typeof rpcId === "number" ? `${verb} ${name} (#${rpcId})` : `${verb} ${name}`;
}

function describeRpcTimeout(method: string | undefined, rpcId: number | undefined): string {
  const name = method ? `${method} RPC response` : "RPC response";
  return typeof rpcId === "number"
    ? `Timed out waiting for ${name} (#${rpcId})`
    : `Timed out waiting for ${name}`;
}

function describeRpcDisconnect(method: string | undefined, rpcId: number | undefined): string {
  const name = method ? `${method} RPC response` : "RPC response";
  return typeof rpcId === "number"
    ? `Connection closed while waiting for ${name} (#${rpcId})`
    : `Connection closed while waiting for ${name}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
