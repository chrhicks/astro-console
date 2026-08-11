import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import { AssetId, AttemptId } from '@astro-console/protocol'
import {
  AcquireActiveWork,
  PointingSolveResult,
  recordSolveCompletion,
} from '../services/acquire-domain.ts'
import { acquireSqliteRepository } from '../persistence/acquire-sqlite-repository.ts'

const maxSourceBytes = 320 * 1024 * 1024
const maxProcessOutputBytes = 128 * 1024
const RunRow = Schema.Struct({ run_id: Schema.String })
const AssetRow = Schema.Struct({
  asset_id: Schema.String,
  role: Schema.String,
  format: Schema.String,
  availability: Schema.String,
  captured_at: Schema.String,
})
const StateValueRow = Schema.Struct({ value: Schema.String })
const DefinitionValueRow = Schema.Struct({ definition: Schema.String })
const ActiveRun = Schema.Struct({
  id: Schema.String,
  sourceDefinitionId: Schema.optionalKey(Schema.String),
  activeSequenceIndex: Schema.optionalKey(Schema.Int),
})
const TargetDefinition = Schema.Struct({
  definition: Schema.Struct({
    sequences: Schema.Array(
      Schema.Struct({
        rightAscensionHours: Schema.Number,
        declinationDegrees: Schema.Number,
      }),
    ),
  }),
})

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
        | 'SourceFormatUnsupported'
        | 'SolveNotExpected'
    }

export type PlateSolveEvidence = {
  readonly sourceFrameAssetId: typeof AssetId.Type
  readonly capturedAtEpochMs: number
  readonly solverId: string
  readonly solverVersion: string
  readonly result: typeof PointingSolveResult.Type
}

export type PlateSolveEvidenceResult =
  | { readonly outcome: 'solved'; readonly evidence: PlateSolveEvidence }
  | Extract<PlateSolveWorkerResult, { readonly outcome: 'rejected' }>

