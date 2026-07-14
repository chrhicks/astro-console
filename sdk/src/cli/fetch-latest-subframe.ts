import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { resolveSeestarPemPath } from '../config.js'
import { SeestarDevice } from '../device.js'
import type { AlbumsResult } from '../types.js'

const DEFAULT_COUNT = 12
const DEFAULT_FRAME_CADENCE_SEC = 10
const DEFAULT_SEARCH_WINDOW_SEC = 20
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_QUICK_LOOK_COLUMNS = 4

type FetchArgs = {
  help?: boolean
  host?: string
  pemPath?: string
  outDir?: string
  targetName?: string
  subName?: string
  count: number
  frameCadenceSec: number
  searchWindowSec: number
  timeoutMs: number
  includeFit: boolean
  quickLook: boolean
  quickLookColumns: number
  json: boolean
}

type AlbumAssetEntry = {
  groupName?: string
  name: string
  thn: string
  count?: number
  type?: number
}

type DownloadedAsset = {
  fileName: string
  bytes: number
  sourceUrl: string
}

type DownloadedSubframe = {
  name: string
  capturedAt: string
  token: string
  jpg: DownloadedAsset
  fit?: DownloadedAsset
}

type SubframeManifest = {
  generatedAt: string
  host: string
  albumPath: string
  targetName?: string
  subframeAlbum: {
    name: string
    groupName?: string
    thumbPath: string
    count: number | null
    type: number | null
  }
  strategy: {
    method: string
    frameCadenceSec: number
    searchWindowSec: number
  }
  requestedCount: number
  targetCount: number
  downloadedCount: number
  includeFit: boolean
  downloads: DownloadedSubframe[]
  warnings: string[]
  quickLook: {
    enabled: boolean
    fileName?: string
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const host = args.host ?? process.env.SEESTAR_HOST
  if (!host) {
    throw new Error('Provide --host <ip-or-hostname> or set SEESTAR_HOST')
  }

  const pemPath = resolveSeestarPemPath({ explicitPath: args.pemPath })
  const outDir = resolve(
    args.outDir ??
      process.env.OUT_DIR ??
      `./downloads/${sanitizePathSegment(args.targetName ?? args.subName ?? 'latest-subframes')}`,
  )
  await mkdir(outDir, { recursive: true })

  const device = new SeestarDevice({
    host,
    pemPath,
    timeoutMs: args.timeoutMs,
  })

  try {
    const authenticated = await device.connectAndAuth()
    if (!authenticated) {
      throw new Error('Authentication failed')
    }

    const albums = await device.getAlbums()
    if (!albums) {
      throw new Error('get_albums returned no result')
    }

    const allEntries = flattenAlbumEntries(albums.list)
    const subframeEntry = pickSubframeEntry(allEntries, {
      targetName: args.targetName,
      subName: args.subName,
    })

    const latestDate = parseTimestampToken(subframeEntry.thn)
    const targetCount = deriveTargetCount(subframeEntry.count, args.count)
    const warnings: string[] = []
    const downloaded = await fetchLatestSubframes(device, {
      latestThumbPath: subframeEntry.thn,
      latestDate,
      outDir,
      targetCount,
      frameCadenceSec: args.frameCadenceSec,
      searchWindowSec: args.searchWindowSec,
      includeFit: args.includeFit,
      warnings,
      quiet: args.json,
    })

    const quickLookFileName = args.quickLook
      ? await writeQuickLook(outDir, {
          host,
          subframeName: subframeEntry.name,
          downloaded,
          frameCadenceSec: args.frameCadenceSec,
          columns: args.quickLookColumns,
        })
      : undefined

    const manifest: SubframeManifest = {
      generatedAt: new Date().toISOString(),
      host,
      albumPath: albums.path,
      targetName: args.targetName,
      subframeAlbum: {
        name: subframeEntry.name,
        groupName: subframeEntry.groupName,
        thumbPath: subframeEntry.thn,
        count: subframeEntry.count ?? null,
        type: subframeEntry.type ?? null,
      },
      strategy: {
        method: 'get_albums + HTTP timestamp inference',
        frameCadenceSec: args.frameCadenceSec,
        searchWindowSec: args.searchWindowSec,
      },
      requestedCount: args.count,
      targetCount,
      downloadedCount: downloaded.length,
      includeFit: args.includeFit,
      downloads: downloaded,
      warnings,
      quickLook: {
        enabled: args.quickLook,
        fileName: quickLookFileName,
      },
    }

    const manifestPath = join(outDir, 'latest-subframes-manifest.json')
    await writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8',
    )

    if (args.json) {
      console.log(JSON.stringify(manifest, null, 2))
      return
    }

    console.log(
      `Downloaded ${downloaded.length}/${targetCount} recent subframes from ${subframeEntry.name}`,
    )
    console.log(`Saved manifest: ${manifestPath}`)
    if (quickLookFileName) {
      console.log(
        `Saved quick-look contact sheet: ${join(outDir, quickLookFileName)}`,
      )
    }
    if (warnings.length > 0) {
      for (const warning of warnings) {
        console.warn(`Warning: ${warning}`)
      }
    }
  } finally {
    device.disconnect()
  }
}

