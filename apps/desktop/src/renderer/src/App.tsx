import { useEffect, useMemo, useState } from "react";
import type {
  DesktopDiscoveredDevice,
  DesktopLogEntry,
  DesktopStatus,
} from "../../shared/api";

const EMPTY_STATUS: DesktopStatus = {
  connected: false,
  authenticated: false,
  deviceState: null,
};

export function App() {
  const [devices, setDevices] = useState<DesktopDiscoveredDevice[]>([]);
  const [status, setStatus] = useState<DesktopStatus>(EMPTY_STATUS);
  const [logs, setLogs] = useState<DesktopLogEntry[]>([]);
  const [host, setHost] = useState("192.168.4.29");
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

    return () => {
      offLog();
      offStatus();
    };
  }, []);

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
            <h2>Device state</h2>
            <p>Raw state returned by the SDK after authentication.</p>
          </div>
          <pre>{JSON.stringify(status.deviceState, null, 2) || "null"}</pre>
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
                  {entry.error ? <p>{entry.error}</p> : null}
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
