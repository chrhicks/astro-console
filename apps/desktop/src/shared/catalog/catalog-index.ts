import type { DeepSkyTarget } from './catalog-schema'

export interface CatalogSearchIndex {
  byId: Map<string, number>                // target id → array index
  byMessierNumber: Map<string, number>     // "42" → array index (for M42)
  byConstellation: Map<string, number[]>  // "Ori" → [indices]
  byObjectType: Map<string, number[]>      // "G" → [indices]
  normalizedKeys: Array<{                   // pre-computed for fuzzy search
    index: number
    keys: string[]                          // ["m42", "ngc1976", "orionnebula", "orion"]
  }>
}

export function buildSearchIndex(catalog: DeepSkyTarget[]): CatalogSearchIndex {
  const byId = new Map<string, number>()
  const byMessierNumber = new Map<string, number>()
  const byConstellation = new Map<string, number[]>()
  const byObjectType = new Map<string, number[]>()
  const normalizedKeys = catalog.map((target, index) => {
    const normalizedId = normalizeLookupKey(target.id)
    const normalizedMessierNumber = target.messierNumber
      ? normalizeLookupKey(target.messierNumber)
      : undefined
    const normalizedConstellation = normalizeLookupKey(target.constellation)
    const normalizedObjectType = normalizeLookupKey(target.objectType)

    byId.set(normalizedId, index)

    if (normalizedMessierNumber) {
      byMessierNumber.set(normalizedMessierNumber, index)
    }

    pushIndexValue(byConstellation, normalizedConstellation, index)
    pushIndexValue(byObjectType, normalizedObjectType, index)

    return {
      index,
      keys: Array.from(
        new Set(
          [
            target.id,
            target.designation,
            target.commonName,
            ...target.alternativeDesignations,
            target.messierNumber,
            target.messierNumber ? `M${target.messierNumber}` : undefined,
            target.constellation,
            target.objectType,
          ]
            .map((value) => (value ? normalizeLookupKey(value) : ''))
            .filter(Boolean),
        ),
      ),
    }
  })

  return {
    byId,
    byMessierNumber,
    byConstellation,
    byObjectType,
    normalizedKeys,
  }
}

export function searchCatalog(
  index: CatalogSearchIndex,
  catalog: DeepSkyTarget[],
  query: string,
): DeepSkyTarget[] {
  const normalizedQuery = normalizeLookupKey(query)
  if (!normalizedQuery) {
    return catalog
  }

  const exactScores = new Map<number, number>()
  const messierQuery = stripMessierPrefix(normalizedQuery)

  setExactScore(exactScores, index.byId.get(normalizedQuery), 0)
  setExactScore(exactScores, index.byMessierNumber.get(messierQuery), 0)

  for (const match of index.byConstellation.get(normalizedQuery) ?? []) {
    setExactScore(exactScores, match, 7)
  }

  for (const match of index.byObjectType.get(normalizedQuery) ?? []) {
    setExactScore(exactScores, match, 8)
  }

  return index.normalizedKeys
    .map((entry) => {
      const target = catalog[entry.index]
      const score = scoreCatalogMatch(
        target,
        entry.keys,
        normalizedQuery,
        exactScores.get(entry.index),
      )

      if (score === null) {
        return null
      }

      return { target, score }
    })
    .filter((entry): entry is { target: DeepSkyTarget; score: number } => entry !== null)
    .sort(
      (left, right) =>
        left.score - right.score ||
        compareMagnitude(left.target.visualMagnitude, right.target.visualMagnitude) ||
        left.target.designation.localeCompare(right.target.designation),
    )
    .map((entry) => entry.target)
}

function scoreCatalogMatch(
  target: DeepSkyTarget,
  normalizedKeys: string[],
  normalizedQuery: string,
  exactScore: number | undefined,
): number | null {
  if (exactScore !== undefined) {
    return exactScore
  }

  const normalizedDesignation = normalizeLookupKey(target.designation)
  const normalizedCommonName = target.commonName
    ? normalizeLookupKey(target.commonName)
    : ''
  const normalizedAlternatives = target.alternativeDesignations.map(normalizeLookupKey)

  if (normalizedDesignation === normalizedQuery) {
    return 1
  }

  if (normalizedCommonName === normalizedQuery) {
    return 2
  }

  if (normalizedAlternatives.some((value) => value === normalizedQuery)) {
    return 3
  }

  if (normalizedDesignation.startsWith(normalizedQuery)) {
    return 4
  }

  if (normalizedCommonName.startsWith(normalizedQuery)) {
    return 5
  }

  if (normalizedAlternatives.some((value) => value.startsWith(normalizedQuery))) {
    return 6
  }

  if (normalizedKeys.some((value) => value.includes(normalizedQuery))) {
    return 9
  }

  return null
}

function pushIndexValue(index: Map<string, number[]>, key: string, value: number) {
  const existing = index.get(key)
  if (existing) {
    existing.push(value)
    return
  }

  index.set(key, [value])
}

function setExactScore(scores: Map<number, number>, index: number | undefined, score: number) {
  if (index === undefined) {
    return
  }

  const existing = scores.get(index)
  if (existing === undefined || score < existing) {
    scores.set(index, score)
  }
}

function stripMessierPrefix(value: string) {
  if (value.startsWith('m')) {
    return value.slice(1)
  }

  return value
}

function compareMagnitude(left: number | undefined, right: number | undefined) {
  if (left === undefined && right === undefined) {
    return 0
  }

  if (left === undefined) {
    return 1
  }

  if (right === undefined) {
    return -1
  }

  return left - right
}

function normalizeLookupKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}