/** A local image-evidence worker. It has no mount-provider dependency. */
export function createPlateSolveWorker(
  database: DatabaseSync,
  config: PlateSolveWorkerConfig,
  observability: {
    readonly traceExecute?: <A>(run: () => Promise<A>) => Promise<A>
  } = {},
) {
  const execute = config.execute ?? executeSolveField
  const solveEvidence = async (
    assetId: string,
    expectedAttemptId?: string,
  ): Promise<PlateSolveEvidenceResult> => {
    const run = Schema.decodeUnknownSync(Schema.optional(RunRow))(
      database
        .prepare(
          'SELECT run_id FROM acquire_sessions ORDER BY rowid DESC LIMIT 1',
        )
        .get(),
    )
    const repository = acquireSqliteRepository(database)
    const session =
      run === undefined ? undefined : repository.current(run.run_id)
    if (
      session === undefined ||
      session.acquisitionMethod !== 'deepSkyPlateSolve' ||
      !AcquireActiveWork.guards.SolveRequested(session.activeWork) ||
      (expectedAttemptId !== undefined &&
        session.activeWork.attemptId !== expectedAttemptId)
    )
      return { outcome: 'rejected', reason: 'SolveNotExpected' }
    const target = acceptedTarget(database, session.runId)
    const source = sourceAsset(database, config.originalsRoot, assetId)
    if (source === undefined)
      return { outcome: 'rejected', reason: 'SourceUnavailable' }
    const hints = source.hints ?? target
    if (hints === undefined)
      return { outcome: 'rejected', reason: 'SourceHintsUnavailable' }

    const attemptId = session.activeWork.attemptId
    const startedAtEpochMs = Date.now()
    const scratch = join(tmpdir(), `astro-plate-solve-${attemptId}`)
    const astrometryConfig = join(scratch, 'astrometry.cfg')
    let solverInput: string
    try {
      mkdirSync(scratch, { recursive: true })
      solverInput = prepareSolverInput(source, scratch)
    } catch {
      return { outcome: 'rejected', reason: 'SourceFormatUnsupported' }
    }
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
      String(hints.rightAscensionDegrees),
      '--dec',
      String(hints.declinationDegrees),
      '--radius',
      String(config.searchRadiusDeg),
      solverInput,
    ]
    let execution: Awaited<ReturnType<PlateSolveExecutor>>
    try {
      writeFileSync(
        astrometryConfig,
        `add_path ${config.indexesRoot}\nautoindex\n`,
      )
      const run = () =>
        execute({
          executable: config.executable,
          args,
          timeoutMs: config.timeoutMs,
        })
      execution = await (observability.traceExecute === undefined
        ? run()
        : observability.traceExecute(run))
    } catch {
      execution = { exitCode: -1, stdout: '', stderr: 'solver process failed' }
    }
    const result = decodeSolveResult(execution, target ?? hints)
    const evidence: PlateSolveEvidence = {
      sourceFrameAssetId: AssetId.make(assetId),
      capturedAtEpochMs: Number.isFinite(Date.parse(source.capturedAt))
        ? Date.parse(source.capturedAt)
        : startedAtEpochMs,
      solverId: 'astrometry.net',
      solverVersion: config.solverVersion,
      result,
    }
    database
      .prepare(
        'INSERT OR REPLACE INTO plate_solve_runs (attempt_id,source_asset_id,evidence) VALUES (?,?,?)',
      )
      .run(
        attemptId,
        assetId,
        JSON.stringify({
          runId: session.runId,
          sourceAssetId: assetId,
          sourceChecksum: source.checksum,
          ...(source.pixelPayloadSha256 === undefined
            ? {}
            : { pixelPayloadSha256: source.pixelPayloadSha256 }),
          solverId: evidence.solverId,
          solverVersion: evidence.solverVersion,
          arguments: {
            timeoutSeconds: Math.ceil(config.timeoutMs / 1_000),
            indexSet: basename(config.indexesRoot),
            mode: 'solve-field-no-plots',
            sourceFormat: source.format,
            scaleLowDeg: config.scaleLowDeg,
            scaleHighDeg: config.scaleHighDeg,
            searchRadiusDeg: config.searchRadiusDeg,
            sourceRaDegrees: hints.rightAscensionDegrees,
            sourceDecDegrees: hints.declinationDegrees,
          },
          startedAtEpochMs,
          exitCode: execution.exitCode,
          stdout: safeDiagnostic(execution.stdout),
          stderr: safeDiagnostic(execution.stderr),
          result,
        }),
      )
    return { outcome: 'solved', evidence }
  }
  return {
    solveEvidence,
    solve: async (assetId: string): Promise<PlateSolveWorkerResult> => {
      const run = Schema.decodeUnknownSync(Schema.optional(RunRow))(
        database
          .prepare(
            'SELECT run_id FROM acquire_sessions ORDER BY rowid DESC LIMIT 1',
          )
          .get(),
      )
      const repository = acquireSqliteRepository(database)
      const session =
        run === undefined ? undefined : repository.current(run.run_id)
      if (
        session === undefined ||
        session.acquisitionMethod !== 'deepSkyPlateSolve' ||
        !AcquireActiveWork.guards.SolveRequested(session.activeWork)
      )
        return { outcome: 'rejected', reason: 'SolveNotExpected' }
      const attemptId = session.activeWork.attemptId
      const solved = await solveEvidence(assetId, attemptId)
      if (solved.outcome === 'rejected') return solved
      const evidence = solved.evidence
      const decision = recordSolveCompletion(session, {
        attemptId,
        ...evidence,
        nextAttemptId: AttemptId.make(`${attemptId}-retry`),
        correctionAttemptId: AttemptId.make(`${attemptId}-correction`),
        proposalId: `${attemptId}-proposal`,
        proposalExpiresAtEpochMs: Date.now() + 60_000,
      })
      if (!('session' in decision))
        return { outcome: 'rejected', reason: 'SolveNotExpected' }
      const cursor = repository.commit(
        decision.session,
        'PlateSolveEvidenceRecorded',
      ).cursor
      return {
        outcome: 'recorded',
        result: PointingSolveResult.guards.Solved(evidence.result)
          ? 'Solved'
          : 'NoSolution',
        cursor,
      }
    },
  }
}