function parseArgs(argv: string[]): FetchArgs {
  const out: FetchArgs = {
    count: DEFAULT_COUNT,
    frameCadenceSec: DEFAULT_FRAME_CADENCE_SEC,
    searchWindowSec: DEFAULT_SEARCH_WINDOW_SEC,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    includeFit: true,
    quickLook: false,
    quickLookColumns: DEFAULT_QUICK_LOOK_COLUMNS,
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      out.help = true
      continue
    }
    if (arg === '--json') {
      out.json = true
      continue
    }
    if (arg === '--quick-look') {
      out.quickLook = true
      continue
    }
    if (arg === '--jpg-only') {
      out.includeFit = false
      continue
    }
    if (!arg.startsWith('--')) {
      continue
    }

    const key = arg.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }
    index += 1

    switch (key) {
      case 'host':
        out.host = value
        break
      case 'pem-path':
        out.pemPath = value
        break
      case 'out-dir':
        out.outDir = value
        break
      case 'target':
        out.targetName = value
        break
      case 'sub-name':
        out.subName = value
        break
      case 'count':
        out.count = parsePositiveInteger('--count', value)
        break
      case 'frame-cadence-sec':
        out.frameCadenceSec = parsePositiveInteger('--frame-cadence-sec', value)
        break
      case 'search-window-sec':
        out.searchWindowSec = parseNonNegativeInteger(
          '--search-window-sec',
          value,
        )
        break
      case 'timeout-ms':
        out.timeoutMs = parsePositiveInteger('--timeout-ms', value)
        break
      case 'quick-look-columns':
        out.quickLookColumns = parsePositiveInteger(
          '--quick-look-columns',
          value,
        )
        break
      default:
        throw new Error(`Unknown option: --${key}`)
    }
  }

  return out
}

function parsePositiveInteger(label: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return parsed
}

function parseNonNegativeInteger(label: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return parsed
}

function flattenAlbumEntries(entries: AlbumsResult['list']): AlbumAssetEntry[] {
  return entries.flatMap((entry) =>
    entry.files.map((file) => ({
      groupName: entry.groupName,
      name: file.name,
      thn: file.thn,
      count: file.count,
      type: file.type,
    })),
  )
}

function pickSubframeEntry(
  entries: AlbumAssetEntry[],
  options: { targetName?: string; subName?: string },
): AlbumAssetEntry {
  if (options.subName) {
    return pickAlbumEntryByName(entries, options.subName)
  }

  const subframeEntries = entries.filter((entry) =>
    isLikelySubframeEntry(entry.name),
  )
  if (subframeEntries.length === 0) {
    throw new Error('No subframe album entries found from get_albums')
  }

  if (options.targetName) {
    const normalizedTarget = normalizeAlbumName(options.targetName)
    const targetEntries = subframeEntries.filter((entry) => {
      const normalizedName = normalizeAlbumName(entry.name)
      return (
        normalizedName === `${normalizedTarget}_sub` ||
        normalizedName.startsWith(`${normalizedTarget}_sub`) ||
        normalizedName.startsWith(normalizedTarget)
      )
    })
    if (targetEntries.length > 0) {
      return pickLatestEntry(targetEntries)
    }
  }

  return pickLatestEntry(subframeEntries)
}

function pickAlbumEntryByName(
  entries: AlbumAssetEntry[],
  requestedName: string,
): AlbumAssetEntry {
  const exactMatches = entries.filter((entry) => entry.name === requestedName)
  if (exactMatches.length > 0) {
    return pickLatestEntry(exactMatches)
  }

  const normalizedRequestedName = normalizeAlbumName(requestedName)
  const normalizedMatches = entries.filter(
    (entry) => normalizeAlbumName(entry.name) === normalizedRequestedName,
  )
  if (normalizedMatches.length > 0) {
    return pickLatestEntry(normalizedMatches)
  }

  const available = entries.map((entry) => entry.name).join(', ')
  throw new Error(
    `Album entry ${requestedName} not found. Available entries: ${available}`,
  )
}

