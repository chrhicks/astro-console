import { Result, Schema } from 'effect'
import type { Workspace } from './presentation'

export const AssetId = Schema.NonEmptyString.pipe(Schema.brand('AssetId'))
export type AssetId = Schema.Schema.Type<typeof AssetId>

export type Route =
  | { kind: 'workspace'; workspace: Workspace }
  | { kind: 'asset'; assetId: AssetId }
  | { kind: 'process-source'; sourceAssetId: AssetId }
  | { kind: 'not-found' }

function decodePathId(value: string) {
  try {
    return value ? decodeURIComponent(value) : undefined
  } catch {
    return undefined
  }
}

function decodeAssetId(value: unknown): AssetId | undefined {
  const result = Schema.decodeUnknownResult(AssetId)(value)
  return Result.isSuccess(result) ? result.success : undefined
}

function parseWorkspace(value: string | undefined): Workspace | undefined {
  switch (value) {
    case 'plan':
    case 'observe':
    case 'library':
    case 'process':
      return value
  }
}

export function parseRoute(pathname: string, search = ''): Route {
  const parts = pathname.split('/').filter(Boolean)
  const sourceAssetId = new URLSearchParams(search).get('sourceAssetId')
  const first = parts[0]
  const second = parts[1]
  if (parts.length === 1 && first === 'process' && sourceAssetId) {
    const id = decodeAssetId(sourceAssetId)
    if (id) return { kind: 'process-source', sourceAssetId: id }
  }
  if (parts.length === 0 || (parts.length === 1 && first === 'plan'))
    return { kind: 'workspace', workspace: 'plan' }
  const workspace = parseWorkspace(first)
  if (parts.length === 1 && workspace) return { kind: 'workspace', workspace }
  const pathId = parts.length === 3 ? decodePathId(parts[2] ?? '') : undefined
  if (first === 'library' && second === 'assets' && pathId) {
    const id = decodeAssetId(pathId)
    if (id) return { kind: 'asset', assetId: id }
  }
  return { kind: 'not-found' }
}

export function routePath(route: Exclude<Route, { kind: 'not-found' }>) {
  if (route.kind === 'workspace') return `/${route.workspace}`
  if (route.kind === 'asset')
    return `/library/assets/${encodeURIComponent(route.assetId)}`
  return `/process?sourceAssetId=${encodeURIComponent(route.sourceAssetId)}`
}

export const routeWithProjection = routePath

export function routeWorkspace(route: Route): Workspace | undefined {
  if (route.kind === 'workspace') return route.workspace
  if (route.kind === 'asset') return 'library'
  if (route.kind === 'process-source') return 'process'
}
