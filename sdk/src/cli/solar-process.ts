import { resolve } from "node:path";
import {
  DEFAULT_SOLAR_REFERENCE_PERCENT,
  DEFAULT_SOLAR_STACK_PERCENT,
  type SolarProcessJob,
} from "../solar/jobs.js";
import { runSolarPipeline } from "../solar/pipeline.js";

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const input = asString(options.input);
  if (options.help || !input) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const job: SolarProcessJob = {
    inputPath: resolve(input),
    outputRootDir: resolve(asString(options.outputRootDir) ?? "./output"),
    python: {
      modulePath: resolve(asString(options.pythonModulePath) ?? "./py"),
    },
    pss: {
      pythonBin: resolve(asString(options.pythonBin) ?? "/home/chicks/workspaces/astronomy/seestar/venv/bin/python3"),
      pssSourcePath: resolve(asString(options.pssSourcePath) ?? "/tmp/opencode/PlanetarySystemStacker"),
      stackPercent: Number(asString(options.stackPercent) ?? DEFAULT_SOLAR_STACK_PERCENT),
      referenceFramePercent: Number(asString(options.referencePercent) ?? DEFAULT_SOLAR_REFERENCE_PERCENT),
      debayering: "Force Bayer GRBG",
      debayerMethod: "Edge Aware",
      stabilizationMode: "Surface",
    },
  };

  runSolarPipeline(job)
    .then((result) => {
      console.log("Solar pipeline completed.");
      console.log(`- stacked TIFF: ${result.stackedTiffPath}`);
      console.log(`- mono natural: ${result.presentationMonoPath}`);
      console.log(`- artistic gold: ${result.presentationArtisticGoldPath}`);
      console.log(`- review dir: ${result.layout.reviewDir}`);
      console.log(`- metadata: ${result.metadataPath}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
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

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function printHelp(): void {
  console.log(`Usage: node dist/cli/solar-process.js --input <raw-avi> [options]

Options:
  --output-root-dir <dir>   Root output directory (default: ./output)
  --stack-percent <n>       PSS stack percentage (default: 35)
  --reference-percent <n>   PSS reference-frame percentage (default: 10)
  --python-bin <path>       Python interpreter path
  --python-module-path <p>  Python package root (default: ./py)
  --pss-source-path <path>  PlanetarySystemStacker source checkout
  --help                    Show this help
`);
}

main();
