import { resolveSeestarPemPath } from "../config.js";
import { SeestarDevice } from "../device.js";
import { createConsoleLogger, type LogLevel } from "../logging.js";
import type { AlbumsResult, EquCoord } from "../types.js";

const DEFAULT_INTERVAL_SEC = 10;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 2500;
const DEFAULT_RECONNECT_DELAY_SEC = 3;
const DEFAULT_LOG_LEVEL: LogLevel = "warn";
const DEFAULT_ALBUM_SAMPLE_SIZE = 3;

const STACKED_COUNTER_KEYS = [
  "stacked_frame",
  "stacked_frames",
  "stackedCount",
  "stacked_count",
  "stack_frame",
  "stack_count",
  "stack_cnt",
  "frame_count",
  "frames_stacked",
];

const DROPPED_COUNTER_KEYS = [
  "dropped_frame",
  "dropped_frames",
  "droppedCount",
  "dropped_count",
  "drop_count",
  "drop_frame",
  "frames_dropped",
];

interface StackWatchArgs {
  help?: boolean;
  host?: string;
  pemPath?: string;
  intervalSec: number;
  timeoutMs: number;
  discoveryTimeoutMs: number;
  reconnectDelaySec: number;
  maxSamples?: number;
  once: boolean;
  json: boolean;
  noDiscover: boolean;
  logLevel: LogLevel;
  albumSampleSize: number;
}

interface FrameCounters {
  stacked?: number;
  dropped?: number;
}

interface AlbumSummaryEntry {
  groupName?: string;
  name: string;
  thumbPath: string;
  frameCount?: number;
  type?: number;
  capturedAtToken?: string;
}

interface StackWatchStatusPayload {
  ts: string;
  requestedHost?: string;
  view: {
    targetName?: string;
    mode?: string;
    stage?: string;
    state?: string;
  };
  frames: FrameCounters;
  coordinates: {
    raHours?: number;
    decDeg?: number;
  };
  albums: {
    path?: string;
    totalEntries: number;
    stackEntry?: AlbumSummaryEntry;
    subframesEntry?: AlbumSummaryEntry;
    recentEntries: AlbumSummaryEntry[];
  };
  warnings: string[];
}

interface ReadResult<T> {
  value: T | null;
  error?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.noDiscover && !args.host) {
    throw new Error("--no-discover requires --host <ip-or-hostname>");
  }

  const shutdown = createShutdownSignal();
  let device = createDevice(args);
  let connected = false;
  let reconnectAttempt = 0;
  let sampleCount = 0;
  let lastCounters: FrameCounters = {};

  try {
    while (!shutdown.signal.aborted) {
      const startedAt = Date.now();

      try {
        if (!connected) {
          await connectAndAuthenticate(device);
          connected = true;
          if (reconnectAttempt > 0) {
            writeNotice(args, "info", `Reconnected after ${reconnectAttempt} failed poll cycles`);
            reconnectAttempt = 0;
          } else {
            writeNotice(args, "info", "Connected and authenticated for read-only stack watch");
          }
        }

        const payload = await buildSnapshot(args, device, lastCounters);
        lastCounters = payload.frames;
        sampleCount += 1;

        if (args.json) {
          console.log(JSON.stringify(payload));
        } else {
          console.log(formatStatusLine(payload));
          if (payload.warnings.length > 0) {
            writeNotice(args, "warn", `Partial poll warnings: ${payload.warnings.join(" | ")}`);
          }
        }

        if (args.once || (args.maxSamples !== undefined && sampleCount >= args.maxSamples)) {
          break;
        }

        const elapsedMs = Date.now() - startedAt;
        const waitMs = Math.max(0, args.intervalSec * 1000 - elapsedMs);
        await sleep(waitMs, shutdown.signal);
      } catch (error) {
        reconnectAttempt += 1;
        connected = false;
        device.disconnect();

        const detail = toErrorMessage(error);
        if (args.once) {
          throw error;
        }

        writeNotice(
          args,
          "warn",
          `Poll failed (${detail}); reconnecting in ${args.reconnectDelaySec}s (attempt ${reconnectAttempt})`
        );

        await sleep(args.reconnectDelaySec * 1000, shutdown.signal);
        if (shutdown.signal.aborted) break;
        device = createDevice(args);
      }
    }
  } finally {
    shutdown.cleanup();
    device.disconnect();
  }
}

