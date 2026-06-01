import { randomUUID } from "node:crypto";
import {
  Body,
  Equator,
  Horizon,
  Observer,
} from "astronomy-engine";
import {
  emitLog,
  SeestarDevice,
  type Logger,
} from "../../../../sdk/dist/index.js";
import { resolvePlanningActiveSite } from "./planning-context";
import { isAzimuthBlocked } from "../shared/backyard-mask";
import type {
  DesktopQueueRunnerState,
  DesktopStatus,
} from "../shared/api";
import type { PlanningSnapshot, QueueItem, SiteProfile } from "../shared/planning";

const DEFAULT_ACTION_WAIT = {
  waitForCompletion: true,
  timeoutMs: 120000,
  pollIntervalMs: 500,
} as const;
const AUTOFOCUS_ACTION_WAIT = {
  waitForCompletion: true,
  timeoutMs: 180000,
  pollIntervalMs: 500,
} as const;
const FILTER_ACTION_WAIT = {
  waitForCompletion: true,
  timeoutMs: 30000,
  pollIntervalMs: 500,
} as const;
const MONITOR_INTERVAL_MS = 10000;
const WAIT_INTERVAL_MS = 30000;
const ASTRONOMICAL_DAWN_ALTITUDE_DEG = -18;

interface QueueRunnerDeps {
  logger: Logger;
  getPlanningSnapshot(): Promise<PlanningSnapshot>;
  getStatus(): DesktopStatus;
  refreshStatus(): Promise<DesktopStatus>;
  requireConnectedDevice(): SeestarDevice;
  detachPreviewForAutomation(reason: string): void;
  onStateChange(state: DesktopQueueRunnerState, reason: string): Promise<void> | void;
}

interface QueueStopCondition {
  kind: "duration" | "altitude" | "backyard_hidden" | "dawn" | "operator_stop";
  summary: string;
}

export class QueueRunner {
  private state: DesktopQueueRunnerState = createDefaultQueueRunnerState();
  private runPromise: Promise<void> | null = null;

  constructor(private deps: QueueRunnerDeps) {}

  getState(): DesktopQueueRunnerState {
    return cloneRunnerState(this.state);
  }

  async start(input: { dryRun?: boolean }): Promise<DesktopQueueRunnerState> {
    if (this.state.active) {
      throw new Error("Queue runner is already active");
    }

    const now = new Date().toISOString();
    const nextState: DesktopQueueRunnerState = {
      ...createDefaultQueueRunnerState(),
      active: true,
      dryRun: input.dryRun ?? false,
      phase: "validating",
      runId: randomUUID(),
      startedAt: now,
      lastTransitionAt: now,
      summary: input.dryRun ? "Starting queue dry run" : "Starting queue run",
    };
    await this.updateState(nextState, "runner.started");

    this.runPromise = this.run(nextState.runId!, nextState.dryRun).finally(() => {
      this.runPromise = null;
    });

    return this.getState();
  }

  async requestStop(): Promise<DesktopQueueRunnerState> {
    if (!this.state.active) {
      return this.getState();
    }

    const nextState: DesktopQueueRunnerState = {
      ...this.state,
      stopRequested: true,
      summary: "Stop requested by operator",
    };
    await this.updateState(nextState, "runner.stop-requested");
    this.log("info", "queue.run.stop_requested", "Operator requested queue stop", {
      runId: this.state.runId,
      currentItemId: this.state.currentItemId,
      currentTargetName: this.state.currentTargetName,
    });
    return this.getState();
  }

  handleConnectionLost(message: string): void {
    if (!this.state.active || this.state.dryRun) return;
    void this.failRun(message, "queue.run.failed");
  }

