import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const SEESTAR_PEM_PATH_ENV_VAR = 'SEESTAR_PEM_PATH'
export const LEGACY_SEESTAR_PEM_ENV_VAR = 'SEESTAR_PEM'

const PEM_FILENAME = 'seestar_3.1.2_fw_7.32_interop.pem'
const WORKSPACE_ROOT = resolve(__dirname, '../..')
const DEFAULT_PEM_CANDIDATES = [
  resolve(WORKSPACE_ROOT, PEM_FILENAME),
  resolve(WORKSPACE_ROOT, 'apps/desktop', PEM_FILENAME),
]

export type ResolveSeestarPemPathOptions = {
  explicitPath?: string
  fallbackCandidates?: string[]
  env?: NodeJS.ProcessEnv
}

export function readSeestarPemPathFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const preferred = normalizePathInput(env[SEESTAR_PEM_PATH_ENV_VAR])
  if (preferred) {
    return preferred
  }

  return normalizePathInput(env[LEGACY_SEESTAR_PEM_ENV_VAR])
}

export function resolveSeestarPemPath(
  options: ResolveSeestarPemPathOptions = {},
): string {
  const explicitPath = normalizePathInput(options.explicitPath)
  if (explicitPath) {
    return resolve(explicitPath)
  }

  const fromEnv = readSeestarPemPathFromEnv(options.env)
  if (fromEnv) {
    return resolve(fromEnv)
  }

  const candidates = (options.fallbackCandidates ?? DEFAULT_PEM_CANDIDATES).map(
    (candidate) => resolve(candidate),
  )
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0] ?? resolve('seestar_3.1.2_fw_7.32_interop.pem')
}

function normalizePathInput(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
