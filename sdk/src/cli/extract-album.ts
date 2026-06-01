import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { posix as posixPath } from "node:path";
import { resolveSeestarPemPath } from "../config.js";
import { SeestarDevice } from "../device.js";

type ExtractArgs = {
  help?: boolean;
  host?: string;
  pemPath?: string;
  outDir?: string;
  stackName: string;
  subName?: string;
  subframesMode: "all" | "sample";
  sampleCount: number;
  frameCadenceSec: number;
  searchWindowSec: number;
};

type AlbumAssetEntry = {
  groupName?: string;
  name: string;
  thn: string;
  count?: number;
  type?: number;
};

type DownloadedAsset = {
  fileName: string;
  bytes: number;
};

type DownloadedStill = {
  jpg: DownloadedAsset;
  fit?: DownloadedAsset;
};

type DownloadedSubframe = {
  name: string;
  capturedAt: string;
  jpg: DownloadedAsset;
  fit?: DownloadedAsset;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const host = args.host ?? process.env.SEESTAR_HOST;
  if (!host) {
    throw new Error("Provide --host <ip-or-hostname> or set SEESTAR_HOST");
  }

  const pemPath = resolveSeestarPemPath({ explicitPath: args.pemPath });
  const outDir = resolve(
    args.outDir
      ?? process.env.OUT_DIR
      ?? `./downloads/${sanitizePathSegment(args.stackName)}-extract`
  );
  const subName = args.subName ?? `${args.stackName}_sub`;

  await mkdir(outDir, { recursive: true });

  const device = new SeestarDevice({
    host,
    pemPath,
    timeoutMs: 15000,
  });

  try {
    const authenticated = await device.connectAndAuth();
    if (!authenticated) {
      throw new Error("Authentication failed");
    }

    const albums = await device.getAlbums();
    if (!albums) {
      throw new Error("get_albums returned no result");
    }

    const entries = flattenAlbumEntries(albums.list);
    const stackEntry = pickAlbumEntry(entries, args.stackName);
    const subEntry = pickAlbumEntry(entries, subName);

    const summary = {
      host,
      albumPath: albums.path,
      stackName: stackEntry.name,
      subName: subEntry.name,
      outDir,
      subframesMode: args.subframesMode,
      subframesAvailable: subEntry.count ?? null,
      sampleCountRequested: args.sampleCount,
      frameCadenceSec: args.frameCadenceSec,
      searchWindowSec: args.searchWindowSec,
      downloadedAt: new Date().toISOString(),
      stacked: await downloadStillEntry(device, stackEntry, outDir),
      subframes: args.subframesMode === "all"
        ? await downloadAllSubs(device, subEntry, outDir, {
          frameCadenceSec: args.frameCadenceSec,
          searchWindowSec: args.searchWindowSec,
        })
        : await downloadSampledSubs(device, subEntry, outDir, {
          sampleCount: args.sampleCount,
          frameCadenceSec: args.frameCadenceSec,
          searchWindowSec: args.searchWindowSec,
        }),
    };

    const summaryPath = join(outDir, "extract-summary.json");
    await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

    console.log(`Saved extraction summary to ${summaryPath}`);
    console.log(
      `Downloaded stacked assets plus ${summary.subframes.length} ${args.subframesMode === "all" ? "subframes" : "sampled subframes"} into ${outDir}`
    );
  } finally {
    device.disconnect();
  }
}

function parseArgs(argv: string[]): ExtractArgs {
  const out: ExtractArgs = {
    stackName: "M81",
    subframesMode: "all",
    sampleCount: 12,
    frameCadenceSec: 10,
    searchWindowSec: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    index += 1;

    if (key === "host") out.host = value;
    if (key === "pem-path") out.pemPath = value;
    if (key === "out-dir") out.outDir = value;
    if (key === "stack-name" && value) out.stackName = value;
    if (key === "sub-name") out.subName = value;
    if (key === "subframes") out.subframesMode = asSubframesMode(value, out.subframesMode);
    if (key === "sample-count") out.sampleCount = asPositiveInt(value, out.sampleCount);
    if (key === "frame-cadence-sec") out.frameCadenceSec = asPositiveInt(value, out.frameCadenceSec);
    if (key === "search-window-sec") out.searchWindowSec = asNonNegativeInt(value, out.searchWindowSec);
  }

  return out;
}

function asPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function asNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function asSubframesMode(value: string | undefined, fallback: ExtractArgs["subframesMode"]): ExtractArgs["subframesMode"] {
  return value === "all" || value === "sample" ? value : fallback;
}

function flattenAlbumEntries(entries: Array<{ groupName?: string; files: Array<{ name: string; thn: string; count?: number; type?: number }> }>): AlbumAssetEntry[] {
  return entries.flatMap((entry) =>
    entry.files.map((file) => ({
      groupName: entry.groupName,
      name: file.name,
      thn: file.thn,
      count: file.count,
      type: file.type,
    }))
  );
}

function pickAlbumEntry(entries: AlbumAssetEntry[], requestedName: string): AlbumAssetEntry {
  const exactMatches = entries.filter((entry) => entry.name === requestedName);
  if (exactMatches.length > 0) {
    return pickLatestEntry(exactMatches);
  }

  const normalizedName = normalizeAlbumName(requestedName);
  const normalizedMatches = entries.filter((entry) => normalizeAlbumName(entry.name) === normalizedName);
  if (normalizedMatches.length > 0) {
    return pickLatestEntry(normalizedMatches);
  }

  const available = entries.map((entry) => entry.name).join(", ");
  throw new Error(`Album entry ${requestedName} not found. Available entries: ${available}`);
}

function pickLatestEntry(entries: AlbumAssetEntry[]): AlbumAssetEntry {
  return [...entries].sort((left, right) => extractTimestampToken(right.thn).localeCompare(extractTimestampToken(left.thn)))[0]!;
}