  private async run(runId: string, dryRun: boolean): Promise<void> {
    try {
      const snapshot = await this.deps.getPlanningSnapshot();
      const activeSite = resolvePlanningActiveSite(snapshot, { allowFirstSiteFallback: false })?.site;
      const queue = snapshot.state.queue;
      const status = dryRun ? this.deps.getStatus() : await this.deps.refreshStatus();
      const issues = validateQueueRun(snapshot, activeSite, status, dryRun);
      if (issues.length > 0) {
        throw new Error(issues.join("; "));
      }
      if (!activeSite) {
        throw new Error("No active site selected for queue execution");
      }

      await this.updateState(
        {
          ...this.state,
          queueLength: queue.length,
          completedCount: 0,
          summary: dryRun ? "Queue validated for dry run" : "Queue validated for execution",
        },
        "runner.validated"
      );
      this.log("info", "queue.run.started", dryRun ? "Started queue dry run" : "Started queue run", {
        runId,
        dryRun,
        activeSiteId: activeSite.id,
        queueLength: queue.length,
        items: queue.map((item, index) => ({
          index,
          id: item.id,
          siteId: item.siteId,
          targetId: item.targetId,
          targetName: item.targetName,
        })),
      });

      for (let index = 0; index < queue.length; index += 1) {
        this.ensureSameRun(runId);
        const item = queue[index];
        if (dryRun) {
          await this.runDryItem(runId, item, activeSite, index, queue.length);
        } else {
          const completed = await this.runLiveItem(runId, item, activeSite, index, queue.length);
          if (!completed) {
            return;
          }
        }
      }

      await this.finishRun("completed", dryRun ? "Queue dry run completed" : "Queue run completed", "queue.run.completed");
    } catch (error) {
      if (!this.state.active || this.state.runId !== runId) {
        return;
      }
      await this.failRun(toErrorMessage(error), "queue.run.failed");
    }
  }

  private async runDryItem(
    runId: string,
    item: QueueItem,
    site: SiteProfile,
    index: number,
    total: number
  ): Promise<void> {
    await this.startItem(runId, item, index, total, true);

    if (item.notBeforeLocal && isBeforeLocalTime(new Date(), site.timezone, item.notBeforeLocal)) {
      await this.transition("waiting", `Would wait until ${item.notBeforeLocal} local for ${item.targetName}`, {
        currentItemId: item.id,
        currentTargetName: item.targetName,
        currentIndex: index,
      });
    }

    await this.transition("slewing", `Would slew to ${item.targetName}`, {
      currentItemId: item.id,
      currentTargetName: item.targetName,
      currentIndex: index,
    });
    if (item.autofocusBeforeStart) {
      await this.transition("focusing", `Would autofocus before starting ${item.targetName}`, {
        currentItemId: item.id,
        currentTargetName: item.targetName,
        currentIndex: index,
      });
    }
    await this.transition("stacking", `Would stack on ${item.targetName}`, {
      currentItemId: item.id,
      currentTargetName: item.targetName,
      currentIndex: index,
    });

    this.log("info", "queue.item.completed", `Completed dry-run item ${item.targetName}`, {
      runId,
      queueItemId: item.id,
      targetId: item.targetId,
      targetName: item.targetName,
      dryRun: true,
      siteId: item.siteId,
    });

    await this.updateState(
      {
        ...this.state,
        phase: "validating",
        completedCount: this.state.completedCount + 1,
        currentItemId: undefined,
        currentTargetName: undefined,
        currentIndex: undefined,
        lastTransitionAt: new Date().toISOString(),
        summary: `Dry-run item ${item.targetName} completed`,
      },
      "runner.item-dry-completed"
    );
  }