function createDevice(args: StackWatchArgs): SeestarDevice {
  return new SeestarDevice({
    host: args.host,
    pemPath: resolveSeestarPemPath({ explicitPath: args.pemPath }),
    timeoutMs: args.timeoutMs,
    discoveryTimeoutMs: args.discoveryTimeoutMs,
    logger: createConsoleLogger(args.logLevel),
  });
}

async function connectAndAuthenticate(device: SeestarDevice): Promise<void> {
  await device.connect();
  const authenticated = await device.authenticate();
  if (!authenticated) {
    throw new Error("Authentication failed");
  }
}

async function buildSnapshot(
  args: StackWatchArgs,
  device: SeestarDevice,
  previousCounters: FrameCounters
): Promise<StackWatchStatusPayload> {
  const viewRead = await safeRead("get_view_state", () => device.getViewState());
  const equRead = await safeRead("scope_get_equ_coord", () => device.getEquCoord());
  const albumsRead = await safeRead("get_albums", () => device.getAlbums());

  const failedReads = [viewRead, equRead, albumsRead].filter((result) => result.error !== undefined);
  if (failedReads.length === 3) {
    throw new Error(failedReads.map((result) => result.error).join("; "));
  }

  const viewState = asRecord(viewRead.value);
  const view = asRecord(viewState?.View);
  const targetName = asString(view?.target_name);

  const stacked = findNumberByKeys(viewState, STACKED_COUNTER_KEYS) ?? previousCounters.stacked;
  const dropped = findNumberByKeys(viewState, DROPPED_COUNTER_KEYS) ?? previousCounters.dropped;
  const coordinates = normalizeEquCoord(equRead.value);
  const albums = summarizeAlbums(albumsRead.value, targetName, args.albumSampleSize);

  return {
    ts: new Date().toISOString(),
    requestedHost: args.host,
    view: {
      targetName,
      mode: asString(view?.mode),
      stage: asString(view?.stage),
      state: asString(view?.state),
    },
    frames: {
      stacked,
      dropped,
    },
    coordinates,
    albums,
    warnings: failedReads
      .map((result) => result.error)
      .filter((value): value is string => value !== undefined),
  };
}

async function safeRead<T>(method: string, read: () => Promise<T | null>): Promise<ReadResult<T>> {
  try {
    return { value: await read() };
  } catch (error) {
    return { value: null, error: `${method} failed: ${toErrorMessage(error)}` };
  }
}

function normalizeEquCoord(value: EquCoord | null): { raHours?: number; decDeg?: number } {
  if (!value) {
    return {};
  }
  return {
    raHours: Number.isFinite(value.ra) ? value.ra : undefined,
    decDeg: Number.isFinite(value.dec) ? value.dec : undefined,
  };
}

function summarizeAlbums(
  albums: AlbumsResult | null,
  targetName: string | undefined,
  sampleSize: number
): {
  path?: string;
  totalEntries: number;
  stackEntry?: AlbumSummaryEntry;
  subframesEntry?: AlbumSummaryEntry;
  recentEntries: AlbumSummaryEntry[];
} {
  if (!albums) {
    return {
      totalEntries: 0,
      recentEntries: [],
    };
  }

  const entries = flattenAlbumEntries(albums);
  const stackCandidates = targetName
    ? entries.filter((entry) => normalizeAlbumName(entry.name) === normalizeAlbumName(targetName))
    : entries.filter((entry) => !isLikelySubframeEntry(entry.name));
  const subCandidates = targetName
    ? entries.filter((entry) => {
        const normalized = normalizeAlbumName(entry.name);
        const normalizedTarget = normalizeAlbumName(targetName);
        return normalized === `${normalizedTarget}_sub` || (isLikelySubframeEntry(entry.name) && normalized.startsWith(normalizedTarget));
      })
    : entries.filter((entry) => isLikelySubframeEntry(entry.name));

  const stackEntry = pickLatestEntry(
    stackCandidates.length > 0
      ? stackCandidates
      : entries.filter((entry) => !isLikelySubframeEntry(entry.name))
  );
  const subframesEntry = pickLatestEntry(
    subCandidates.length > 0
      ? subCandidates
      : entries.filter((entry) => isLikelySubframeEntry(entry.name))
  );

  const recentEntries = [...entries]
    .sort((left, right) => compareTimestampTokens(right.capturedAtToken, left.capturedAtToken))
    .slice(0, sampleSize);

  return {
    path: albums.path,
    totalEntries: entries.length,
    stackEntry,
    subframesEntry,
    recentEntries,
  };
}

