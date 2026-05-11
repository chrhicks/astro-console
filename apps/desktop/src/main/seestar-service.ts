import { app, WebContents } from "electron";
import path from "node:path";
import {
  SeestarDevice,
  discoverSeestars,
  type LogEvent,
  type Logger,
} from "../../../../sdk/dist/index.js";
import type {
  ConnectRequest,
  DesktopDiscoveredDevice,
  DesktopLogEntry,
  DesktopStatus,
} from "../shared/api";

const LOG_LIMIT = 250;

export class SeestarDesktopService {
  private device: SeestarDevice | null = null;
  private logs: DesktopLogEntry[] = [];
  private status: DesktopStatus = {
    connected: false,
    authenticated: false,
    deviceState: null,
  };
  private subscribers = new Set<WebContents>();
  private logger: Logger = {
    log: (event) => {
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
        lastUpdatedAt: new Date().toISOString(),
      };
      return this.refreshState();
    } catch (error) {
      this.status = {
        connected: false,
        authenticated: false,
        host,
        deviceState: null,
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
      lastUpdatedAt: new Date().toISOString(),
    };
    this.emitStatus();
    return this.getStatus();
  }

  async refreshState(): Promise<DesktopStatus> {
    if (!this.device || !this.device.isConnected()) {
      this.status = {
        ...this.status,
        connected: false,
        authenticated: false,
        deviceState: null,
        lastUpdatedAt: new Date().toISOString(),
      };
      this.emitStatus();
      return this.getStatus();
    }

    try {
      const deviceState = await this.device.getDeviceState();
      this.status = {
        ...this.status,
        connected: this.device.isConnected(),
        authenticated: true,
        deviceState: (deviceState ?? null) as Record<string, unknown> | null,
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
        lastError: toErrorMessage(error),
        lastUpdatedAt: new Date().toISOString(),
      };
      this.emitStatus();
      throw error;
    }
  }

  getStatus(): DesktopStatus {
    return { ...this.status };
  }

  getLogs(): DesktopLogEntry[] {
    return [...this.logs];
  }

  private disconnectDevice(): void {
    if (!this.device) return;
    this.device.disconnect();
    this.device = null;
  }

  private resolvePemPath(): string {
    return path.resolve(app.getAppPath(), "../..", "seestar_3.1.2_fw_7.32_interop.pem");
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const subscriber of this.subscribers) {
      if (!subscriber.isDestroyed()) {
        subscriber.send("seestar:status", status);
      }
    }
  }
}

function toDesktopLogEntry(event: LogEvent): DesktopLogEntry {
  return {
    ts: event.ts,
    level: event.level,
    event: event.event,
    component: event.component,
    summary: event.summary,
    error: event.error,
    host: event.host,
    data: event.data,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