  private async runLiveItem(
    runId: string,
    item: QueueItem,
    site: SiteProfile,
    index: number,
    total: number
  ): Promise<boolean> {
    await this.startItem(runId, item, index, total, false);
    await this.waitUntilNotBefore(runId, item, site, index);
    this.ensureSameRun(runId);

    const device = this.deps.requireConnectedDevice();
    const status = this.deps.getStatus();
    const mountClosed = readMountClosed(status.deviceState);
    if (mountClosed) {
      this.log("info", "queue.preflight.arm.opening", `Opening arm before ${item.targetName}`, {
        runId,
        queueItemId: item.id,
      });
      await this.expectAccepted(device.moveToHorizon(DEFAULT_ACTION_WAIT), "Device rejected arm-open request");
    }

    this.deps.detachPreviewForAutomation("queue.preview.detached");
    const filterPosition = toFilterPosition(item.requestedFilter);
    if (filterPosition !== undefined) {
      await this.expectAccepted(
        device.setWheelPosition(filterPosition, FILTER_ACTION_WAIT),
        `Device rejected filter change for ${item.targetName}`
      );
    }

    await this.transition("slewing", `Slewing to ${item.targetName}`, {
      currentItemId: item.id,
      currentTargetName: item.targetName,
      currentIndex: index,
    });
    await this.expectAccepted(
      device.goto(item.targetRaHours, item.targetDecDeg, DEFAULT_ACTION_WAIT),
      `Device rejected goto request for ${item.targetName}`
    );
    await this.expectAccepted(
      device.startViewDetailed(
        {
          mode: "star",
          targetName: item.targetName,
          targetRaDec: [item.targetRaHours, item.targetDecDeg],
          lpFilter: item.requestedFilter === "lp",
        },
        DEFAULT_ACTION_WAIT
      ),
      `Device rejected star view for ${item.targetName}`
    );

    if (item.autofocusBeforeStart) {
      await this.transition("focusing", `Running autofocus on ${item.targetName}`, {
        currentItemId: item.id,
        currentTargetName: item.targetName,
        currentIndex: index,
      });
      await this.expectAccepted(
        device.startAutoFocus(AUTOFOCUS_ACTION_WAIT),
        `Device rejected autofocus for ${item.targetName}`
      );
    }

    await this.transition("stacking", `Stacking on ${item.targetName}`, {
      currentItemId: item.id,
      currentTargetName: item.targetName,
      currentIndex: index,
    });
    await this.expectAccepted(
      device.startStack(item.restartStack),
      `Device rejected stack start for ${item.targetName}`
    );

    const stopCondition = await this.waitForStopCondition(runId, item, site);
    await this.transition("stopping", `Stopping ${item.targetName}: ${stopCondition.summary}`, {
      currentItemId: item.id,
      currentTargetName: item.targetName,
      currentIndex: index,
    });
    await this.stopActiveObservation(device);

    this.log("info", "queue.item.completed", `Completed queue item ${item.targetName}`, {
      runId,
      queueItemId: item.id,
      targetId: item.targetId,
      targetName: item.targetName,
      siteId: item.siteId,
      stopCondition: stopCondition.kind,
      summary: stopCondition.summary,
    });

    if (stopCondition.kind === "operator_stop") {
      await this.finishRun("stopped", "Queue run stopped by operator", "queue.run.stopped", {
        queueItemId: item.id,
        targetId: item.targetId,
        targetName: item.targetName,
      });
      return false;
    }

    await this.updateState(
      {
        ...this.state,
        phase: "validating",
        completedCount: this.state.completedCount + 1,
        currentItemId: undefined,
        currentTargetName: undefined,
        currentIndex: undefined,
        lastTransitionAt: new Date().toISOString(),
        summary: `Completed ${item.targetName}`,
      },
      "runner.item-completed"
    );
    return true;
  }

  private async waitUntilNotBefore(
    runId: string,
    item: QueueItem,
    site: SiteProfile,
    index: number
  ): Promise<void> {
    if (!item.notBeforeLocal) return;

    if (isBeforeLocalTime(new Date(), site.timezone, item.notBeforeLocal)) {
      this.log("info", "queue.item.waiting", `Waiting until ${item.notBeforeLocal} local for ${item.targetName}`, {
        runId,
        queueItemId: item.id,
        targetId: item.targetId,
        targetName: item.targetName,
        notBeforeLocal: item.notBeforeLocal,
      });
    }

    while (isBeforeLocalTime(new Date(), site.timezone, item.notBeforeLocal)) {
      this.ensureSameRun(runId);
      if (this.state.stopRequested) {
        return;
      }
      await this.transition("waiting", `Waiting until ${item.notBeforeLocal} local for ${item.targetName}`, {
        currentItemId: item.id,
        currentTargetName: item.targetName,
        currentIndex: index,
      });

      if (item.stopAtDawn && isAstronomicalDawn(site, new Date())) {
        throw new Error(`Dawn reached before ${item.targetName} could start`);
      }
      await sleep(WAIT_INTERVAL_MS);
    }
  }

