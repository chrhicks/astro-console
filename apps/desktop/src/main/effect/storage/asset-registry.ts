import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'

const assets = new Map<string, string>()

export function registerManagedAsset(canonicalPath: string): string {
  const resolved = realpathSync(canonicalPath)
  const existing = [...assets].find(([, value]) => value === resolved)
  if (existing) return existing[0]
  const id = randomUUID()
  assets.set(id, resolved)
  return id
}

export function getManagedAssetPath(id: string): string | undefined {
  return assets.get(id)
}