function flattenAlbumEntries(albums: AlbumsResult): AlbumSummaryEntry[] {
  return albums.list.flatMap((entry) =>
    entry.files.map((file) => ({
      groupName: entry.groupName,
      name: file.name,
      thumbPath: file.thn,
      frameCount: file.count,
      type: file.type,
      capturedAtToken: extractTimestampToken(file.thn),
    }))
  );
}

function pickLatestEntry(entries: AlbumSummaryEntry[]): AlbumSummaryEntry | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  return [...entries].sort((left, right) => compareTimestampTokens(right.capturedAtToken, left.capturedAtToken))[0];
}

function compareTimestampTokens(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function extractTimestampToken(value: string): string | undefined {
  const match = value.match(/(\d{8}-\d{6})/);
  return match?.[1];
}

function normalizeAlbumName(value: string): string {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function isLikelySubframeEntry(name: string): boolean {
  const normalized = normalizeAlbumName(name);
  return normalized.endsWith("_sub") || normalized.endsWith("sub");
}

function findNumberByKeys(root: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!root) return undefined;

  const targetKeys = new Set(keys.map((key) => key.toLowerCase()));
  const queue: Array<Record<string, unknown>> = [root];
  const visited = new Set<Record<string, unknown>>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    for (const [key, value] of Object.entries(current)) {
      if (targetKeys.has(key.toLowerCase())) {
        const numeric = asNumber(value);
        if (numeric !== undefined) {
          return numeric;
        }
      }

      if (isPlainRecord(value)) {
        queue.push(value);
      }
    }
  }

  return undefined;
}

function formatStatusLine(payload: StackWatchStatusPayload): string {
  const viewMode = payload.view.mode ?? "none";
  const viewStage = payload.view.stage ?? "n/a";
  const viewState = payload.view.state ?? "n/a";
  const targetName = payload.view.targetName ?? "none";
  const stacked = payload.frames.stacked !== undefined ? String(payload.frames.stacked) : "n/a";
  const dropped = payload.frames.dropped !== undefined ? String(payload.frames.dropped) : "n/a";
  const coord =
    payload.coordinates.raHours !== undefined && payload.coordinates.decDeg !== undefined
      ? `${payload.coordinates.raHours.toFixed(4)}h/${payload.coordinates.decDeg.toFixed(4)}deg`
      : "n/a";

  const stackLabel = payload.albums.stackEntry?.name ?? "n/a";
  const subLabel = formatSubframeLabel(payload.albums.subframesEntry);
  const warningLabel = payload.warnings.length > 0 ? ` warnings=${payload.warnings.length}` : "";

  return `${payload.ts} target=${targetName} view=${viewMode}/${viewStage}/${viewState} frames=${stacked}/${dropped} coord=${coord} albums=${stackLabel}|${subLabel} totalAlbums=${payload.albums.totalEntries}${warningLabel}`;
}

function formatSubframeLabel(entry: AlbumSummaryEntry | undefined): string {
  if (!entry) {
    return "n/a";
  }
  if (entry.frameCount === undefined) {
    return entry.name;
  }
  return `${entry.name}(${entry.frameCount})`;
}

