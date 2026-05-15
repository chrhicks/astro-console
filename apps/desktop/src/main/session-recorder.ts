import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LogEvent } from "../../../../sdk/dist/index.js";
import type { DesktopPlannerHealth, DesktopRecordingState, DesktopStatus } from "../shared/api";

const ARTIFACT_FILES = {
  session: "session.json",
  events: "events.jsonl",
  states: "state-snapshots.jsonl",
  commands: "commands.jsonl",
  errors: "errors.jsonl",
  summary: "summary.json",
  timeline: "timeline.txt",
} as const;

interface SessionRecorderOptions {
  getRootDir(): string;
  getAppVersion(): string;
}

interface StartSessionInput {
  requestedHost: string;
  trigger: string;
}

interface RecordCommandInput {
  action: string;
  params?: unknown;
  startedAt: number;
  ok: boolean;
  error?: string;
}

interface ActiveSession {
  id: string;
  dir: string;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  trigger: string;
  requestedHost?: string;
  resolvedHost?: string;
  deviceModel?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  lastStatusSignature?: string;
  lastStatusError?: string;
  lastError?: string;
  finalStatus?: RecordedStatusSummary;
  counts: {
    commandCount: number;
    commandFailures: number;
    sdkLogCount: number;
    sdkWarningCount: number;
    sdkErrorCount: number;
    stateSnapshotCount: number;
    previewStarts: number;
    previewStops: number;
  };
}

interface RecordedStatusSummary {
  connected: boolean;
  authenticated: boolean;
  host?: string;
  lastUpdatedAt?: string;
  lastError?: string;
  preview: {
    active: boolean;
    mode: string;
    lastFrameAt?: string;
    lastError?: string;
  };
  view?: {
    mode?: string;
    stage?: string;
    state?: string;
    targetName?: string;
  };
  planner?: {
    ready: boolean;
    activeSiteName?: string;
    discoveryMode: string;
    issues: string[];
  };
}

