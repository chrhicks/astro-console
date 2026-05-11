import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogEvent {
  schemaVersion: 1;
  ts: string;
  level: LogLevel;
  event: string;
  component: string;
  phase?: string;
  sessionId?: string;
  sequenceId?: string;
  host?: string;
  deviceModel?: string;
  deviceSn?: string;
  summary?: string;
  step?: string;
  rpcId?: number;
  method?: string;
  durationMs?: number;
  attempt?: number;
  ok?: boolean;
  changed?: boolean;
  warning?: string;
  error?: string;
  data?: unknown;
}

export interface Logger {
  log(event: LogEvent): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

const NOOP_LOGGER: Logger = {
  log() {
    // Intentionally empty.
  },
};

export function createNoopLogger(): Logger {
  return NOOP_LOGGER;
}

export function createConsoleLogger(minLevel: LogLevel = "info"): Logger {
  return {
    log(event) {
      if (!shouldLog(event.level, minLevel)) return;
      const line = JSON.stringify(event);
      if (event.level === "error") {
        console.error(line);
      } else if (event.level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    },
  };
}

export function createJsonlFileLogger(
  filePath: string,
  minLevel: LogLevel = "debug"
): Logger {
  mkdirSync(dirname(filePath), { recursive: true });

  return {
    log(event) {
      if (!shouldLog(event.level, minLevel)) return;
      appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
    },
  };
}

export function emitLog(
  logger: Logger | undefined,
  event: Omit<LogEvent, "schemaVersion" | "ts">
): void {
  if (!logger) return;
  logger.log({
    schemaVersion: 1,
    ts: new Date().toISOString(),
    ...event,
  });
}

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}
