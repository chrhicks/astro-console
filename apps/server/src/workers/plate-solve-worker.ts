import { execFile } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  AcquireActiveWork,
  AssetId,
  AttemptId,
  PointingSolveResult,
  recordSolveCompletion,
} from '@astro-console/v2-contracts'
import { acquireSqliteRepository } from '../persistence/acquire-sqlite-repository.ts'

const maxSourceBytes = 320 * 1024 * 1024
const maxDiagnosticBytes = 2_000
const maxProcessOutputBytes = 128 * 1024

export type PlateSolveExecutor = (input: {
  readonly executable: string
  readonly args: readonly string[]
  readonly timeoutMs: number
}) => Promise<{
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}>

export type PlateSolveWorkerConfig = {
  readonly originalsRoot: string
  readonly executable: string
  readonly indexesRoot: string
  readonly timeoutMs: number
  readonly solverVersion: string
  readonly scaleLowDeg: number
  readonly scaleHighDeg: number
  readonly searchRadiusDeg: number
  readonly execute?: PlateSolveExecutor
}

export type PlateSolveWorkerResult =
  | {
      readonly outcome: 'recorded'
      readonly result: 'Solved' | 'NoSolution'
      readonly cursor: number
    }
  | {
      readonly outcome: 'rejected'
      readonly reason:
        | 'SourceUnavailable'
        | 'SourceHintsUnavailable'
        | 'SolveNotExpected'
    }

/** A local image-evidence worker. It has no mount-provider dependency. */
export function createPlateSolveWorker(
  database: DatabaseSync,
  config: PlateSolveWorkerConfig,
) {
  const execute = config.execute ?? executeSolveField
  return {
    solve: async (assetId: string): Promise<PlateSolveWorkerResult> => {
      const run = database
        .prepare('SELECT run_id FROM acquire_sessions ORDER BY rowid DESC LIMIT 1')
        .get() as { run_id: string } | undefined
      const repository = acquireSqliteRepository(database)
      const session = run === undefined ? undefined : repository.current(run.run_id)
      if (
        session === undefined ||
        session.acquisitionMethod !== 'deepSkyPlateSolve' ||
        !AcquireActiveWork.guards.SolveRequested(session.activeWork)
      )
        return { outcome: 'rejected', reason: 'SolveNotExpected' }
      const source = sourcePath(database, config.originalsRoot, assetId)
      if (source === undefined)
        return { outcome: 'rejected', reason: 'SourceUnavailable' }
      if (source.hints === undefined)
        return { outcome: 'rejected', reason: 'SourceHintsUnavailable' }

      const attemptId = session.activeWork.attemptId
      const startedAtEpochMs = Date.now()
      const scratch = join(tmpdir(), `astro-plate-solve-${attemptId}`)
      const astrometryConfig = join(scratch, 'astrometry.cfg')
      const args = [
        '--config',
        astrometryConfig,
        '--dir',
        scratch,
        '--no-plots',
        '--overwrite',
        '--cpulimit',
        String(Math.ceil(config.timeoutMs / 1_000)),
        '--scale-units',
        'degwidth',
        '--scale-low',
        String(config.scaleLowDeg),
        '--scale-high',
        String(config.scaleHighDeg),
        '--ra',
        String(source.hints.rightAscensionDegrees),
        '--dec',
        String(source.hints.declinationDegrees),
        '--radius',
        String(config.searchRadiusDeg),
        source.path,
      ]
      let execution: Awaited<ReturnType<PlateSolveExecutor>>
      try {
        mkdirSync(scratch, { recursive: true })
        writeFileSync(
          astrometryConfig,
          `add_path ${config.indexesRoot}\nautoindex\n`,
        )
        execution = await execute({
          executable: config.executable,
          args,
          timeoutMs: config.timeoutMs,
        })
      } catch {
        execution = { exitCode: -1, stdout: '', stderr: 'solver process failed' }
      }
      const result = decodeSolveResult(execution)
      database
        .prepare(
          'INSERT OR REPLACE INTO plate_solve_runs (attempt_id,source_asset_id,evidence) VALUES (?,?,?)',
        )
        .run(
          attemptId,
          assetId,
          JSON.stringify({
            sourceAssetId: assetId,
            solverId: 'astrometry.net',
            solverVersion: config.solverVersion,
            arguments: {
              timeoutSeconds: Math.ceil(config.timeoutMs / 1_000),
              indexSet: basename(config.indexesRoot),
              mode: 'solve-field-no-plots',
              scaleLowDeg: config.scaleLowDeg,
              scaleHighDeg: config.scaleHighDeg,
              searchRadiusDeg: config.searchRadiusDeg,
              sourceRaDegrees: source.hints.rightAscensionDegrees,
              sourceDecDegrees: source.hints.declinationDegrees,
            },
            startedAtEpochMs,
            exitCode: execution.exitCode,
            stdout: safeDiagnostic(execution.stdout),
            stderr: safeDiagnostic(execution.stderr),
            result,
          }),
        )
      const decision = recordSolveCompletion(session, {
        attemptId,
        sourceFrameAssetId: AssetId.make(assetId),
        capturedAtEpochMs: startedAtEpochMs,
        solverId: 'astrometry.net',
        solverVersion: config.solverVersion,
        result,
        nextAttemptId: AttemptId.make(`${attemptId}-retry`),
        correctionAttemptId: AttemptId.make(`${attemptId}-correction`),
        proposalId: `${attemptId}-proposal`,
        proposalExpiresAtEpochMs: startedAtEpochMs + 60_000,
      })
      if (!('session' in decision))
        return { outcome: 'rejected', reason: 'SolveNotExpected' }
      const cursor = repository.commit(
        decision.session,
        'PlateSolveEvidenceRecorded',
      ).cursor
      return {
        outcome: 'recorded',
        result: PointingSolveResult.guards.Solved(result)
          ? 'Solved'
          : 'NoSolution',
        cursor,
      }
    },
  }
}

