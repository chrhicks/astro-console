import { Effect, Layer } from 'effect'
import { SOLAR_SYSTEM_TARGETS, DEEP_SKY_TARGETS } from '../../../shared/catalog/catalog-data'
import {
  buildSearchIndex,
  searchCatalog,
} from '../../../shared/catalog/catalog-index'
import type {
  CatalogPage,
  CatalogQuery,
  DeepSkyTarget,
  SolarSystemTarget,
  TargetAction,
  TargetSummary,
} from '../../../shared/catalog/catalog-schema'
import {
  rankTargetsLight,
  type RankedVisibilityEntry,
  type VisibilityTarget,
} from '../../../shared/visibility-engine'
import type { DeviceCapabilities } from '../device/device-plugin'
import { ObserverContextStore } from '../observer/observer-context-store'
import { SessionManager } from '../session/session-manager'
import { CatalogStore } from './catalog-store'

const deepSkyIndex = buildSearchIndex(DEEP_SKY_TARGETS)
const deepSkyById = new Map(DEEP_SKY_TARGETS.map((target) => [target.id, target]))
const solarById = new Map(SOLAR_SYSTEM_TARGETS.map((target) => [target.id, target]))

export const CatalogStoreLive = Layer.effect(
  CatalogStore,
  Effect.gen(function* () {
    const sessions = yield* SessionManager
    const observerContextStore = yield* ObserverContextStore

    return {
      browse: (query) =>
        Effect.gen(function* () {
          const session = yield* sessions.getCurrent
          const observerContext = yield* observerContextStore.getCurrent()
          const search = query.search?.trim() ?? ''
          const hasSearch = search.length > 0
          const capabilities = session?.capabilities ?? null
          const deepSkyTargets = filterDeepSkyTargets(
            hasSearch
              ? searchCatalog(deepSkyIndex, DEEP_SKY_TARGETS, search)
              : DEEP_SKY_TARGETS,
            query.typeFilter,
          )
          const solarMatches = filterSolarTargets(
            SOLAR_SYSTEM_TARGETS,
            query.typeFilter,
          )
          const orderedTargets = mergeBrowseTargets(
            deepSkyTargets,
            solarMatches,
            search,
          )

          if (query.upNowOnly && observerContext === null) {
            return buildCatalogPage([], query, false)
          }

          const visibilityById = observerContext
            ? new Map(
                rankTargetsLight(
                  orderedTargets.map(toVisibilityTarget),
                  observerContext,
                ).map((entry) => [entry.id, entry] as const),
              )
            : new Map<string, RankedVisibilityEntry>()

          const targets = orderedTargets
            .map((target) =>
              toTargetSummary(target, capabilities, visibilityById.get(target.id)),
            )
            .filter((target) => !query.upNowOnly || target.visibility === 'up')

          if (!hasSearch && observerContext) {
            targets.sort(compareVisibleTargets)
          }

          return buildCatalogPage(targets, query, observerContext !== null)
        }),
      getById: (targetId) =>
        Effect.succeed(
          deepSkyById.get(targetId) ?? solarById.get(targetId) ?? null,
        ),
      getSummaryById: (targetId) =>
        Effect.gen(function* () {
          const session = yield* sessions.getCurrent
          const capabilities = session?.capabilities ?? null
          const target = deepSkyById.get(targetId) ?? solarById.get(targetId)
          if (!target) return null
          return toTargetSummary(target, capabilities, undefined)
        }),
    } satisfies CatalogStore
  }),
)

function filterDeepSkyTargets(
  targets: DeepSkyTarget[],
  typeFilter: CatalogQuery['typeFilter'],
) {
  if (!typeFilter || typeFilter === 'dso' || typeFilter === 'star') {
    return targets
  }

  return []
}

function filterSolarTargets(
  targets: SolarSystemTarget[],
  typeFilter: CatalogQuery['typeFilter'],
) {
  if (!typeFilter) {
    return targets
  }

  if (typeFilter === 'dso') {
    return []
  }

  return targets.filter((target) => target.viewMode === typeFilter)
}