function normalizeAlbumName(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

function isLikelySubframeEntry(name: string): boolean {
  const normalized = normalizeAlbumName(name)
  return normalized.endsWith('_sub') || normalized.endsWith('sub')
}

function pickLatestEntry(entries: AlbumAssetEntry[]): AlbumAssetEntry {
  if (entries.length === 0) {
    throw new Error('Cannot choose latest entry from an empty list')
  }
  return [...entries].sort((left, right) =>
    compareTimestampTokens(right.thn, left.thn),
  )[0]!
}

function compareTimestampTokens(left: string, right: string): number {
  const leftToken = extractTimestampToken(left) ?? ''
  const rightToken = extractTimestampToken(right) ?? ''
  if (leftToken === rightToken) {
    return 0
  }
  return leftToken.localeCompare(rightToken)
}

function extractTimestampToken(value: string): string | undefined {
  const match = value.match(/(\d{8}-\d{6})/)
  return match?.[1]
}

function parseTimestampToken(value: string): Date {
  const token = extractTimestampToken(value)
  if (!token) {
    throw new Error(`No timestamp token found in ${value}`)
  }

  const [date, time] = token.split('-')
  return new Date(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`,
  )
}

function formatTimestampToken(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function deriveTargetCount(
  availableCount: number | undefined,
  requestedCount: number,
): number {
  if (availableCount === undefined || availableCount <= 0) {
    return requestedCount
  }
  return Math.min(requestedCount, availableCount)
}

async function fetchLatestSubframes(
  device: SeestarDevice,
  options: {
    latestThumbPath: string
    latestDate: Date
    outDir: string
    targetCount: number
    frameCadenceSec: number
    searchWindowSec: number
    includeFit: boolean
    warnings: string[]
    quiet: boolean
  },
): Promise<DownloadedSubframe[]> {
  const downloaded: DownloadedSubframe[] = []
  const savedTokens = new Set<string>()
  const attemptedTokens = new Set<string>()
  const maxFrameOffsets = Math.max(
    options.targetCount * 4,
    options.targetCount + 12,
  )

  for (let frameOffset = 0; frameOffset < maxFrameOffsets; frameOffset += 1) {
    if (downloaded.length >= options.targetCount) {
      break
    }

    const estimate = new Date(
      options.latestDate.getTime() -
        frameOffset * options.frameCadenceSec * 1000,
    )
    const matched = await findNearbySubframe(device, {
      latestThumbPath: options.latestThumbPath,
      estimate,
      outDir: options.outDir,
      searchWindowSec: options.searchWindowSec,
      includeFit: options.includeFit,
      savedTokens,
      attemptedTokens,
    })
    if (!matched) {
      continue
    }

    downloaded.push(matched)
    if (!options.quiet) {
      console.log(
        `Downloaded subframe ${matched.name} captured at ${matched.capturedAt}`,
      )
    }
  }

  if (downloaded.length < options.targetCount) {
    options.warnings.push(
      `Requested ${options.targetCount} recent subframes but downloaded ${downloaded.length}. Increase --search-window-sec or adjust --frame-cadence-sec if needed.`,
    )
  }

  return downloaded
}

async function findNearbySubframe(
  device: SeestarDevice,
  options: {
    latestThumbPath: string
    estimate: Date
    outDir: string
    searchWindowSec: number
    includeFit: boolean
    savedTokens: Set<string>
    attemptedTokens: Set<string>
  },
): Promise<DownloadedSubframe | null> {
  for (let delta = 0; delta <= options.searchWindowSec; delta += 1) {
    const secondOffsets = delta === 0 ? [0] : [-delta, delta]
    for (const offsetSeconds of secondOffsets) {
      const candidateDate = new Date(
        options.estimate.getTime() + offsetSeconds * 1000,
      )
      const token = formatTimestampToken(candidateDate)
      if (
        options.savedTokens.has(token) ||
        options.attemptedTokens.has(token)
      ) {
        continue
      }

      options.attemptedTokens.add(token)
      const candidateThumbPath = options.latestThumbPath.replace(
        /\d{8}-\d{6}/,
        token,
      )

      try {
        const downloaded = await downloadKnownSubframe(device, {
          candidateThumbPath,
          capturedAt: candidateDate,
          outDir: options.outDir,
          includeFit: options.includeFit,
        })
        options.savedTokens.add(token)
        return downloaded
      } catch {
        // Keep searching nearby timestamp candidates.
      }
    }
  }

  return null
}

async function downloadKnownSubframe(
  device: SeestarDevice,
  options: {
    candidateThumbPath: string
    capturedAt: Date
    outDir: string
    includeFit: boolean
  },
): Promise<DownloadedSubframe> {
  const token = formatTimestampToken(options.capturedAt)
  const jpgUrl = device.resolveImageUrl(
    options.candidateThumbPath,
    false,
    '.jpg',
  )
  const jpg = await downloadAsset(jpgUrl, options.outDir)

  let fit: DownloadedAsset | undefined
  if (options.includeFit) {
    try {
      const fitUrl = device.resolveImageUrl(
        options.candidateThumbPath,
        false,
        '.fit',
      )
      fit = await downloadAsset(fitUrl, options.outDir)
    } catch {
      fit = undefined
    }
  }

  return {
    name: basename(options.candidateThumbPath).replace('_thn.jpg', ''),
    capturedAt: options.capturedAt.toISOString(),
    token,
    jpg,
    fit,
  }
}

async function downloadAsset(
  url: string,
  outDir: string,
): Promise<DownloadedAsset> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const fileName = basename(url)
  await writeFile(join(outDir, fileName), bytes)

  return {
    fileName,
    bytes: bytes.length,
    sourceUrl: url,
  }
}

async function writeQuickLook(
  outDir: string,
  options: {
    host: string
    subframeName: string
    downloaded: DownloadedSubframe[]
    frameCadenceSec: number
    columns: number
  },
): Promise<string> {
  const fileName = 'latest-subframes-contact-sheet.html'
  const html = buildQuickLookHtml({
    generatedAt: new Date().toISOString(),
    host: options.host,
    subframeName: options.subframeName,
    downloaded: options.downloaded,
    frameCadenceSec: options.frameCadenceSec,
    columns: options.columns,
  })
  await writeFile(join(outDir, fileName), html, 'utf8')
  return fileName
}

function buildQuickLookHtml(input: {
  generatedAt: string
  host: string
  subframeName: string
  downloaded: DownloadedSubframe[]
  frameCadenceSec: number
  columns: number
}): string {
  const cards = input.downloaded
    .map((frame) => {
      const capturedAt = new Date(frame.capturedAt).toLocaleString()
      return `<article class="card"><img loading="lazy" src="${escapeHtml(frame.jpg.fileName)}" alt="${escapeHtml(frame.name)}" /><p><strong>${escapeHtml(frame.name)}</strong><br/>${escapeHtml(capturedAt)}<br/>JPG ${frame.jpg.bytes} bytes${frame.fit ? `<br/>FIT ${frame.fit.bytes} bytes` : ''}</p></article>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Latest Subframes</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font: 14px/1.4 "Avenir Next", "Segoe UI", sans-serif; background: #f5f7fa; color: #1f2933; }
    main { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .meta { margin-bottom: 18px; }
    .meta p { margin: 4px 0; }
    .grid { display: grid; grid-template-columns: repeat(${input.columns}, minmax(0, 1fr)); gap: 12px; }
    .card { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(31, 41, 51, 0.08); }
    .card img { display: block; width: 100%; height: auto; background: #0f172a; }
    .card p { margin: 0; padding: 10px; }
    @media (max-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .grid { grid-template-columns: minmax(0, 1fr); }
    }
  </style>
</head>
<body>
  <main>
    <section class="meta">
      <h1>Latest subframes: ${escapeHtml(input.subframeName)}</h1>
      <p>Generated: ${escapeHtml(new Date(input.generatedAt).toLocaleString())}</p>
      <p>Host: ${escapeHtml(input.host)}</p>
      <p>Frames shown: ${input.downloaded.length}</p>
      <p>Inference cadence: ${input.frameCadenceSec}s</p>
    </section>
    <section class="grid">
      ${cards}
    </section>
  </main>
</body>
</html>
`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
  return cleaned.replace(/^-|-$/g, '') || 'latest-subframes'
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function printHelp(): void {
  console.log(`Usage: node dist/cli/fetch-latest-subframe.js [options]

Options:
  --host <host>                Device host or IP (or set SEESTAR_HOST)
  --pem-path <path>            PEM path (overrides $SEESTAR_PEM_PATH/$SEESTAR_PEM)
  --out-dir <path>             Destination directory (default: ./downloads/<target-or-sub-name>)
  --target <name>              Target name used to resolve the active *_sub album
  --sub-name <name>            Exact subframe album entry name to use
  --count <n>                  Number of recent subframes to fetch (default: ${DEFAULT_COUNT})
  --frame-cadence-sec <n>      Estimated subframe spacing in seconds (default: ${DEFAULT_FRAME_CADENCE_SEC})
  --search-window-sec <n>      Search window around each inferred timestamp (default: ${DEFAULT_SEARCH_WINDOW_SEC})
  --timeout-ms <n>             RPC timeout in ms (default: ${DEFAULT_TIMEOUT_MS})
  --jpg-only                   Skip FIT downloads and only fetch JPG files
  --quick-look                 Generate an HTML quick-look contact sheet
  --quick-look-columns <n>     Number of columns in quick-look sheet (default: ${DEFAULT_QUICK_LOOK_COLUMNS})
  --json                       Print manifest JSON to stdout
  --help                       Show this help

This command uses get_albums metadata plus HTTP file downloads to fetch recent accepted subframes
without requiring smbclient or issuing movement/control RPCs.
`)
}

void main().catch((error) => {
  console.error(toErrorMessage(error))
  process.exit(1)
})
