import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RankedTarget, SiteAzimuthRange } from '../../shared/planning'
import type { SiteDiagnostic } from '../../shared/site-diagnostics'
import {
  createPlanningContextServiceFromStateFile,
  type ActiveSiteSource,
  type PlanningTargetCandidate,
  type PlanningTargetSelectionInput,
} from './planning-context'

interface CliArgs {
  help?: boolean
  json?: boolean
  allowFirstSiteFallback?: boolean
  stateFile?: string
  activeSiteId?: string
  recommendation?: string
  targetId?: string
  query?: string
  limit?: string
  now?: string
  windowStartAt?: string
  windowEndAt?: string
  windowStepMinutes?: string
  siteName?: string
  siteLat?: string
  siteLon?: string
  siteTimezone?: string
  siteMinAltitudeDeg?: string
  siteBlockedRange?: string[]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const stateFile = resolveStateFile(args.stateFile)
  const recommendation = parseRecommendation(args.recommendation)
  const limit = parseNumberOption('--limit', args.limit)
  const windowStepMinutes = parseNumberOption(
    '--window-step-minutes',
    args.windowStepMinutes,
  )
  const siteLat = parseNumberOption('--site-lat', args.siteLat)
  const siteLon = parseNumberOption('--site-lon', args.siteLon)
  const siteMinAltitudeDeg = parseNumberOption(
    '--site-min-altitude-deg',
    args.siteMinAltitudeDeg,
  )
  const blockedAzimuthRanges = parseBlockedAzimuthRanges(
    args.siteBlockedRange ?? [],
  )

  const service = createPlanningContextServiceFromStateFile(stateFile)
  const input: PlanningTargetSelectionInput = {
    activeSiteId: args.activeSiteId,
    allowFirstSiteFallback: args.allowFirstSiteFallback === true,
    recommendation,
    targetId: args.targetId,
    query: args.query,
    limit,
    now: args.now,
    window:
      args.windowStartAt || args.windowEndAt || windowStepMinutes !== undefined
        ? {
            startAt: args.windowStartAt,
            endAt: args.windowEndAt,
            stepMinutes: windowStepMinutes,
          }
        : undefined,
    siteOverride:
      args.siteName ||
      siteLat !== undefined ||
      siteLon !== undefined ||
      args.siteTimezone ||
      siteMinAltitudeDeg !== undefined ||
      blockedAzimuthRanges.length > 0
        ? {
            name: args.siteName,
            lat: siteLat,
            lon: siteLon,
            timezone: args.siteTimezone,
            minAltitudeDeg: siteMinAltitudeDeg,
            blockedAzimuthRanges:
              blockedAzimuthRanges.length > 0
                ? blockedAzimuthRanges
                : undefined,
          }
        : undefined,
  }

  const selection = await service.selectTarget(input)
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          stateFile,
          activeSiteSource: selection.context.activeSiteSource,
          activeSite: selection.context.activeSite,
          siteDiagnostics: selection.context.siteDiagnostics,
          state: {
            activeSiteId: selection.context.snapshot.state.activeSiteId,
            siteCount: selection.context.snapshot.state.sites.length,
            catalogCount: selection.context.snapshot.state.catalog.length,
            rankedCount: selection.context.rankedTargets.length,
          },
          request: {
            activeSiteId: input.activeSiteId,
            allowFirstSiteFallback: input.allowFirstSiteFallback,
            recommendation: input.recommendation ?? 'good_now',
            targetId: input.targetId,
            query: input.query,
            limit: input.limit,
            now: input.now,
            window: input.window,
            siteOverride: input.siteOverride,
          },
          selected: selection.selected
            ? formatCandidate(selection.selected)
            : undefined,
          candidates: selection.candidates.map((candidate) =>
            formatCandidate(candidate),
          ),
        },
        null,
        2,
      ),
    )
    return
  }

  printTextOutput({
    stateFile,
    source: selection.context.activeSiteSource,
    recommendation: input.recommendation ?? 'good_now',
    candidates: selection.candidates,
    selected: selection.selected,
    activeSite: selection.context.activeSite,
    siteDiagnostics: selection.context.siteDiagnostics,
  })
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {}

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
    if (arg === '--allow-first-site-fallback') {
      out.allowFirstSiteFallback = true
      continue
    }
    if (!arg.startsWith('--')) {
      continue
    }

    const key = arg.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      continue
    }

    if (key === 'site-blocked-range') {
      out.siteBlockedRange = [...(out.siteBlockedRange ?? []), value]
      index += 1
      continue
    }

    out[toCamelCase(key) as keyof CliArgs] = value as never
    index += 1
  }

  return out
}

function resolveStateFile(rawStateFile: string | undefined): string {
  const fromArg = rawStateFile?.trim()
  const fromEnv = process.env.SEESTAR_PLANNING_STATE?.trim()
  const stateFile = resolve(
    fromArg || fromEnv || 'planning/planning-state.json',
  )
  if (!existsSync(stateFile)) {
    throw new Error(
      `Planning state file not found at ${stateFile}. Use --state-file <path>.`,
    )
  }
  return stateFile
}