function mergeBrowseTargets(
  deepSkyTargets: DeepSkyTarget[],
  solarTargets: SolarSystemTarget[],
  search: string,
): Array<DeepSkyTarget | SolarSystemTarget> {
  if (!search) {
    return [...deepSkyTargets, ...solarTargets]
  }

  const scoredSolarTargets = solarTargets
    .map((target) => ({
      target,
      score: scoreSolarSearch(target, search),
    }))
    .filter(
      (
        entry,
      ): entry is {
        target: SolarSystemTarget
        score: number
      } => entry.score !== null,
    )
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.target.designation.localeCompare(right.target.designation),
    )

  const leadingSolarTargets = scoredSolarTargets
    .filter((entry) => entry.score <= 1)
    .map((entry) => entry.target)
  const trailingSolarTargets = scoredSolarTargets
    .filter((entry) => entry.score > 1)
    .map((entry) => entry.target)

  return [...leadingSolarTargets, ...deepSkyTargets, ...trailingSolarTargets]
}

function scoreSolarSearch(target: SolarSystemTarget, search: string) {
  const normalizedQuery = normalizeLookupKey(search)
  if (!normalizedQuery) {
    return 2
  }

  const normalizedId = normalizeLookupKey(target.id)
  const normalizedDesignation = normalizeLookupKey(target.designation)

  if (normalizedId === normalizedQuery || normalizedDesignation === normalizedQuery) {
    return 0
  }

  if (
    normalizedId.startsWith(normalizedQuery) ||
    normalizedDesignation.startsWith(normalizedQuery)
  ) {
    return 1
  }

  if (
    normalizedId.includes(normalizedQuery) ||
    normalizedDesignation.includes(normalizedQuery)
  ) {
    return 2
  }

  return null
}

function toVisibilityTarget(
  target: DeepSkyTarget | SolarSystemTarget,
): VisibilityTarget {
  if ('body' in target) {
    return { id: target.id, body: target.body }
  }

  return {
    id: target.id,
    raHours: target.raHours,
    decDeg: target.decDeg,
  }
}

function toTargetSummary(
  target: DeepSkyTarget | SolarSystemTarget,
  capabilities: DeviceCapabilities | null,
  visibility: RankedVisibilityEntry | undefined,
): TargetSummary {
  const type = resolveTargetType(target)
  const recommendedFilter =
    capabilities && !capabilities.supportsFilterWheel
      ? null
      : target.recommendedFilter

  return {
    id: target.id,
    short: target.designation,
    name: 'commonName' in target ? target.commonName ?? target.designation : target.designation,
    visibility: visibility?.visibility,
    visibilityLabel: visibility?.visibilityLabel,
    recommendedFilter,
    type,
    availableActions: resolveAvailableActions(type, capabilities),
  }
}

function resolveTargetType(target: DeepSkyTarget | SolarSystemTarget) {
  if (!('body' in target)) {
    return 'dso' as const
  }

  if (target.body === 'sun') {
    return 'sun' as const
  }

  if (target.body === 'moon') {
    return 'moon' as const
  }

  return 'planet' as const
}

function resolveAvailableActions(
  targetType: TargetSummary['type'],
  capabilities: DeviceCapabilities | null,
): TargetAction[] {
  if (!capabilities) {
    return []
  }

  const actions: TargetAction[] = ['slew']

  if (capabilities.supportsStacking && targetType !== 'sun') {
    actions.push('stack')
  }

  if (capabilities.supportsLivePreview) {
    actions.push('preview')
  }

  if (capabilities.supportsFilterWheel) {
    actions.push('filter')
  }

  return actions
}

function compareVisibleTargets(left: TargetSummary, right: TargetSummary) {
  return (
    visibilityRank(left.visibility) - visibilityRank(right.visibility) ||
    left.short.localeCompare(right.short)
  )
}

function visibilityRank(visibility: TargetSummary['visibility']) {
  if (visibility === 'up') {
    return 0
  }

  if (visibility === 'later') {
    return 1
  }

  return 2
}

function buildCatalogPage(
  targets: TargetSummary[],
  query: CatalogQuery,
  visibilityAvailable: boolean,
): CatalogPage {
  const total = targets.length
  const offset = normalizeCount(query.offset)
  const limit = query.limit === undefined ? total : normalizeCount(query.limit)

  return {
    targets: targets.slice(offset, offset + limit),
    total,
    offset,
    limit,
    visibilityAvailable,
  }
}

function normalizeCount(value: number | undefined) {
  if (value === undefined) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

function normalizeLookupKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}