function createShutdownSignal(): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return {
    signal: controller.signal,
    cleanup: () => {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    },
  };
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      done();
    };

    function done(): void {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function writeNotice(args: StackWatchArgs, level: "info" | "warn", message: string): void {
  const prefix = `[stack-watch] ${level.toUpperCase()}:`;
  if (level === "warn") {
    console.error(`${prefix} ${message}`);
    return;
  }
  if (!args.json) {
    console.error(`${prefix} ${message}`);
  }
}

function parseArgs(argv: string[]): StackWatchArgs {
  const out: StackWatchArgs = {
    intervalSec: DEFAULT_INTERVAL_SEC,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    discoveryTimeoutMs: DEFAULT_DISCOVERY_TIMEOUT_MS,
    reconnectDelaySec: DEFAULT_RECONNECT_DELAY_SEC,
    once: false,
    json: false,
    noDiscover: false,
    logLevel: DEFAULT_LOG_LEVEL,
    albumSampleSize: DEFAULT_ALBUM_SAMPLE_SIZE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (arg === "--once") {
      out.once = true;
      continue;
    }
    if (arg === "--no-discover") {
      out.noDiscover = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    index += 1;

    switch (key) {
      case "host":
        out.host = value;
        break;
      case "pem-path":
        out.pemPath = value;
        break;
      case "interval-sec":
        out.intervalSec = parsePositiveNumber("--interval-sec", value);
        break;
      case "timeout-ms":
        out.timeoutMs = parsePositiveInteger("--timeout-ms", value);
        break;
      case "discovery-timeout-ms":
        out.discoveryTimeoutMs = parsePositiveInteger("--discovery-timeout-ms", value);
        break;
      case "reconnect-delay-sec":
        out.reconnectDelaySec = parsePositiveNumber("--reconnect-delay-sec", value);
        break;
      case "max-samples":
        out.maxSamples = parsePositiveInteger("--max-samples", value);
        break;
      case "album-sample-size":
        out.albumSampleSize = parsePositiveInteger("--album-sample-size", value);
        break;
      case "log-level":
        out.logLevel = parseLogLevel(value);
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (out.once) {
    out.maxSamples = 1;
  }

  if (out.albumSampleSize < 1) {
    out.albumSampleSize = 1;
  }

  return out;
}

function parsePositiveNumber(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function parsePositiveInteger(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function parseLogLevel(value: string): LogLevel {
  if (value === "trace" || value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  throw new Error(`Invalid --log-level: ${value}`);
}

function printHelp(): void {
  console.log(`Usage: node dist/cli/stack-watch.js [options]

Options:
  --host <host>                Device host or mDNS name (optional when discovery is enabled)
  --pem-path <path>            PEM path (overrides $SEESTAR_PEM_PATH/$SEESTAR_PEM)
  --interval-sec <seconds>     Poll cadence in seconds (default: ${DEFAULT_INTERVAL_SEC})
  --timeout-ms <n>             RPC timeout in ms (default: ${DEFAULT_TIMEOUT_MS})
  --discovery-timeout-ms <n>   Discovery timeout in ms (default: ${DEFAULT_DISCOVERY_TIMEOUT_MS})
  --reconnect-delay-sec <n>    Delay before reconnect after failures (default: ${DEFAULT_RECONNECT_DELAY_SEC})
  --max-samples <n>            Exit after N successful status samples
  --once                       Collect one sample and exit
  --album-sample-size <n>      Number of recent album entries in JSON output (default: ${DEFAULT_ALBUM_SAMPLE_SIZE})
  --log-level <level>          trace | debug | info | warn | error (default: ${DEFAULT_LOG_LEVEL})
  --no-discover                Require --host instead of discovery fallback
  --json                       Emit one JSON status object per poll
  --help                       Show this help

This command only uses read-only SDK calls: get_view_state, scope_get_equ_coord, and get_albums.
It is intended for live stack monitoring without issuing movement or control commands.
`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  console.error(toErrorMessage(error));
  process.exit(1);
});