  private async waitForStopCondition(
    runId: string,
    item: QueueItem,
    site: SiteProfile
  ): Promise<QueueStopCondition> {
    const startedAt = Date.now();

    while (true) {
      this.ensureSameRun(runId);
      if (this.state.stopRequested) {
        return { kind: "operator_stop", summary: "Operator stop requested" };
      }

      await sleep(MONITOR_INTERVAL_MS);
      const refreshed = await this.deps.refreshStatus();
      if (!refreshed.connected || !refreshed.authenticated) {
        throw new Error("Device disconnected during queue execution");
      }
      if (!refreshed.planner.ready) {
        throw new Error(`Planner health degraded during run: ${refreshed.planner.issues.join("; ") || "unknown issue"}`);
      }

      const now = new Date();
      if (item.stopAtDawn && isAstronomicalDawn(site, now)) {
        return { kind: "dawn", summary: "Astronomical dawn reached" };
      }

      const targetPosition = readTargetPosition(item, site, now);
      if (
        typeof item.stopWhenBelowAltitudeDeg === "number" &&
        targetPosition.altitudeDeg < item.stopWhenBelowAltitudeDeg
      ) {
        return {
          kind: "altitude",
          summary: `Target dropped below ${item.stopWhenBelowAltitudeDeg} deg altitude`,
        };
      }
      if (
        item.stopWhenBackyardHidden &&
        targetPosition.altitudeDeg >= site.minAltitudeDeg &&
        isAzimuthBlocked(site.blockedAzimuthRanges, targetPosition.azimuthDeg)
      ) {
        return {
          kind: "backyard_hidden",
          summary: "Target entered a blocked backyard sector",
        };
      }
      if (Date.now() - startedAt >= item.desiredDurationMin * 60 * 1000) {
        return {
          kind: "duration",
          summary: `Desired duration ${item.desiredDurationMin} min reached`,
        };
      }
    }
  }

  private async stopActiveObservation(device: SeestarDevice): Promise<void> {
    const viewState = await device.getViewState();
    if (isStackActive(viewState)) {
      await this.expectAccepted(device.stopStack(DEFAULT_ACTION_WAIT), "Device rejected stack stop while stopping queue item");
    }
    const nextViewState = await device.getViewState();
    if (isViewActive(nextViewState)) {
      await this.expectAccepted(device.stopView(undefined, DEFAULT_ACTION_WAIT), "Device rejected view stop while stopping queue item");
    }
  }

  private async startItem(
    runId: string,
    item: QueueItem,
    index: number,
    total: number,
    dryRun: boolean
  ): Promise<void> {
    await this.transition("validating", `Preparing ${item.targetName}`, {
      currentItemId: item.id,
      currentTargetName: item.targetName,
      currentIndex: index,
    });
    this.log("info", "queue.item.started", `${dryRun ? "Dry run" : "Executing"} queue item ${item.targetName}`, {
      runId,
      dryRun,
      queueItemId: item.id,
      targetId: item.targetId,
      targetName: item.targetName,
      siteId: item.siteId,
      index,
      total,
    });
  }

  private async finishRun(
    phase: Extract<DesktopQueueRunnerState["phase"], "completed" | "stopped">,
    summary: string,
    event: string,
    data?: unknown
  ): Promise<void> {
    const nextState: DesktopQueueRunnerState = {
      ...this.state,
      active: false,
      stopRequested: false,
      phase,
      currentItemId: undefined,
      currentTargetName: undefined,
      currentIndex: undefined,
      lastTransitionAt: new Date().toISOString(),
      summary,
    };
    await this.updateState(nextState, "runner.finished");
    this.log("info", event, summary, {
      runId: nextState.runId,
      dryRun: nextState.dryRun,
      completedCount: nextState.completedCount,
      queueLength: nextState.queueLength,
      ...asRecord(data),
    });
  }

  private async failRun(message: string, event: string): Promise<void> {
    const nextState: DesktopQueueRunnerState = {
      ...this.state,
      active: false,
      stopRequested: false,
      phase: "failed",
      lastError: message,
      lastTransitionAt: new Date().toISOString(),
      summary: message,
    };
    await this.updateState(nextState, "runner.failed");
    this.log("error", event, message, {
      runId: nextState.runId,
      currentItemId: nextState.currentItemId,
      currentTargetName: nextState.currentTargetName,
      dryRun: nextState.dryRun,
    });
  }

  private async transition(
    phase: DesktopQueueRunnerState["phase"],
    summary: string,
    patch: Partial<DesktopQueueRunnerState>
  ): Promise<void> {
    const previousPhase = this.state.phase;
    const nextState: DesktopQueueRunnerState = {
      ...this.state,
      ...patch,
      phase,
      lastTransitionAt: new Date().toISOString(),
      summary,
    };
    await this.updateState(nextState, "runner.transition");
    this.log("info", "queue.state.transition", `${previousPhase} -> ${phase}`, {
      runId: nextState.runId,
      from: previousPhase,
      to: phase,
      summary,
      currentItemId: nextState.currentItemId,
      currentTargetName: nextState.currentTargetName,
      currentIndex: nextState.currentIndex,
      dryRun: nextState.dryRun,
    });
  }