function parseRecommendation(
  value: string | undefined,
): PlanningTargetSelectionInput['recommendation'] | undefined {
  if (!value) return undefined
  if (
    value === 'any' ||
    value === 'good_now' ||
    value === 'later_tonight' ||
    value === 'not_tonight'
  ) {
    return value
  }
  throw new Error(
    `Invalid --recommendation ${value}. Use good_now, later_tonight, not_tonight, or any.`,
  )
}

function parseNumberOption(
  label: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return parsed
}

function parseBlockedAzimuthRanges(values: string[]): SiteAzimuthRange[] {
  return values.map((value, index) => {
    const [rangePart, ...labelParts] = value.split(':')
    const match = rangePart
      .trim()
      .match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/u)
    if (!match) {
      throw new Error(
        `Invalid --site-blocked-range at position ${index + 1}: ${value}`,
      )
    }
    const label = labelParts.join(':').trim()
    return {
      startDeg: Number(match[1]),
      endDeg: Number(match[2]),
      ...(label ? { label } : {}),
    }
  })
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function formatCandidate(candidate: PlanningTargetCandidate): {
  targetId: string
  targetName: string
  recommendation: RankedTarget['recommendation']
  score: number
  visibleMinutes: number
  skyVisibleMinutes: number
  windowStartAt?: string
  windowEndAt?: string
  moonSeparationDeg?: number
  matchKind?: string
} {
  return {
    targetId: candidate.target.id,
    targetName: candidate.target.primaryName,
    recommendation: candidate.ranking.recommendation,
    score: candidate.ranking.score,
    visibleMinutes: candidate.ranking.visibleMinutes,
    skyVisibleMinutes: candidate.ranking.skyVisibleMinutes,
    windowStartAt: candidate.ranking.windowStartAt,
    windowEndAt: candidate.ranking.windowEndAt,
    moonSeparationDeg: candidate.ranking.moonSeparationDeg,
    matchKind: candidate.matchKind,
  }
}

function printTextOutput(input: {
  stateFile: string
  source: ActiveSiteSource
  recommendation: string
  activeSite: {
    name: string
    id: string
    timezone: string
    minAltitudeDeg: number
  }
  siteDiagnostics: SiteDiagnostic[]
  candidates: PlanningTargetCandidate[]
  selected?: PlanningTargetCandidate
}): void {
  console.log(`Planning context: ${input.stateFile}`)
  console.log(
    `Active site: ${input.activeSite.name} (${input.activeSite.id}) via ${input.source}; timezone ${input.activeSite.timezone}; min altitude ${input.activeSite.minAltitudeDeg} deg`,
  )

  if (input.siteDiagnostics.length > 0) {
    console.log('Site diagnostics:')
    for (const diagnostic of input.siteDiagnostics) {
      console.log(`- ${diagnostic.summary}`)
      console.log(`  Repair path: ${diagnostic.repairHint}`)
    }
  }

  console.log(`Recommendation filter: ${input.recommendation}`)

  if (input.selected) {
    console.log(
      `Selected: ${input.selected.target.primaryName} (${input.selected.target.id}) score ${input.selected.ranking.score.toFixed(1)} recommendation ${input.selected.ranking.recommendation}`,
    )
  } else {
    console.log('Selected: none')
  }

  if (input.candidates.length === 0) {
    console.log('No candidates matched the selection.')
    return
  }

  console.log('Candidates:')
  for (const candidate of input.candidates) {
    const window =
      candidate.ranking.windowStartAt && candidate.ranking.windowEndAt
        ? `${formatClock(candidate.ranking.windowStartAt)}-${formatClock(candidate.ranking.windowEndAt)}`
        : 'n/a'
    console.log(
      `- ${candidate.target.primaryName} (${candidate.target.id}) ${candidate.ranking.recommendation} score=${candidate.ranking.score.toFixed(1)} visible=${candidate.ranking.visibleMinutes}m window=${window}`,
    )
  }
}

function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function printHelp(): void {
  console.log(`Usage: node dist/main/planning-context-cli.js [options]

Options:
  --state-file <path>            Path to planning-state.json
  --active-site-id <id>          Override active site ID
  --allow-first-site-fallback    Use first non-archived site when active site is missing
  --recommendation <value>       good_now | later_tonight | not_tonight | any (default: good_now)
  --target-id <id>               Filter by exact catalog target ID
  --query <text>                 Search filter across catalog fields
  --limit <n>                    Candidate limit (default: 10, max: 50)
  --now <iso>                    Override evaluation timestamp
  --window-start-at <iso>        Override visibility window start
  --window-end-at <iso>          Override visibility window end
  --window-step-minutes <n>      Override ranking sample cadence
  --site-name <text>             Override site name
  --site-lat <n>                 Override site latitude
  --site-lon <n>                 Override site longitude
  --site-timezone <iana>         Override site IANA timezone
  --site-min-altitude-deg <n>    Override site minimum altitude floor
  --site-blocked-range <spec>    Repeatable start-end[:label] azimuth mask override
  --json                         Print structured JSON output
  --help                         Show this help

Environment:
  SEESTAR_PLANNING_STATE         Fallback path when --state-file is not set
`)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