function normalizeAlbumName(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function extractTimestampToken(value: string): string {
  const match = value.match(/(\d{8}-\d{6})/);
  return match?.[1] ?? "";
}

function parseTimestampToken(value: string): Date {
  const token = extractTimestampToken(value);
  if (!token) {
    throw new Error(`No timestamp token found in ${value}`);
  }

  const [date, time] = token.split("-");
  return new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`);
}

function formatTimestampToken(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function downloadStillEntry(
  device: SeestarDevice,
  entry: AlbumAssetEntry,
  outDir: string
): Promise<DownloadedStill> {
  const jpg = await downloadAsset(
    device.resolveImageUrl(entry.thn, false, ".jpg"),
    outDir
  );
  console.log(`Downloaded ${entry.name} JPG: ${jpg.fileName}`);

  let fit: DownloadedAsset | undefined;
  try {
    fit = await downloadAsset(device.resolveImageUrl(entry.thn, false, ".fit"), outDir);
    console.log(`Downloaded ${entry.name} FIT: ${fit.fileName}`);
  } catch (error) {
    console.warn(`Could not download FIT for ${entry.name}: ${toErrorMessage(error)}`);
  }

  return { jpg, fit };
}

async function downloadSampledSubs(
  device: SeestarDevice,
  subEntry: AlbumAssetEntry,
  outDir: string,
  options: {
    sampleCount: number;
    frameCadenceSec: number;
    searchWindowSec: number;
  }
): Promise<DownloadedSubframe[]> {
  const latestThumbPath = subEntry.thn;
  const latestDate = parseTimestampToken(latestThumbPath);
  const totalCount = Math.max(subEntry.count ?? options.sampleCount, options.sampleCount);
  const savedTokens = new Set<string>();
  const downloads: DownloadedSubframe[] = [];

  for (let index = 0; index < options.sampleCount; index += 1) {
    const sampleFraction = options.sampleCount === 1 ? 0 : index / (options.sampleCount - 1);
    const frameOffset = Math.round((totalCount - 1) * sampleFraction);
    const estimate = new Date(latestDate.getTime() - frameOffset * options.frameCadenceSec * 1000);
    const matched = await findNearbySubframe(
      device,
      latestThumbPath,
      estimate,
      outDir,
      savedTokens,
      options.searchWindowSec,
      "sample"
    );
    if (matched) {
      downloads.push(matched);
    }
  }

  return downloads;
}

async function downloadAllSubs(
  device: SeestarDevice,
  subEntry: AlbumAssetEntry,
  outDir: string,
  options: {
    frameCadenceSec: number;
    searchWindowSec: number;
  }
): Promise<DownloadedSubframe[]> {
  const latestThumbPath = subEntry.thn;
  const latestDate = parseTimestampToken(latestThumbPath);
  const expectedCount = Math.max(subEntry.count ?? 1, 1);
  const savedTokens = new Set<string>();
  const downloads: DownloadedSubframe[] = [];

  const latest = await downloadKnownSubframe(device, latestThumbPath, latestDate, outDir, savedTokens, "latest");
  downloads.push(latest);

  let cursor = latestDate;
  while (downloads.length < expectedCount) {
    const estimate = new Date(cursor.getTime() - options.frameCadenceSec * 1000);
    const matched = await findNearbySubframe(
      device,
      latestThumbPath,
      estimate,
      outDir,
      savedTokens,
      options.searchWindowSec,
      "full-set"
    );
    if (!matched) {
      console.warn(
        `Stopped after downloading ${downloads.length} subframes; could not find another frame near ${estimate.toISOString()}`
      );
      break;
    }

    downloads.push(matched);
    cursor = new Date(matched.capturedAt);
  }

  if (downloads.length < expectedCount) {
    console.warn(`Expected about ${expectedCount} subframes but downloaded ${downloads.length}`);
  }

  return downloads;
}

async function findNearbySubframe(
  device: SeestarDevice,
  latestThumbPath: string,
  estimate: Date,
  outDir: string,
  savedTokens: Set<string>,
  searchWindowSec: number,
  modeLabel: string
): Promise<DownloadedSubframe | null> {
  for (let delta = 0; delta <= searchWindowSec; delta += 1) {
    const secondOffsets = delta === 0 ? [0] : [-delta, delta];
    for (const offsetSeconds of secondOffsets) {
      const candidateDate = new Date(estimate.getTime() + offsetSeconds * 1000);
      const token = formatTimestampToken(candidateDate);
      if (savedTokens.has(token)) {
        continue;
      }

      const candidateThumbPath = latestThumbPath.replace(/\d{8}-\d{6}/, token);

      try {
        return await downloadKnownSubframe(device, candidateThumbPath, candidateDate, outDir, savedTokens, modeLabel);
      } catch {
        // Keep searching nearby timestamps.
      }
    }
  }

  return null;
}

async function downloadKnownSubframe(
  device: SeestarDevice,
  candidateThumbPath: string,
  capturedAt: Date,
  outDir: string,
  savedTokens: Set<string>,
  modeLabel: string
): Promise<DownloadedSubframe> {
  const token = formatTimestampToken(capturedAt);
  const jpg = await downloadAsset(device.resolveImageUrl(candidateThumbPath, false, ".jpg"), outDir);
  savedTokens.add(token);
  console.log(`Downloaded ${modeLabel} subframe JPG: ${jpg.fileName}`);

  let fit: DownloadedAsset | undefined;
  try {
    fit = await downloadAsset(device.resolveImageUrl(candidateThumbPath, false, ".fit"), outDir);
    console.log(`Downloaded ${modeLabel} subframe FIT: ${fit.fileName}`);
  } catch (error) {
    console.warn(`Could not download FIT for ${jpg.fileName}: ${toErrorMessage(error)}`);
  }

  return {
    name: posixPath.basename(candidateThumbPath).replace("_thn.jpg", ""),
    capturedAt: capturedAt.toISOString(),
    jpg,
    fit,
  };
}

async function downloadAsset(url: string, outDir: string): Promise<DownloadedAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const fileName = basename(url);
  const destPath = join(outDir, fileName);
  await writeFile(destPath, bytes);
  return {
    fileName,
    bytes: bytes.length,
  };
}

function sanitizePathSegment(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-");
  return cleaned.replace(/^-|-$/g, "") || "extract";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printHelp(): void {
  console.log(`Usage: node dist/cli/extract-album.js [options]

Options:
  --host <host>              Device host or IP (or set SEESTAR_HOST)
  --pem-path <path>          PEM path (overrides $SEESTAR_PEM_PATH/$SEESTAR_PEM)
  --out-dir <path>           Destination directory (default: ./downloads/<stack-name>-extract)
  --stack-name <name>        Stack album entry to download (default: M81)
  --sub-name <name>          Subframe album entry to pull (default: <stack-name>_sub)
  --subframes <mode>         all | sample (default: all)
  --sample-count <n>         Number of representative subframes when using sample mode (default: 12)
  --frame-cadence-sec <n>    Estimated spacing between saved subs in seconds (default: 10)
  --search-window-sec <n>    Search around estimated timestamps for existing files (default: 20)
  --help                     Show this help

This extracts the current stacked JPG/FIT pair plus either the full subframe set or sampled subframe JPG/FIT pairs for a target album.
`);
}

void main().catch((error) => {
  console.error(toErrorMessage(error));
  process.exit(1);
});
