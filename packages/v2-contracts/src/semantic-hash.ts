import { NormalizedInputHash } from './primitives.js'

/**
 * Deterministic semantic bytes for proof simulations. Production may digest
 * these bytes cryptographically, but must preserve the explicit version and
 * canonical field ordering.
 */
export function versionedSemanticHash(
  version: string,
  value: unknown,
): typeof NormalizedInputHash.Type {
  return NormalizedInputHash.make(`${version}:${canonicalJson(value)}`)
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`
}