export class SeestarSessionRecorder {
  private activeSession: ActiveSession | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private options: SessionRecorderOptions) {}

  getState(): DesktopRecordingState {
    if (!this.activeSession || this.activeSession.endedAt) {
      return { active: false };
    }

    return {
      active: true,
      sessionId: this.activeSession.id,
      sessionDir: this.activeSession.dir,
      startedAt: this.activeSession.startedAt,
    };
  }

  async startSession(input: StartSessionInput): Promise<void> {
    await this.finalize("session.replaced");

    try {
      const startedAt = new Date().toISOString();
      const requestedHost = input.requestedHost.trim();
      const sessionId = randomUUID();
      const sessionDir = path.join(
        this.options.getRootDir(),
        `${formatTimestampForPath(startedAt)}__desktop__${sanitizePathSegment(requestedHost || "unknown-host")}__${sessionId.slice(0, 8)}`
      );

      await mkdir(sessionDir, { recursive: true });

      this.activeSession = {
        id: sessionId,
        dir: sessionDir,
        startedAt,
        trigger: input.trigger,
        requestedHost: requestedHost || undefined,
        counts: {
          commandCount: 0,
          commandFailures: 0,
          sdkLogCount: 0,
          sdkWarningCount: 0,
          sdkErrorCount: 0,
          stateSnapshotCount: 0,
          previewStarts: 0,
          previewStops: 0,
        },
      };

      await this.writeSessionManifest(this.activeSession);
      await this.recordEventForSession(this.activeSession, {
        ts: startedAt,
        kind: "session.started",
        summary: "Started desktop recording session",
        trigger: input.trigger,
        requestedHost: requestedHost || undefined,
      });
    } catch (error) {
      this.handleInternalError("start session", error);
      this.activeSession = null;
    }
  }

  recordSdkLog(event: LogEvent): void {
    const session = this.activeSession;
    if (!session || session.endedAt) return;

    session.counts.sdkLogCount += 1;
    if (event.level === "warn") session.counts.sdkWarningCount += 1;
    if (event.level === "error") session.counts.sdkErrorCount += 1;
    if (event.error) {
      session.lastError = event.error;
    }

    const payload = {
      ts: event.ts,
      kind: "sdk-log",
      level: event.level,
      event: event.event,
      component: event.component,
      phase: event.phase,
      method: event.method,
      rpcId: event.rpcId,
      summary: event.summary,
      error: event.error,
      durationMs: event.durationMs,
      host: event.host,
      data: cloneJsonValue(event.data),
    };

    this.enqueueWrite(async () => {
      await this.appendJsonLine(path.join(session.dir, ARTIFACT_FILES.events), payload);

      if (event.level === "warn" || event.level === "error" || event.error) {
        await this.appendJsonLine(path.join(session.dir, ARTIFACT_FILES.errors), payload);
      }

      if (shouldIncludeLogInTimeline(event)) {
        await this.appendTimelineLine(session, formatTimelineLogEntry(event));
      }
    });
  }

  recordCommand(input: RecordCommandInput): void {
    const session = this.activeSession;
    if (!session || session.endedAt) return;

    session.counts.commandCount += 1;
    if (!input.ok) session.counts.commandFailures += 1;
    if (input.action === "start-preview" && input.ok) session.counts.previewStarts += 1;
    if ((input.action === "stop-preview" || input.action === "disconnect") && input.ok) {
      session.counts.previewStops += 1;
    }
    if (input.error) {
      session.lastError = input.error;
    }

    const completedAt = new Date().toISOString();
    const payload = {
      ts: completedAt,
      action: input.action,
      ok: input.ok,
      durationMs: Date.now() - input.startedAt,
      params: cloneJsonValue(input.params),
      error: input.error,
    };

    this.enqueueWrite(async () => {
      await this.appendJsonLine(path.join(session.dir, ARTIFACT_FILES.commands), payload);
      await this.appendJsonLine(path.join(session.dir, ARTIFACT_FILES.events), {
        kind: "command.completed",
        summary: input.ok ? `Completed ${input.action}` : `Failed ${input.action}`,
        ...payload,
      });

      if (!input.ok) {
        await this.appendJsonLine(path.join(session.dir, ARTIFACT_FILES.errors), {
          kind: "command.failed",
          ...payload,
        });
      }

      const line = input.ok
        ? `${completedAt} OK command ${input.action} (${payload.durationMs} ms)`
        : `${completedAt} ERROR command ${input.action} (${payload.durationMs} ms) ${input.error ?? "Unknown failure"}`;
      await this.appendTimelineLine(session, line);
    });
  }

  recordStatus(status: DesktopStatus, reason: string): void {
    const session = this.activeSession;
    if (!session || session.endedAt) return;

    const snapshot = cloneStatus(status);
    const signature = JSON.stringify(snapshot);
    if (signature === session.lastStatusSignature) {
      return;
    }

    session.lastStatusSignature = signature;
    session.counts.stateSnapshotCount += 1;
    this.updateSessionIdentity(session, snapshot);
    session.finalStatus = summarizeStatus(snapshot);

    const statusError = snapshot.lastError || snapshot.preview.lastError;
    if (statusError) {
      session.lastError = statusError;
    }

    this.enqueueWrite(async () => {
      await this.appendJsonLine(path.join(session.dir, ARTIFACT_FILES.states), {
        ts: new Date().toISOString(),
        reason,
        status: snapshot,
      });
      await this.appendJsonLine(path.join(session.dir, ARTIFACT_FILES.events), {
        ts: new Date().toISOString(),
        kind: "status.snapshot",
        reason,
        summary: describeStatus(snapshot),
      });
      await this.appendTimelineLine(session, `${new Date().toISOString()} STATUS ${reason} ${describeStatus(snapshot)}`);

      if (statusError && statusError !== session.lastStatusError) {
        session.lastStatusError = statusError;
        await this.appendJsonLine(path.join(session.dir, ARTIFACT_FILES.errors), {
          ts: new Date().toISOString(),
          kind: "status.error",
          reason,
          error: statusError,
        });
      }

      await this.writeSessionManifest(session);
    });
  }

  async finalize(reason: string, finalStatus?: DesktopStatus): Promise<void> {
    const session = this.activeSession;
    if (!session) return;
    if (session.endedAt) return;

    try {
      if (finalStatus) {
        const snapshot = cloneStatus(finalStatus);
        this.updateSessionIdentity(session, snapshot);
        session.finalStatus = summarizeStatus(snapshot);
        const finalError = snapshot.lastError || snapshot.preview.lastError;
        if (finalError) {
          session.lastError = finalError;
        }
      }

      const endedAt = new Date().toISOString();
      session.endedAt = endedAt;
      session.endReason = reason;

      await this.recordEventForSession(session, {
        ts: endedAt,
        kind: "session.completed",
        summary: "Completed desktop recording session",
        reason,
      });

      await this.enqueueWriteAndWait(async () => {
        const summary = {
          sessionId: session.id,
          startedAt: session.startedAt,
          endedAt,
          durationMs: Date.parse(endedAt) - Date.parse(session.startedAt),
          trigger: session.trigger,
          requestedHost: session.requestedHost,
          resolvedHost: session.resolvedHost,
          device: {
            model: session.deviceModel,
            serialNumber: session.serialNumber,
            firmwareVersion: session.firmwareVersion,
          },
          counts: session.counts,
          lastError: session.lastError,
          reason,
          finalStatus: session.finalStatus,
          artifacts: ARTIFACT_FILES,
        };

        await writeFile(path.join(session.dir, ARTIFACT_FILES.summary), JSON.stringify(summary, null, 2) + "\n", "utf8");
        await this.writeSessionManifest(session);
      });
    } catch (error) {
      this.handleInternalError("finalize session", error);
    } finally {
      if (this.activeSession === session) {
        this.activeSession = null;
      }
    }
  }

  private updateSessionIdentity(session: ActiveSession, status: DesktopStatus): void {
    session.resolvedHost = status.host ?? session.resolvedHost;

    const deviceState = asRecord(status.deviceState);
    const device = asRecord(deviceState?.device);
    session.deviceModel = asString(device?.product_model) ?? asString(device?.user_product_model) ?? session.deviceModel;
    session.serialNumber = asString(device?.sn) ?? session.serialNumber;
    session.firmwareVersion = asString(device?.firmware_ver_string) ?? session.firmwareVersion;
  }

  private async writeSessionManifest(session: ActiveSession): Promise<void> {
    const manifest = {
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      trigger: session.trigger,
      requestedHost: session.requestedHost,
      resolvedHost: session.resolvedHost,
      appVersion: this.options.getAppVersion(),
      device: {
        model: session.deviceModel,
        serialNumber: session.serialNumber,
        firmwareVersion: session.firmwareVersion,
      },
      endReason: session.endReason,
      active: !session.endedAt,
      lastError: session.lastError,
      artifacts: ARTIFACT_FILES,
    };

    await writeFile(path.join(session.dir, ARTIFACT_FILES.session), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  }

  private async recordEventForSession(session: ActiveSession, payload: Record<string, unknown>): Promise<void> {
    await this.enqueueWriteAndWait(async () => {
      await this.appendJsonLine(path.join(session.dir, ARTIFACT_FILES.events), payload);
      await this.appendTimelineLine(session, `${String(payload.ts)} EVENT ${String(payload.kind)} ${String(payload.summary ?? "")}`.trim());
    });
  }

  private async appendJsonLine(filePath: string, payload: unknown): Promise<void> {
    await appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  }

  private async appendTimelineLine(session: ActiveSession, line: string): Promise<void> {
    await appendFile(path.join(session.dir, ARTIFACT_FILES.timeline), `${line}\n`, "utf8");
  }

  private enqueueWrite(work: () => Promise<void>): void {
    this.writeQueue = this.writeQueue.then(work).catch((error) => {
      this.handleInternalError("write session artifact", error);
    });
  }

  private async enqueueWriteAndWait(work: () => Promise<void>): Promise<void> {
    const operation = this.writeQueue.then(work);
    this.writeQueue = operation.catch((error) => {
      this.handleInternalError("write session artifact", error);
    });
    await operation.catch(() => undefined);
  }

  private handleInternalError(context: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[session-recorder] Failed to ${context}: ${detail}`);
  }
}

function cloneStatus(status: DesktopStatus): DesktopStatus {
  return {
    ...status,
    deviceState: cloneJsonValue(status.deviceState),
    viewState: cloneJsonValue(status.viewState),
    preview: cloneJsonValue(status.preview),
    recording: cloneJsonValue(status.recording),
    reconnect: cloneJsonValue(status.reconnect),
    planner: cloneJsonValue(status.planner),
  };
}

function summarizeStatus(status: DesktopStatus): RecordedStatusSummary {
  const viewState = asRecord(status.viewState);
  const view = asRecord(viewState?.View);

  return {
    connected: status.connected,
    authenticated: status.authenticated,
    host: status.host,
    lastUpdatedAt: status.lastUpdatedAt,
    lastError: status.lastError,
    preview: {
      active: status.preview.active,
      mode: status.preview.mode,
      lastFrameAt: status.preview.lastFrameAt,
      lastError: status.preview.lastError,
    },
    view: {
      mode: asString(view?.mode),
      stage: asString(view?.stage),
      state: asString(view?.state),
      targetName: asString(view?.target_name),
    },
    planner: summarizePlanner(status.planner),
  };
}

function describeStatus(status: DesktopStatus): string {
  const summary = summarizeStatus(status);
  const view = [summary.view?.mode, summary.view?.stage, summary.view?.state].filter(
    (part): part is string => Boolean(part)
  );

  const parts = [
    `connected=${summary.connected}`,
    `authenticated=${summary.authenticated}`,
    `preview=${summary.preview.active ? "active" : "idle"}`,
    view.length > 0 ? `view=${view.join("/")}` : undefined,
    summary.view?.targetName ? `target=${summary.view.targetName}` : undefined,
    summary.planner ? `planner=${summary.planner.ready ? "ready" : "attention"}` : undefined,
    summary.lastError ? `error=${summary.lastError}` : undefined,
    summary.preview.lastError ? `previewError=${summary.preview.lastError}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.join(" ");
}

function shouldIncludeLogInTimeline(event: LogEvent): boolean {
  if (event.level === "warn" || event.level === "error") {
    return true;
  }

  if (event.level === "debug" && (event.event === "rpc.push.received" || event.event === "observation.wait.event")) {
    return false;
  }

  return !event.event.startsWith("rpc.request.") && !event.event.startsWith("rpc.response.");
}

function formatTimelineLogEntry(event: LogEvent): string {
  const summary = event.summary ?? event.error ?? "SDK log";
  return `${event.ts} ${event.level.toUpperCase()} ${event.event} ${summary}`;
}

function formatTimestampForPath(value: string): string {
  return value.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "unknown";
}

function cloneJsonValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summarizePlanner(planner: DesktopPlannerHealth | undefined): RecordedStatusSummary["planner"] | undefined {
  if (!planner) return undefined;
  return {
    ready: planner.ready,
    activeSiteName: planner.activeSite?.name,
    discoveryMode: planner.discovery.mode,
    issues: [...planner.issues],
  };
}