  private async updateState(nextState: DesktopQueueRunnerState, reason: string): Promise<void> {
    this.state = cloneRunnerState(nextState);
    await this.deps.onStateChange(this.getState(), reason);
  }

  private ensureSameRun(runId: string): void {
    if (!this.state.active || this.state.runId !== runId) {
      throw new Error("Queue run is no longer active");
    }
  }

  private async expectAccepted(work: Promise<boolean>, message: string): Promise<void> {
    const ok = await work;
    if (!ok) {
      throw new Error(message);
    }
  }

  private log(level: "info" | "error", event: string, summary: string, data?: unknown): void {
    emitLog(this.deps.logger, {
      level,
      event,
      component: "queue_runner",
      phase: "queue",
      summary,
      ok: level !== "error",
      error: level === "error" ? summary : undefined,
      data,
    });
  }
}

export function createDefaultQueueRunnerState(): DesktopQueueRunnerState {
  return {
    active: false,
    dryRun: false,
    stopRequested: false,
    phase: "idle",
    queueLength: 0,
    completedCount: 0,
  };
}

function cloneRunnerState(state: DesktopQueueRunnerState): DesktopQueueRunnerState {
  return { ...state };
}

function validateQueueRun(
  snapshot: PlanningSnapshot,
  activeSite: SiteProfile | undefined,
  status: DesktopStatus,
  dryRun: boolean
): string[] {
  const issues: string[] = [];
  if (!activeSite) {
    issues.push("No active site selected");
  }
  if (snapshot.state.queue.length === 0) {
    issues.push("Queue is empty");
  }
  if (activeSite && snapshot.state.queue.some((item) => item.siteId !== activeSite.id)) {
    issues.push("Queue contains items for a different site than the active session site");
  }
  if (!dryRun) {
    if (!status.connected || !status.authenticated) {
      issues.push("Device is not connected and authenticated");
    }
    if (!status.planner.ready) {
      issues.push(`Planner is not ready: ${status.planner.issues.join("; ") || "unknown issue"}`);
    }
    if (isViewActive(status.viewState) || isStackActive(status.viewState)) {
      issues.push("Device already has an active view or stack");
    }
  }
  return issues;
}

function isBeforeLocalTime(now: Date, timeZone: string, threshold: string): boolean {
  return formatLocalClock(now, timeZone) < threshold;
}

function formatLocalClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function readTargetPosition(item: QueueItem, site: SiteProfile, date: Date): { altitudeDeg: number; azimuthDeg: number } {
  const observer = new Observer(site.lat, site.lon, 0);
  const horizontal = Horizon(date, observer, item.targetRaHours, item.targetDecDeg, "normal");
  return {
    altitudeDeg: horizontal.altitude,
    azimuthDeg: horizontal.azimuth,
  };
}

function isAstronomicalDawn(site: SiteProfile, date: Date): boolean {
  const observer = new Observer(site.lat, site.lon, 0);
  const equator = Equator(Body.Sun, date, observer, true, true);
  const horizontal = Horizon(date, observer, equator.ra, equator.dec, "normal");
  return horizontal.altitude >= ASTRONOMICAL_DAWN_ALTITUDE_DEG;
}

function toFilterPosition(filter: QueueItem["requestedFilter"]): number | undefined {
  switch (filter) {
    case "clear":
      return 0;
    case "ir":
      return 1;
    case "lp":
      return 2;
    default:
      return undefined;
  }
}

function readMountClosed(deviceState: Record<string, unknown> | null): boolean | undefined {
  const mount = asRecord(deviceState?.mount);
  return typeof mount?.close === "boolean" ? mount.close : undefined;
}

function isViewActive(viewState: unknown): boolean {
  const view = asRecord(asRecord(viewState)?.View);
  const mode = typeof view?.mode === "string" ? view.mode : undefined;
  const state = typeof view?.state === "string" ? view.state : undefined;
  return Boolean(mode && mode !== "none" && state !== "cancel");
}

function isStackActive(viewState: unknown): boolean {
  const view = asRecord(asRecord(viewState)?.View);
  return view?.stage === "Stack" && view?.state !== "cancel";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
