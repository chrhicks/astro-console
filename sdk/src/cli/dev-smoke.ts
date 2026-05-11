import { resolve } from "node:path";
import { SeestarDevice } from "../device.js";
import { createConsoleLogger, type LogLevel } from "../logging.js";
import type { DevelopmentSmokeTestOptions } from "../types.js";

const DEFAULT_HOST = process.env.SEESTAR_HOST ?? "192.168.4.29";

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const logLevel = asLogLevel(asString(options.logLevel) ?? "info");
  if (!logLevel) {
    console.error(`Invalid --log-level: ${String(options.logLevel)}`);
    process.exit(1);
  }

  const mode = asMode(asString(options.mode) ?? "scenery");
  if (!mode) {
    console.error(`Invalid --mode: ${String(options.mode)}`);
    process.exit(1);
  }

  const openArm = asOpenArm(asString(options.openArm) ?? "if_needed");
  if (!openArm) {
    console.error(`Invalid --open-arm: ${String(options.openArm)}`);
    process.exit(1);
  }

  const timeoutMs = asNumber(asString(options.timeoutMs));
  if (options.timeoutMs !== undefined && timeoutMs === undefined) {
    console.error(`Invalid --timeout-ms: ${String(options.timeoutMs)}`);
    process.exit(1);
  }

  const parkAtEnd = asBoolean(asString(options.parkAtEnd));
  if (options.parkAtEnd !== undefined && parkAtEnd === undefined) {
    console.error(`Invalid --park-at-end: ${String(options.parkAtEnd)}`);
    process.exit(1);
  }

  const json = options.json === true;

  const device = new SeestarDevice({
    host: asString(options.host) ?? DEFAULT_HOST,
    pemPath: resolve(asString(options.pemPath) ?? "../seestar_3.1.2_fw_7.32_interop.pem"),
    timeoutMs,
    logger: createConsoleLogger(logLevel),
  });

  const smokeOptions: DevelopmentSmokeTestOptions = {
    mode,
    openArm,
    parkAtEnd,
  };

  device.developmentSmokeTest(smokeOptions)
    .then((report) => {
      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReport(report);
      }
      process.exit(report.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    })
    .finally(() => {
      device.disconnect();
    });
}

function parseArgs(argv: string[]): Record<string, string | boolean | undefined> {
  const out: Record<string, string | boolean | undefined> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    out[toCamelCase(key)] = value;
    i += 1;
  }
  return out;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function asLogLevel(value: string): LogLevel | undefined {
  if (value === "trace" || value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return undefined;
}

function asMode(value: string): DevelopmentSmokeTestOptions["mode"] | undefined {
  if (value === "scenery" || value === "moon" || value === "sun" || value === "planet") {
    return value;
  }
  return undefined;
}

function asOpenArm(value: string): DevelopmentSmokeTestOptions["openArm"] | undefined {
  if (value === "if_needed" || value === "always" || value === "never") {
    return value;
  }
  return undefined;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function printReport(report: {
  ok: boolean;
  resolvedHost: string;
  warnings: string[];
  steps: Array<{ name: string; ok: boolean; summary: string; skipped?: boolean; error?: string }>;
}): void {
  console.log(`Development smoke ${report.ok ? "passed" : "failed"}.`);
  console.log(`- host: ${report.resolvedHost}`);
  for (const step of report.steps) {
    const suffix = step.skipped ? " (skipped)" : "";
    console.log(`- ${step.name}: ${step.ok ? "ok" : "failed"}${suffix} - ${step.summary}`);
    if (step.error) {
      console.log(`  error: ${step.error}`);
    }
  }
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printHelp(): void {
  console.log(`Usage: node dist/cli/dev-smoke.js [options]

Options:
  --host <host>              Device host or mDNS name (default: ${DEFAULT_HOST})
  --pem-path <path>          PEM path (default: ../seestar_3.1.2_fw_7.32_interop.pem)
  --mode <mode>              scenery | moon | sun | planet (default: scenery)
  --open-arm <mode>          if_needed | always | never (default: if_needed)
  --park-at-end <bool>       true | false (default: true)
  --timeout-ms <n>           Base SDK RPC timeout in ms
  --log-level <level>        trace | debug | info | warn | error (default: info)
  --json                     Print full JSON report
  --help                     Show this help
`);
}

main();