function sourceAsset(
  database: DatabaseSync,
  originalsRoot: string,
  assetId: string,
) {
  const asset = Schema.decodeUnknownSync(Schema.optional(AssetRow))(
    database
      .prepare(
        'SELECT asset_id,role,format,availability,captured_at FROM library_assets WHERE asset_id=?',
      )
      .get(assetId),
  )
  if (
    asset === undefined ||
    asset.asset_id !== assetId ||
    asset.role !== 'original' ||
    (asset.format !== 'fits' && asset.format !== 'cameraRaw') ||
    asset.availability !== 'availableLocally' ||
    !/^asset-capture-[a-z0-9-]{1,96}$/.test(assetId)
  )
    return undefined
  const root = resolve(originalsRoot)
  const path = resolve(root, `${assetId}.${asset.format}`)
  if (
    relative(root, path).startsWith('..') ||
    basename(path) !== `${assetId}.${asset.format}`
  )
    return undefined
  try {
    const size = statSync(path).size
    if (size <= 0 || size > maxSourceBytes) return undefined
    const bytes = readFileSync(path)
    return {
      path,
      format: asset.format,
      capturedAt: asset.captured_at,
      checksum: createHash('sha256').update(bytes).digest('hex'),
      hints:
        asset.format === 'fits'
          ? fitsHints(bytes.subarray(0, 64 * 1024))
          : undefined,
      pixelPayloadSha256:
        asset.format === 'cameraRaw'
          ? imageBytesPixelChecksum(bytes)
          : undefined,
    }
  } catch {
    return undefined
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

function decodeSolveResult(
  execution: Awaited<ReturnType<PlateSolveExecutor>>,
  desiredCenter: {
    readonly rightAscensionDegrees: number
    readonly declinationDegrees: number
  },
) {
  const text = `${execution.stdout}\n${execution.stderr}`.slice(
    0,
    maxProcessOutputBytes,
  )
  const center = /Field center:.*?\(([-+\d.]+),\s*([-+\d.]+)\)/i.exec(text)
  if (execution.exitCode === 0 && center !== null) {
    const rightAscensionDegrees = Number(center[1])
    const declinationDegrees = Number(center[2])
    if (
      Number.isFinite(rightAscensionDegrees) &&
      Number.isFinite(declinationDegrees)
    )
      return PointingSolveResult.cases.Solved.make({
        desiredCenter,
        solvedCenter: { rightAscensionDegrees, declinationDegrees },
        correction: {
          rightAscensionArcsec:
            shortestDegrees(
              desiredCenter.rightAscensionDegrees - rightAscensionDegrees,
            ) *
            3_600 *
            Math.cos((desiredCenter.declinationDegrees * Math.PI) / 180),
          declinationArcsec:
            (desiredCenter.declinationDegrees - declinationDegrees) * 3_600,
          convention: 'mountRaDec',
        },
        uncertaintyArcsec: 0,
      })
  }
  return PointingSolveResult.cases.NoSolution.make({
    category:
      execution.exitCode === 0 || execution.exitCode === 1
        ? 'no-solution'
        : 'solver-failure',
    retryable: execution.exitCode !== 0 && execution.exitCode !== 1,
    diagnosticRef: `astrometry:${execution.exitCode}:${safeDiagnostic(text)}`,
  })
}

function acceptedTarget(database: DatabaseSync, runId: string) {
  const row = Schema.decodeUnknownSync(Schema.optional(StateValueRow))(
    database.prepare("SELECT value FROM state WHERE key='run'").get(),
  )
  if (row === undefined) return undefined
  const run = Schema.decodeUnknownSync(Schema.NullOr(ActiveRun))(
    JSON.parse(row.value),
  )
  if (
    run === null ||
    run.id !== runId ||
    typeof run.sourceDefinitionId !== 'string'
  )
    return undefined
  const stored = Schema.decodeUnknownSync(Schema.optional(DefinitionValueRow))(
    database
      .prepare(
        'SELECT definition FROM run_definitions WHERE run_definition_id=?',
      )
      .get(run.sourceDefinitionId),
  )
  if (stored === undefined) return undefined
  const decoded = Schema.decodeUnknownSync(TargetDefinition)(
    JSON.parse(stored.definition),
  )
  const sequence = decoded.definition.sequences[run.activeSequenceIndex ?? 0]
  if (sequence === undefined) return undefined
  return {
    rightAscensionDegrees: sequence.rightAscensionHours * 15,
    declinationDegrees: sequence.declinationDegrees,
  }
}

function prepareSolverInput(
  source: NonNullable<ReturnType<typeof sourceAsset>>,
  scratch: string,
) {
  if (source.format === 'fits') return source.path
  const path = join(scratch, 'retained-imagebytes.fits')
  writeFileSync(path, imageBytesToFits(readFileSync(source.path)))
  return path
}

function imageBytesPixelChecksum(bytes: Uint8Array) {
  if (bytes.byteLength < 44) throw new Error('ImageBytes header is truncated.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dataStart = view.getUint32(16, true)
  if (dataStart < 44 || dataStart > bytes.byteLength)
    throw new Error('ImageBytes data start is invalid.')
  return createHash('sha256').update(bytes.subarray(dataStart)).digest('hex')
}

function imageBytesToFits(bytes: Uint8Array) {
  if (bytes.byteLength < 44) throw new Error('ImageBytes header is truncated.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(0, true)
  const errorNumber = view.getUint32(4, true)
  const dataStart = view.getUint32(16, true)
  const transmissionType = view.getUint32(24, true)
  const rank = view.getUint32(28, true)
  const width = view.getUint32(32, true)
  const height = view.getUint32(36, true)
  if (
    version !== 1 ||
    errorNumber !== 0 ||
    transmissionType !== 8 ||
    rank !== 2 ||
    width <= 0 ||
    height <= 0 ||
    dataStart < 44 ||
    dataStart + width * height * 2 !== bytes.byteLength
  )
    throw new Error('ImageBytes cannot be converted to a 16-bit FITS input.')
  const cards = [
    fitsCard('SIMPLE', 'T'),
    fitsCard('BITPIX', '16'),
    fitsCard('NAXIS', '2'),
    fitsCard('NAXIS1', String(width)),
    fitsCard('NAXIS2', String(height)),
    fitsCard('BSCALE', '1'),
    fitsCard('BZERO', '32768'),
    'END'.padEnd(80, ' '),
  ].join('')
  const header = Buffer.alloc(Math.ceil(cards.length / 2_880) * 2_880, 32)
  header.write(cards, 0, 'ascii')
  const pixelBytes = width * height * 2
  const pixels = Buffer.alloc(Math.ceil(pixelBytes / 2_880) * 2_880)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const value = view.getUint16(dataStart + (x * height + y) * 2, true)
      pixels.writeInt16BE(value - 32_768, (y * width + x) * 2)
    }
  return Buffer.concat([header, pixels])
}

function fitsCard(key: string, value: string) {
  return `${key.padEnd(8, ' ')}= ${value.padStart(20, ' ')}`.padEnd(80, ' ')
}

function shortestDegrees(value: number) {
  return ((value + 540) % 360) - 180
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
            error === null
              ? 0
              : typeof error.code === 'number'
                ? error.code
                : -1,
          stdout,
          stderr,
        }),
    )
  })
}
