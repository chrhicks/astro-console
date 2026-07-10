import { Effect, Layer } from 'effect'
import type { TargetDetails } from '../../../shared/api-v2'
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
import type { ConnectedRig } from '../rig/rig-model'
import { SessionManager } from '../session/session-manager'
import { GeoService } from '../geo/geo-service'
import { CatalogStore } from './catalog-store'

const deepSkyIndex = buildSearchIndex(DEEP_SKY_TARGETS)
const deepSkyById = new Map(DEEP_SKY_TARGETS.map((target) => [target.id, target]))
const solarById = new Map(SOLAR_SYSTEM_TARGETS.map((target) => [target.id, target]))

export const CatalogStoreLive = Layer.effect(
  CatalogStore,
  Effect.gen(function* () {
    const sessions = yield* SessionManager
    const geo = yield* GeoService

    return {
      browse: (query) =>
        Effect.gen(function* () {
          const session = yield* sessions.getCurrent
          const { location } = yield* geo.resolveObserverLocation(
            session?.rig.observerLocation,
          )
          const search = query.search?.trim() ?? ''
          const hasSearch = search.length > 0
          const rig = session?.rig ?? null
          const canPoint = session?.rig.pointing !== undefined
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

          if (query.upNowOnly && location === null) {
            return buildCatalogPage([], query, false)
          }

          const visibilityById = location
            ? new Map(
                rankTargetsLight(
                  orderedTargets.map(toVisibilityTarget),
                  location,
                ).map((entry) => [entry.id, entry] as const),
              )
            : new Map<string, RankedVisibilityEntry>()

          const targets = orderedTargets
            .map((target) =>
              toTargetSummary(
                target,
                rig,
                canPoint,
                visibilityById.get(target.id),
              ),
            )
            .filter((target) => !query.upNowOnly || target.visibility === 'up')

          if (!hasSearch && location) {
            targets.sort(compareVisibleTargets)
          }

          return buildCatalogPage(targets, query, location !== null)
        }),
      getById: (targetId) =>
        Effect.succeed(
          deepSkyById.get(targetId) ?? solarById.get(targetId) ?? null,
        ),
      getDetailsById: (targetId) =>
        Effect.succeed(
          toTargetDetails(deepSkyById.get(targetId) ?? solarById.get(targetId) ?? null),
        ),
      getSummaryById: (targetId) =>
        Effect.gen(function* () {
          const session = yield* sessions.getCurrent
          const rig = session?.rig ?? null
          const canPoint = session?.rig.pointing !== undefined
          const target = deepSkyById.get(targetId) ?? solarById.get(targetId)
          if (!target) return null
          return toTargetSummary(target, rig, canPoint, undefined)
        }),
    } satisfies CatalogStore
  }),
)

function filterDeepSkyTargets(
  targets: DeepSkyTarget[],
  typeFilter: CatalogQuery['typeFilter'],
) {
  if (!typeFilter || typeFilter === 'dso') {
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

  return targets.filter((target) => target.targetType === typeFilter)
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
  rig: ConnectedRig | null,
  canPoint: boolean,
  visibility: RankedVisibilityEntry | undefined,
): TargetSummary {
  const type = target.targetType
  const recommendedFilter =
    rig && !rig.filterWheel
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
    availableActions: resolveAvailableActions(type, rig, canPoint),
  }
}

function toTargetDetails(
  target: DeepSkyTarget | SolarSystemTarget | null,
): TargetDetails | null {
  if (!target) return null

  if ('body' in target) {
    return {
      kind: 'solar-system',
      designation: target.designation,
      body: target.body,
    }
  }

  return {
    kind: 'dso',
    designation: target.designation,
    objectType: target.objectType,
    raHours: target.raHours,
    decDeg: target.decDeg,
    constellation: target.constellation,
    visualMagnitude: target.visualMagnitude,
    surfaceBrightness: target.surfaceBrightness,
    majorAxisArcmin: target.majorAxisArcmin,
  }
}

export function resolveAvailableActions(
  targetType: TargetSummary['type'],
  rig: ConnectedRig | null,
  canPoint: boolean,
): TargetAction[] {
  if (!rig) {
    return []
  }

  const actions: TargetAction[] = canPoint ? ['slew'] : []

  if (rig.capture && targetType !== 'sun') {
    actions.push('stack')
  }

  if (rig.preview) {
    actions.push('preview')
  }

  if (rig.filterWheel) {
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
