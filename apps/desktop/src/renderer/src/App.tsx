import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  DesktopCommandAction,
  DesktopDiscoveredDevice,
  DesktopLogEntry,
  DesktopPreviewFrame,
  DesktopStatus,
  DesktopViewMode,
} from "../../shared/api";

const EMPTY_STATUS: DesktopStatus = {
  connected: false,
  authenticated: false,
  deviceState: null,
  viewState: null,
  preview: {
    active: false,
    mode: "rtsp-mjpeg",
  },
};

const VIEW_MODES: DesktopViewMode[] = ["scenery", "star", "moon", "sun", "planet"];

export function App() {
  const [devices, setDevices] = useState<DesktopDiscoveredDevice[]>([]);
  const [status, setStatus] = useState<DesktopStatus>(EMPTY_STATUS);
  const [logs, setLogs] = useState<DesktopLogEntry[]>([]);
  const [previewFrame, setPreviewFrame] = useState<DesktopPreviewFrame | null>(null);
  const [host, setHost] = useState("192.168.4.29");
  const [viewMode, setViewMode] = useState<DesktopViewMode>("scenery");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([window.seestar.getStatus(), window.seestar.getLogs()])
      .then(([nextStatus, nextLogs]) => {
        setStatus(nextStatus);
        setLogs(nextLogs);
      })
      .catch((startupError: unknown) => {
        setError(toErrorMessage(startupError));
      });

    const offLog = window.seestar.onLog((entry) => {
      setLogs((current) => [...current.slice(-199), entry]);
    });
    const offStatus = window.seestar.onStatus((nextStatus) => {
      setStatus(nextStatus);
    });
    const offPreviewFrame = window.seestar.onPreviewFrame((nextFrame) => {
      setPreviewFrame(nextFrame);
    });

    return () => {
      offLog();
      offStatus();
      offPreviewFrame();
    };
  }, []);

  useEffect(() => {
    if (status.preview.active) return;
    setPreviewFrame(null);
  }, [status.preview.active]);

  useEffect(() => {
    if (!status.connected) return;
    const timer = window.setInterval(() => {
      void window.seestar.refreshState().catch((refreshError: unknown) => {
        setError(toErrorMessage(refreshError));
      });
    }, 15000);
    return () => {
      window.clearInterval(timer);
    };
  }, [status.connected]);

  const statusTone = useMemo(() => {
    if (status.connected && status.authenticated) return "healthy";
    if (status.lastError) return "error";
    return "idle";
  }, [status.authenticated, status.connected, status.lastError]);

  const summary = useMemo(() => summarizeStatus(status), [status]);

  const alerts = useMemo(() => {
    const nextAlerts: string[] = [];

    if (typeof summary.batteryPercent === "number" && summary.batteryPercent < 20) {
      nextAlerts.push(`Battery is low at ${summary.batteryPercent}%`);
    }
    if (typeof summary.deviceTempC === "number" && summary.deviceTempC >= 55) {
      nextAlerts.push(`Device temperature is elevated at ${summary.deviceTempC} C`);
    }
    if (typeof summary.batteryTempC === "number" && summary.batteryTempC >= 45) {
      nextAlerts.push(`Battery temperature is elevated at ${summary.batteryTempC} C`);
    }
    if (summary.mountClosed) {
      nextAlerts.push("Mount is currently parked/closed");
    }

    return nextAlerts;
  }, [summary.batteryPercent, summary.batteryTempC, summary.deviceTempC, summary.mountClosed]);

  const rawStatusJson = useMemo(
    () => JSON.stringify({ deviceState: status.deviceState, viewState: status.viewState, preview: status.preview }, null, 2) ?? "null",
    [status.deviceState, status.preview, status.viewState]
  );

  const previewUpdatedAt = previewFrame?.ts ?? status.preview.lastFrameAt;

  async function runAction(action: string, work: () => Promise<void>) {
    setBusyAction(action);
    setError(null);
    try {
      await work();
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  function runDeviceCommand(action: DesktopCommandAction, input: { action: DesktopCommandAction; mode?: DesktopViewMode }) {
    return runAction(action, async () => {
      const nextStatus = await window.seestar.runCommand(input);
      setStatus(nextStatus);
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Seestar Desktop</p>
          <h1>Discovery, connection, and state</h1>
        </div>
        <div className={`status-pill ${statusTone}`}>
          {status.connected && status.authenticated ? "Connected" : "Disconnected"}
        </div>
      </header>

      <main className="dashboard">
        <section className="panel controls">
          <div className="panel-heading">
            <h2>Connect</h2>
            <p>Use discovery for LAN devices or enter a host directly.</p>
          </div>

          <label className="field">
            <span>Host</span>
            <input value={host} onChange={(event) => setHost(event.target.value)} placeholder="192.168.4.29" />
          </label>

          <div className="actions">
            <button
              onClick={() =>
                void runAction("discover", async () => {
                  const discovered = await window.seestar.discover();
                  setDevices(discovered);
                  if (discovered[0]?.host) setHost(discovered[0].host);
                })
              }
              disabled={Boolean(busyAction)}
            >
              {busyAction === "discover" ? "Scanning..." : "Discover"}
            </button>
            <button
              className="primary"
              onClick={() =>
                void runAction("connect", async () => {
                  const nextStatus = await window.seestar.connect({ host });
                  setStatus(nextStatus);
                })
              }
              disabled={Boolean(busyAction) || !host.trim()}
            >
              {busyAction === "connect" ? "Connecting..." : "Connect"}
            </button>
            <button
              onClick={() =>
                void runAction("refresh", async () => {
                  const nextStatus = await window.seestar.refreshState();
                  setStatus(nextStatus);
                })
              }
              disabled={Boolean(busyAction) || !status.connected}
            >
              Refresh state
            </button>
            <button
              onClick={() =>
                void runAction("disconnect", async () => {
                  const nextStatus = await window.seestar.disconnect();
                  setStatus(nextStatus);
                })
              }
              disabled={Boolean(busyAction) || !status.connected}
            >
              Disconnect
            </button>
          </div>

          {error ? <p className="message error">{error}</p> : null}
          {status.lastError ? <p className="message error">{status.lastError}</p> : null}

          <div className="connection-summary">
            <div>
              <span className="meta-label">Current host</span>
              <strong>{status.host ?? "None"}</strong>
            </div>
            <div>
              <span className="meta-label">Updated</span>
              <strong>{status.lastUpdatedAt ? new Date(status.lastUpdatedAt).toLocaleString() : "Never"}</strong>
            </div>
          </div>
        </section>

        <section className="panel discovered">
          <div className="panel-heading">
            <h2>Discovered devices</h2>
            <p>{devices.length === 0 ? "No discovery results yet." : `${devices.length} device(s) found.`}</p>
          </div>
          <div className="device-list">
            {devices.map((device) => (
              <button
                key={device.host}
                className="device-card"
                onClick={() => setHost(device.host)}
                type="button"
              >
                <strong>{device.productModel ?? "Seestar"}</strong>
                <span>{device.host}</span>
                <span>{device.serialNumber ?? "No serial reported"}</span>
                <span>{device.ssid ?? "SSID unavailable"}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel state">
          <div className="panel-heading">
            <h2>Device overview</h2>
            <p>Readable status plus a small set of immediate device actions.</p>
          </div>

          <div className="status-grid">
            <StatusCard title="Device">
              <StatusField label="Model" value={summary.productModel ?? "Unknown"} />
              <StatusField label="Firmware" value={summary.firmwareVersion ?? "Unknown"} />
              <StatusField label="Serial" value={summary.serialNumber ?? "Unknown"} />
              <StatusField label="Verified" value={formatBoolean(summary.verified, "Yes", "No")} />
            </StatusCard>

            <StatusCard title="Power and thermal">
              <StatusField label="Battery" value={formatPercent(summary.batteryPercent)} />
              <StatusField
                label="Device temp"
                value={formatTemperature(summary.deviceTempC, summary.tempUnit)}
              />
              <StatusField
                label="Battery temp"
                value={formatTemperature(summary.batteryTempC, summary.tempUnit)}
              />
              <StatusField
                label="Heaters"
                value={formatHeaters(summary.exposureHeaterEnabled, summary.dewHeaterEnabled)}
              />
            </StatusCard>

            <StatusCard title="Mount and view">
              <StatusField label="Mount" value={formatBoolean(summary.mountClosed, "Parked", "Ready")} />
              <StatusField label="Tracking" value={formatBoolean(summary.tracking, "On", "Off")} />
              <StatusField label="EQ mode" value={formatBoolean(summary.equMode, "On", "Off")} />
              <StatusField label="View" value={formatView(summary)} />
            </StatusCard>

            <StatusCard title="Environment">
              <StatusField label="Target" value={summary.targetName ?? "None"} />
              <StatusField label="SSID" value={summary.stationSsid ?? "Unknown"} />
              <StatusField label="Location" value={formatLocation(summary.location)} />
              <StatusField label="Host" value={status.host ?? "None"} />
            </StatusCard>
          </div>

          {alerts.map((message) => (
            <p key={message} className="message warning">
              {message}
            </p>
          ))}

          <section className="state-controls">
            <div className="panel-heading panel-subheading">
              <h3>Controls</h3>
              <p>These are manual device commands sent over the authenticated SDK connection.</p>
            </div>

            <div className="actions state-action-row top-action-row">
              <button
                className="primary"
                onClick={() => void runDeviceCommand("open-arm", { action: "open-arm" })}
                disabled={Boolean(busyAction) || !status.connected || summary.mountClosed === false}
              >
                {busyAction === "open-arm" ? "Opening arm..." : "Open arm"}
              </button>
              <button
                onClick={() => void runDeviceCommand("park", { action: "park" })}
                disabled={Boolean(busyAction) || !status.connected || summary.mountClosed === true}
              >
                {busyAction === "park" ? "Parking..." : "Park"}
              </button>
            </div>

            <div className="inline-controls">
              <label className="field compact-field">
                <span>View mode</span>
                <select value={viewMode} onChange={(event) => setViewMode(event.target.value as DesktopViewMode)}>
                  {VIEW_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {toTitleCase(mode)}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className="primary"
                onClick={() =>
                  void runDeviceCommand("start-view", { action: "start-view", mode: viewMode })
                }
                disabled={Boolean(busyAction) || !status.connected}
              >
                {busyAction === "start-view" ? "Starting..." : "Start view"}
              </button>

              <button
                onClick={() => void runDeviceCommand("stop-view", { action: "stop-view" })}
                disabled={Boolean(busyAction) || !status.connected}
              >
                {busyAction === "stop-view" ? "Stopping..." : "Stop view"}
              </button>
            </div>

            <div className="actions state-action-row">
              <button
                onClick={() => void runDeviceCommand("autofocus", { action: "autofocus" })}
                disabled={Boolean(busyAction) || !status.connected}
              >
                {busyAction === "autofocus" ? "Running autofocus..." : "Autofocus"}
              </button>
              <button
                onClick={() => void runDeviceCommand("start-stack", { action: "start-stack" })}
                disabled={Boolean(busyAction) || !status.connected}
              >
                {busyAction === "start-stack" ? "Starting stack..." : "Start stack"}
              </button>
              <button
                onClick={() => void runDeviceCommand("stop-stack", { action: "stop-stack" })}
                disabled={Boolean(busyAction) || !status.connected}
              >
                {busyAction === "stop-stack" ? "Stopping stack..." : "Stop stack"}
              </button>
            </div>
          </section>

          <section className="preview-panel">
            <div className="panel-heading panel-subheading">
              <h3>Live preview</h3>
              <p>Scenery mode RTSP is decoded in the Electron main process and pushed here as JPEG frames.</p>
            </div>

            <div className="actions state-action-row">
              <button
                className="primary"
                onClick={() =>
                  void runAction("start-preview", async () => {
                    const nextStatus = await window.seestar.startPreview();
                    setStatus(nextStatus);
                  })
                }
                disabled={
                  Boolean(busyAction) ||
                  !status.connected ||
                  status.preview.active ||
                  summary.viewMode !== "scenery"
                }
              >
                {busyAction === "start-preview" ? "Starting preview..." : "Start preview"}
              </button>
              <button
                onClick={() =>
                  void runAction("stop-preview", async () => {
                    const nextStatus = await window.seestar.stopPreview();
                    setStatus(nextStatus);
                  })
                }
                disabled={Boolean(busyAction) || !status.preview.active}
              >
                {busyAction === "stop-preview" ? "Stopping preview..." : "Stop preview"}
              </button>
            </div>

            {summary.viewMode !== "scenery" ? (
              <p className="message warning">Start Scenery view first. The Seestar only exposes this RTSP feed while that mode is active.</p>
            ) : null}
            {status.preview.lastError ? <p className="message error">{status.preview.lastError}</p> : null}

            <div className="preview-meta">
              <div>
                <span className="meta-label">Transport</span>
                <strong>{status.preview.mode}</strong>
              </div>
              <div>
                <span className="meta-label">Source</span>
                <strong>{status.preview.rtspUrl ?? "Not active"}</strong>
              </div>
              <div>
                <span className="meta-label">Last frame</span>
                <strong>{previewUpdatedAt ? new Date(previewUpdatedAt).toLocaleTimeString() : "None yet"}</strong>
              </div>
            </div>

            <div className="preview-shell">
              {previewFrame ? (
                <img className="preview-frame" src={previewFrame.dataUrl} alt="Live Seestar preview" />
              ) : (
                <div className="preview-placeholder">
                  {status.preview.active
                    ? "Waiting for the first frame from ffmpeg..."
                    : "No live preview yet. Start Scenery mode, then start preview."}
                </div>
              )}
            </div>
          </section>

          <details className="raw-state">
            <summary>Raw status JSON</summary>
            <pre>{rawStatusJson}</pre>
          </details>
        </section>

        <section className="panel logs">
          <div className="panel-heading">
            <h2>SDK logs</h2>
            <p>Live logs streamed from the Electron main process.</p>
          </div>
          <div className="log-list">
            {logs.length === 0 ? <p className="empty">No logs yet.</p> : null}
            {logs
              .slice()
              .reverse()
              .map((entry, index) => (
                <article key={`${entry.ts}-${entry.event}-${index}`} className={`log-entry level-${entry.level}`}>
                  <div className="log-meta">
                    <span>{new Date(entry.ts).toLocaleTimeString()}</span>
                    <span>{entry.level}</span>
                    <span>{entry.component}</span>
                    <span>{entry.event}</span>
                  </div>
                  <strong>{entry.summary ?? "Log event"}</strong>
                  {entry.details ? <p className="log-detail">{entry.details}</p> : null}
                  {entry.error ? <p className="log-error">{entry.error}</p> : null}
                </article>
              ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function summarizeStatus(status: DesktopStatus): DeviceSummary {
  const deviceState = asRecord(status.deviceState);
  const device = asRecord(deviceState?.device);
  const piStatus = asRecord(deviceState?.pi_status);
  const mount = asRecord(deviceState?.mount);
  const station = asRecord(deviceState?.station);
  const setting = asRecord(deviceState?.setting);
  const viewState = asRecord(status.viewState);
  const view = asRecord(viewState?.View);

  return {
    productModel: asString(device?.product_model) ?? asString(device?.user_product_model),
    serialNumber: asString(device?.sn),
    firmwareVersion: asString(device?.firmware_ver_string),
    verified: asBoolean(device?.is_verified),
    stationSsid: asString(station?.ssid),
    batteryPercent: asNumber(piStatus?.battery_capacity),
    deviceTempC: asNumber(piStatus?.temp),
    batteryTempC: asNumber(piStatus?.battery_temp),
    mountClosed: asBoolean(mount?.close),
    tracking: asBoolean(mount?.tracking),
    equMode: asBoolean(mount?.equ_mode),
    viewMode: asString(view?.mode),
    viewStage: asString(view?.stage),
    viewState: asString(view?.state),
    targetName: asString(view?.target_name),
    location: readLocation(deviceState?.location_lon_lat),
    tempUnit: asString(setting?.temp_unit),
    exposureHeaterEnabled: asBoolean(setting?.exp_heater_enable),
    dewHeaterEnabled: asBoolean(setting?.heater_enable),
  };
}

function formatPercent(value: number | undefined): string {
  return typeof value === "number" ? `${value}%` : "Unknown";
}

function formatTemperature(value: number | undefined, unit = "C"): string {
  if (typeof value !== "number") return "Unknown";
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${rounded} ${unit}`;
}

function formatBoolean(
  value: boolean | undefined,
  truthy: string,
  falsy: string,
  fallback = "Unknown"
): string {
  if (typeof value !== "boolean") return fallback;
  return value ? truthy : falsy;
}

function formatHeaters(exposure: boolean | undefined, dew: boolean | undefined): string {
  const parts: string[] = [];

  if (typeof exposure === "boolean") parts.push(`Lens ${exposure ? "on" : "off"}`);
  if (typeof dew === "boolean") parts.push(`Dew ${dew ? "on" : "off"}`);

  return parts.length > 0 ? parts.join(" / ") : "Unknown";
}

function formatView(summary: DeviceSummary): string {
  const parts = [summary.viewMode, summary.viewStage, summary.viewState].filter(
    (part): part is string => Boolean(part)
  );

  return parts.length > 0 ? parts.join(" / ") : "Idle";
}

function formatLocation(location: DeviceSummary["location"]): string {
  if (!location) return "Unknown";
  return `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readLocation(value: unknown): { lat: number; lon: number } | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;

  const [lon, lat] = value;
  if (typeof lat !== "number" || typeof lon !== "number") return undefined;

  return { lat, lon };
}

function StatusCard(props: { title: string; children: ReactNode }) {
  return (
    <article className="status-card">
      <h3>{props.title}</h3>
      <div className="status-card-body">{props.children}</div>
    </article>
  );
}

function StatusField(props: { label: string; value: string }) {
  return (
    <div className="status-field">
      <span className="meta-label">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

interface DeviceSummary {
  productModel?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  verified?: boolean;
  stationSsid?: string;
  batteryPercent?: number;
  deviceTempC?: number;
  batteryTempC?: number;
  mountClosed?: boolean;
  tracking?: boolean;
  equMode?: boolean;
  viewMode?: string;
  viewStage?: string;
  viewState?: string;
  targetName?: string;
  location?: {
    lat: number;
    lon: number;
  };
  tempUnit?: string;
  exposureHeaterEnabled?: boolean;
  dewHeaterEnabled?: boolean;
}
