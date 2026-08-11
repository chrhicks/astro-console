import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'
import {
  ProcessingProjectWork,
  type ProcessingProjectMaterialization,
  type ProcessingProjectMaterializedEvidence,
} from '../services/processing-project-service.ts'

export type ProcessWorkKind = 'projectStage'
export type ProcessWorkStage = ProcessingProjectMaterialization['stage']

export type ProcessWorkPassResult =
  | { readonly outcome: 'idle' }
  | {
      readonly outcome: 'completed' | 'failed' | 'stale' | 'claimedUnresolved'
      readonly kind: ProcessWorkKind
    }

export const processWorkResultChangesProjection = (
  result: ProcessWorkPassResult,
) =>
  result.outcome === 'completed' ||
  result.outcome === 'failed' ||
  result.outcome === 'stale'

export type ProcessWorkTrace = (
  kind: ProcessWorkKind,
  stage: ProcessWorkStage,
  run: () => ProcessWorkPassResult,
) => ProcessWorkPassResult

export type ProcessBacklogObserver = (
  count: number,
  oldestAgeSeconds: number,
) => void
export type ProcessPressureObserver = (
  state: 'normal' | 'throttled' | 'paused',
) => void

export function createProcessWorkWorker(options: {
  readonly outputRoot: string
  readonly traceWork?: ProcessWorkTrace
  readonly observeBacklog?: ProcessBacklogObserver
  readonly observePressure?: ProcessPressureObserver
}) {
  mkdirSync(options.outputRoot, { recursive: true })

  const materialize = (
    request: ProcessingProjectMaterialization,
  ): ProcessingProjectMaterializedEvidence | undefined =>
    materializeEvidence(options.outputRoot, request)

  const pass = Effect.fn('ProcessWorkWorker.pass')(function* () {
    const work = yield* ProcessingProjectWork
    // Host pressure belongs to execution policy, not Project state. The first
    // Processing Project worker is local and serial, so it reports normal and
    // advances at most one durable attempt per pass.
    options.observePressure?.('normal')
    let selected: ProcessingProjectMaterialization | undefined
    const result = yield* work.advanceWork((request) => {
      selected = request
      return materialize(request)
    })
    options.observeBacklog?.(
      result.outcome === 'idle' ? 0 : result.backlog,
      result.outcome === 'idle' ? 0 : result.oldestAgeSeconds,
    )
    const projected: ProcessWorkPassResult =
      result.outcome === 'idle'
        ? { outcome: 'idle' }
        : { outcome: result.outcome, kind: result.kind }
    return selected === undefined || options.traceWork === undefined
      ? projected
      : options.traceWork('projectStage', selected.stage, () => projected)
  })

  return { pass }
}

function materializeEvidence(
  outputRoot: string,
  work: ProcessingProjectMaterialization,
): ProcessingProjectMaterializedEvidence | undefined {
  const path = join(
    outputRoot,
    `${digest(`${work.workId}:${work.stage}`)}.json`,
  )
  const bytes = JSON.stringify({
    adapter:
      work.stage === 'Develop'
        ? 'deterministic-develop-adapter-v1'
        : work.stage === 'Calibration'
          ? 'deterministic-calibration-adapter-v1'
          : work.stage === 'Registration'
            ? 'deterministic-registration-adapter-v1'
            : 'deterministic-stacking-adapter-v1',
    kind: 'projectStage',
    stage: work.stage,
    payloadDigest: digest(work.payload),
  })
  const temporaryPath = `${path}.tmp`
  if (!existsSync(path)) {
    if (existsSync(temporaryPath)) {
      if (readFileSync(temporaryPath, 'utf8') !== bytes) return undefined
    } else writeFileSync(temporaryPath, bytes, { flag: 'wx' })
    renameSync(temporaryPath, path)
  }
  if (readFileSync(path, 'utf8') !== bytes) return undefined
  return {
    path,
    checksum: `sha256:${digest(readFileSync(path))}`,
  }
}

function digest(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}