function sourcePath(database: DatabaseSync, originalsRoot: string, assetId: string) {
  const asset = database
    .prepare(
      'SELECT asset_id,role,format,availability FROM library_assets WHERE asset_id=?',
    )
    .get(assetId) as
    | { asset_id: string; role: string; format: string; availability: string }
    | undefined
  if (
    asset === undefined ||
    asset.asset_id !== assetId ||
    asset.role !== 'original' ||
    asset.format !== 'fits' ||
    asset.availability !== 'availableLocally' ||
    !/^asset-capture-[a-z0-9-]{1,96}$/.test(assetId)
  )
    return undefined
  const root = resolve(originalsRoot)
  const path = resolve(root, `${assetId}.fits`)
  if (relative(root, path).startsWith('..') || basename(path) !== `${assetId}.fits`)
    return undefined
  try {
    const size = statSync(path).size
    if (size <= 0 || size > maxSourceBytes) return undefined
    return { path, hints: fitsHints(readFitsPrefix(path)) }
  } catch {
    return undefined
  }
}

function readFitsPrefix(path: string) {
  const descriptor = openSync(path, 'r')
  try {
    const bytes = Buffer.alloc(64 * 1024)
    return bytes.subarray(0, readSync(descriptor, bytes))
  } finally {
    closeSync(descriptor)
  }
}

function fitsHints(bytes: Uint8Array) {
  const text = new TextDecoder('ascii').decode(bytes)
  const facts: Record<string, number> = {}
  for (let offset = 0; offset + 80 <= text.length; offset += 80) {
    const card = text.slice(offset, offset + 80)
    const key = card.slice(0, 8).trim()
    if (key === 'END') break
    if ((key !== 'RA' && key !== 'DEC') || card[8] !== '=') continue
    const value = Number(card.slice(10, 80).split('/')[0]?.trim())
    if (Number.isFinite(value)) facts[key] = value
  }
  const rightAscensionDegrees = facts.RA
  const declinationDegrees = facts.DEC
  return rightAscensionDegrees === undefined || declinationDegrees === undefined
    ? undefined
    : { rightAscensionDegrees, declinationDegrees }
}

function decodeSolveResult(execution: Awaited<ReturnType<PlateSolveExecutor>>) {
  const text = `${execution.stdout}\n${execution.stderr}`.slice(
    0,
    maxProcessOutputBytes,
  )
  const center = /Field center:.*?\(([-+\d.]+),\s*([-+\d.]+)\)/i.exec(text)
  if (execution.exitCode === 0 && center !== null) {
    const rightAscensionDegrees = Number(center[1])
    const declinationDegrees = Number(center[2])
    if (Number.isFinite(rightAscensionDegrees) && Number.isFinite(declinationDegrees))
      return PointingSolveResult.cases.Solved.make({
        desiredCenter: { rightAscensionDegrees, declinationDegrees },
        solvedCenter: { rightAscensionDegrees, declinationDegrees },
        correction: {
          rightAscensionArcsec: 0,
          declinationArcsec: 0,
          convention: 'mountRaDec',
        },
        uncertaintyArcsec: 0,
      })
  }
  return PointingSolveResult.cases.NoSolution.make({
    category: execution.exitCode === 0 || execution.exitCode === 1
      ? 'no-solution'
      : 'solver-failure',
    retryable: execution.exitCode !== 0 && execution.exitCode !== 1,
    diagnosticRef: `astrometry:${execution.exitCode}:${safeDiagnostic(text)}`,
  })
}

function safeDiagnostic(value: string) {
  return (
    value
      .replace(/\/[A-Za-z0-9_./-]+/g, '[path]')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[^\x20-\x7e]/g, '?')
      .slice(0, 240) || 'none'
  )
}

function executeSolveField(input: Parameters<PlateSolveExecutor>[0]) {
  return new Promise<Awaited<ReturnType<PlateSolveExecutor>>>((resolve) => {
    execFile(
      input.executable,
      [...input.args],
      { timeout: input.timeoutMs, maxBuffer: maxProcessOutputBytes },
      (error, stdout, stderr) =>
        resolve({
          exitCode:
            error === null ? 0 : typeof error.code === 'number' ? error.code : -1,
          stdout,
          stderr,
        }),
    )
  })
}
