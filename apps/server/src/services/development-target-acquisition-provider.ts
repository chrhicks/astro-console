import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Effect, Schema } from 'effect'
import type { DevelopmentSimulationConfig } from '../http/development-simulation.ts'
import {
  materializeCapturedFrame,
  type CapturedFrameStorage,
} from './captured-frame-intake.ts'
import {
  inspectCapturedFrame,
  type FrameInspectionStorage,
} from './frame-inspection.ts'
import type { TargetAcquisitionProviderShape } from './target-acquisition-service.ts'
import type { CameraProviderShape } from './camera-command-service.ts'
import {
  AcquireActiveWork,
  AcquireSession,
  CameraExposureObservation,
} from '@astro-console/v2-contracts'

type RecordedFrame = {
  readonly filename: string
  readonly pixelPayloadSha256: string
  readonly capturedAt: string
  readonly exposureSeconds: number
  readonly solvedCenter?: {
    readonly rightAscensionDegrees: number
    readonly declinationDegrees: number
  }
  readonly noSolution?: {
    readonly category: string
    readonly retryable: boolean
    readonly diagnosticRef: string
  }
}

const recordedFrames = {
  ngc7000Initial: {
    filename: 'ngc7000-first-light.fits',
    pixelPayloadSha256:
      '00c1ac20810456955dfb0cdf9f4632372b5a82b422e9328892168ae6c1bb843a',
    capturedAt: '2026-08-07T04:05:52.458Z',
    exposureSeconds: 120,
    solvedCenter: {
      rightAscensionDegrees: 314.549719973157,
      declinationDegrees: 44.1274205290256,
    },
  },
  ngc7000Verification: {
    filename: 'ngc7000-dithered-light.fits',
    pixelPayloadSha256:
      '8ca691238864ace5b13d98de3bbda96dcf9b536b75ee0415d8ed2c4d836708a3',
    capturedAt: '2026-08-07T04:18:48.362Z',
    exposureSeconds: 120,
    solvedCenter: {
      rightAscensionDegrees: 314.553878955801,
      declinationDegrees: 44.1274120130098,
    },
  },
  m101Clouded: {
    filename: 'm101-clouded-light.fits',
    pixelPayloadSha256:
      'df223788dda67982f75fc2ee4b1e48e3262fe1a3a889fd554ed225b5faf65ca8',
    capturedAt: '2026-06-22T02:59:31.277Z',
    exposureSeconds: 15,
    noSolution: {
      category: 'stars-insufficient',
      retryable: true,
      diagnosticRef: 'recorded-corpus:m101-clouded:no-solution',
    },
  },
  m101Recovery: {
    filename: 'm101-good-light.fits',
    pixelPayloadSha256:
      '7ec951193ca176c8683a1ddbafe41cdec2d378d6362cc376ffd5297f6d0a54cb',
    capturedAt: '2026-06-22T02:38:07.417Z',
    exposureSeconds: 15,
    solvedCenter: {
      rightAscensionDegrees: 210.799027433996,
      declinationDegrees: 54.3484963301173,
    },
  },
} satisfies Readonly<Record<string, RecordedFrame>>

const StoredValue = Schema.Struct({ value: Schema.String })
const StoredDefinition = Schema.Struct({ definition: Schema.String })
const SimulatedRun = Schema.Struct({
  id: Schema.String,
  sourceDefinitionId: Schema.String,
})
const SimulatedRunDefinition = Schema.Struct({
  definition: Schema.Struct({
    sequences: Schema.Array(
      Schema.Struct({
        sequenceId: Schema.String,
        targetName: Schema.String,
        rightAscensionHours: Schema.Number,
        declinationDegrees: Schema.Number,
      }),
    ),
    executionContext: Schema.Struct({
      rigId: Schema.String,
      cameraDeviceId: Schema.String,
    }),
  }),
})
const StoredWork = Schema.Struct({ state: Schema.String })
const StoredSession = Schema.Struct({ session: Schema.String })
const StoredSolve = Schema.Struct({ evidence: Schema.String })
const RecordedSolveBinding = Schema.Struct({
  pixelPayloadSha256: Schema.String,
  providerResult: Schema.Unknown,
})
const AlpacaEnvelope = Schema.Struct({
  Value: Schema.optionalKey(Schema.Unknown),
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})

export function developmentTargetAcquisitionProvider(options: {
  readonly database: DatabaseSync
  readonly simulation: DevelopmentSimulationConfig
  readonly capturedFrameStorage: CapturedFrameStorage
  readonly cameraProvider: CameraProviderShape
  readonly frameInspectionStorage?: FrameInspectionStorage
  readonly publish?: (type: string, cursor: number) => void
}): TargetAcquisitionProviderShape {
  return {
    capture: (_method, attemptId) =>
      Effect.tryPromise({
        try: async () => {
          const run = currentRun(options.database)
          const work = currentSolveWork(options.database, run.runId, attemptId)
          const prior = recordedProviderResult(options.database, attemptId)
          if (prior !== undefined) return prior
          const frame = recordedFrame(
            options.simulation.launchScenario,
            attemptId,
          )
          const slewAcknowledgement =
            work.purpose === 'initial'
              ? await initialSlew(options, run, attemptId, frame.capturedAt)
              : {
                  acknowledgedAtEpochMs: Date.parse(frame.capturedAt),
                  acknowledgementRef: `alpaca:pointing-retained:${attemptId}`,
                }
          const image = await captureImage(options, run.runId, attemptId, frame)
          if (image.pixelPayloadSha256 !== frame.pixelPayloadSha256)
            throw new Error(
              `Simulation evidence checksum mismatch for ${frame.filename}.`,
            )
          const solvedFrame = recordedFrameByPixelChecksum(
            image.pixelPayloadSha256,
          )
          const digest = createHash('sha256')
            .update(`${run.runId}:${attemptId}:${frame.pixelPayloadSha256}`)
            .digest('hex')
            .slice(0, 32)
          const assetId = `asset-capture-${digest}`
          const retained = materializeCapturedFrame(
            options.database,
            options.capturedFrameStorage,
            {
              assetId,
              frameId: `frame-${digest}`,
              capturedAt: frame.capturedAt,
              targetName: run.targetName,
              format: image.format,
              equipment: {
                rigId: run.rigId,
                cameraDeviceId: run.cameraDeviceId,
              },
              capture: {
                exposureSeconds: frame.exposureSeconds,
                filter: 'No filter',
                binning: 1,
                frameType: 'light',
              },
              lineage: {
                runId: run.runId,
                sequenceId: run.sequenceId,
                acquisitionId: attemptId,
              },
              idempotencyKey: `simulation-acquire:${run.runId}:${attemptId}`,
            },
            image.bytes,
          )
          if (retained.outcome !== 'accepted')
            throw new Error('Simulation acquisition evidence was not retained.')
          options.publish?.('CapturedFrameMaterialized', retained.cursor)
          if (options.frameInspectionStorage !== undefined) {
            const inspection = await Effect.runPromise(
              inspectCapturedFrame(
                options.database,
                options.frameInspectionStorage,
                assetId,
              ),
            )
            options.publish?.('FrameInspectionUpdated', inspection.cursor)
          }
          const result = {
            _tag: 'Captured' as const,
            slewAcknowledgement,
            evidence: {
              sourceFrameAssetId: assetId,
              capturedAtEpochMs: Date.parse(frame.capturedAt),
              solverId: 'recorded-local-solve',
              solverVersion: 'corpus-v1',
              result:
                solvedFrame.noSolution !== undefined
                  ? { _tag: 'NoSolution' as const, ...solvedFrame.noSolution }
                  : solvedResult(run, solvedFrame),
            },
          }
          options.database
            .prepare(
              'INSERT OR REPLACE INTO plate_solve_runs (attempt_id,source_asset_id,evidence) VALUES (?,?,?)',
            )
            .run(
              attemptId,
              assetId,
              JSON.stringify({
                pixelPayloadSha256: image.pixelPayloadSha256,
                providerResult: result,
              }),
            )
          settleWork(
            options.database,
            `${run.runId}:${attemptId}:exposure`,
            'completed',
          )
          return result
        },
        catch: (cause) => cause,
      }),
    correct: (correctionAttemptId, correction) =>
      Effect.tryPromise({
        try: async () => {
          const run = currentRun(options.database)
          const effectId = `${run.runId}:${correctionAttemptId}:correction`
          const claim = claimWork(options.database, effectId)
          if (claim === 'unknown')
            throw new Error(
              'The pointing correction outcome needs reconciliation; it will not replay.',
            )
          if (claim === 'new') {
            const current = await telescopeCoordinates(options.simulation)
            const declinationDegrees =
              current.declinationDegrees + correction.declinationArcsec / 3_600
            const cosine = Math.cos(
              (current.declinationDegrees * Math.PI) / 180,
            )
            const rightAscensionHours =
              current.rightAscensionHours +
              correction.rightAscensionArcsec / cosine / 3_600 / 15
            await slewToCoordinates(
              options.simulation,
              rightAscensionHours,
              declinationDegrees,
            )
            settleWork(options.database, effectId, 'completed')
          }
          return {
            _tag: 'Accepted' as const,
            acknowledgedAtEpochMs: Date.now(),
            acknowledgementRef: `alpaca:slewtocoordinatesasync:${correctionAttemptId}`,
          }
        },
        catch: (cause) => cause,
      }),
  }
}

async function initialSlew(
  options: Parameters<typeof developmentTargetAcquisitionProvider>[0],
  run: ReturnType<typeof currentRun>,
  attemptId: string,
  capturedAt: string,
) {
  const effectId = `${run.runId}:${attemptId}:slew`
  const claim = claimWork(options.database, effectId)
  if (claim === 'unknown')
    throw new Error(
      'The target slew outcome needs reconciliation; it will not replay.',
    )
  if (claim === 'new') {
    await slewToCoordinates(
      options.simulation,
      run.rightAscensionHours,
      run.declinationDegrees,
    )
    settleWork(options.database, effectId, 'completed')
  }
  return {
    acknowledgedAtEpochMs: Date.parse(capturedAt),
    acknowledgementRef: `alpaca:slewtocoordinatesasync:${attemptId}`,
  }
}

async function captureImage(
  options: Parameters<typeof developmentTargetAcquisitionProvider>[0],
  runId: string,
  attemptId: string,
  frame: RecordedFrame,
) {
  const effectId = `${runId}:${attemptId}:exposure`
  const inserted = options.database
    .prepare(
      "INSERT OR IGNORE INTO acquire_work (attempt_id,state) VALUES (?,'claimed')",
    )
    .run(effectId).changes
  if (inserted === 1) {
    const started = await Effect.runPromise(
      options.cameraProvider.startExposure(frame.exposureSeconds),
    )
    if (started !== undefined && 'summary' in started)
      throw new Error(started.summary)
    settleWork(options.database, effectId, 'acknowledged')
  } else {
    const state = workState(options.database, effectId)
    if (state !== 'acknowledged')
      throw new Error(
        'The target exposure outcome needs reconciliation; it will not replay.',
      )
  }
  let ready = false
  for (let poll = 0; poll < Math.ceil(frame.exposureSeconds) + 5; poll += 1) {
    const observation = Schema.decodeUnknownSync(CameraExposureObservation)(
      await Effect.runPromise(options.cameraProvider.readState()),
    )
    if (observation.cameraState === 'idle') {
      ready = true
      break
    }
  }
  if (!ready) throw new Error('The target exposure is not ready for retrieval.')
  const retrieval = options.database
    .prepare(
      "UPDATE acquire_work SET state='retrieving' WHERE attempt_id=? AND state='acknowledged'",
    )
    .run(effectId)
  if (retrieval.changes !== 1)
    throw new Error(
      'The target image retrieval is already claimed; it will not replay.',
    )
  const reader = options.cameraProvider.readImageArray
  if (reader === undefined)
    throw new Error('The simulated Alpaca camera has no image reader.')
  const image = await Effect.runPromise(reader())
  return {
    ...image,
    pixelPayloadSha256: createHash('sha256')
      .update(image.bytes.slice(44))
      .digest('hex'),
  }
}

function claimWork(database: DatabaseSync, effectId: string) {
  const inserted = database
    .prepare(
      "INSERT OR IGNORE INTO acquire_work (attempt_id,state) VALUES (?,'claimed')",
    )
    .run(effectId)
  if (inserted.changes === 1) return 'new' as const
  return workState(database, effectId) === 'completed'
    ? ('completed' as const)
    : ('unknown' as const)
}

function workState(database: DatabaseSync, effectId: string) {
  return Schema.decodeUnknownSync(StoredWork)(
    database
      .prepare('SELECT state FROM acquire_work WHERE attempt_id=?')
      .get(effectId),
  ).state
}

function settleWork(database: DatabaseSync, effectId: string, state: string) {
  database
    .prepare('UPDATE acquire_work SET state=? WHERE attempt_id=?')
    .run(state, effectId)
}

function recordedProviderResult(database: DatabaseSync, attemptId: string) {
  const row = Schema.decodeUnknownSync(Schema.optional(StoredSolve))(
    database
      .prepare('SELECT evidence FROM plate_solve_runs WHERE attempt_id=?')
      .get(attemptId),
  )
  if (row === undefined) return undefined
  return Schema.decodeUnknownSync(RecordedSolveBinding)(
    JSON.parse(row.evidence),
  ).providerResult
}

async function telescopeCoordinates(config: DevelopmentSimulationConfig) {
  const rightAscensionHours = await alpacaValue(
    `${config.origin}/api/v1/telescope/0/rightascension`,
  )
  const declinationDegrees = await alpacaValue(
    `${config.origin}/api/v1/telescope/0/declination`,
  )
  if (
    typeof rightAscensionHours !== 'number' ||
    typeof declinationDegrees !== 'number'
  )
    throw new Error('The simulated telescope coordinates are unavailable.')
  return { rightAscensionHours, declinationDegrees }
}

async function slewToCoordinates(
  config: DevelopmentSimulationConfig,
  rightAscensionHours: number,
  declinationDegrees: number,
) {
  const response = await fetch(
    `${config.origin}/api/v1/telescope/0/slewtocoordinatesasync`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({
        RightAscension: String(((rightAscensionHours % 24) + 24) % 24),
        Declination: String(declinationDegrees),
      }),
    },
  )
  const envelope = Schema.decodeUnknownSync(AlpacaEnvelope)(
    await response.json(),
  )
  if (!response.ok || envelope.ErrorNumber !== 0)
    throw new Error(
      envelope.ErrorMessage ?? 'The simulated telescope rejected the slew.',
    )
}

async function alpacaValue(url: string) {
  const response = await fetch(url)
  const envelope = Schema.decodeUnknownSync(AlpacaEnvelope)(
    await response.json(),
  )
  if (!response.ok || envelope.ErrorNumber !== 0)
    throw new Error(
      envelope.ErrorMessage ?? 'The simulated telescope read failed.',
    )
  return envelope.Value
}

function recordedFrame(scenario: string, attemptId: string): RecordedFrame {
  if (scenario === 'target-evidence-progression')
    return attemptId.includes('verification')
      ? recordedFrames.ngc7000Verification
      : recordedFrames.ngc7000Initial
  if (scenario === 'solve-success-no-solution')
    return attemptId.startsWith('recovery-solve')
      ? recordedFrames.m101Recovery
      : recordedFrames.m101Clouded
  throw new Error(`Scenario ${scenario} has no target-acquisition driver.`)
}

function recordedFrameByPixelChecksum(checksum: string): RecordedFrame {
  const frame = Object.values(recordedFrames).find(
    (candidate) => candidate.pixelPayloadSha256 === checksum,
  )
  if (frame === undefined)
    throw new Error('No recorded solve is bound to this pixel payload.')
  return frame
}

function solvedResult(
  run: ReturnType<typeof currentRun>,
  frame: RecordedFrame,
) {
  if (frame.solvedCenter === undefined)
    throw new Error('Recorded solved center is unavailable.')
  const desiredCenter = {
    rightAscensionDegrees: run.rightAscensionHours * 15,
    declinationDegrees: run.declinationDegrees,
  }
  const raDifference = shortestDegrees(
    desiredCenter.rightAscensionDegrees -
      frame.solvedCenter.rightAscensionDegrees,
  )
  return {
    _tag: 'Solved' as const,
    desiredCenter,
    solvedCenter: frame.solvedCenter,
    correction: {
      rightAscensionArcsec:
        raDifference *
        3_600 *
        Math.cos((desiredCenter.declinationDegrees * Math.PI) / 180),
      declinationArcsec:
        (desiredCenter.declinationDegrees -
          frame.solvedCenter.declinationDegrees) *
        3_600,
      convention: 'mountRaDec' as const,
    },
    uncertaintyArcsec: 1,
  }
}

function shortestDegrees(value: number) {
  return ((value + 540) % 360) - 180
}

function currentRun(database: DatabaseSync) {
  const row = Schema.decodeUnknownSync(StoredValue)(
    database.prepare("SELECT value FROM state WHERE key='run'").get(),
  )
  const run = Schema.decodeUnknownSync(SimulatedRun)(JSON.parse(row.value))
  const definitionRow = Schema.decodeUnknownSync(StoredDefinition)(
    database
      .prepare(
        'SELECT definition FROM run_definitions WHERE run_definition_id=?',
      )
      .get(run.sourceDefinitionId),
  )
  const stored = Schema.decodeUnknownSync(SimulatedRunDefinition)(
    JSON.parse(definitionRow.definition),
  )
  const sequence = stored.definition.sequences[0]
  const context = stored.definition.executionContext
  if (sequence === undefined)
    throw new Error('The simulated sequence definition is unavailable.')
  return {
    runId: run.id,
    sequenceId: sequence.sequenceId,
    targetName: sequence.targetName,
    rightAscensionHours: sequence.rightAscensionHours,
    declinationDegrees: sequence.declinationDegrees,
    rigId: context.rigId,
    cameraDeviceId: context.cameraDeviceId,
  }
}

function currentSolveWork(
  database: DatabaseSync,
  runId: string,
  attemptId: string,
) {
  const row = Schema.decodeUnknownSync(StoredSession)(
    database
      .prepare('SELECT session FROM acquire_sessions WHERE run_id=?')
      .get(runId),
  )
  const session = Schema.decodeUnknownSync(AcquireSession)(
    JSON.parse(row.session),
  )
  if (
    !AcquireActiveWork.guards.SolveRequested(session.activeWork) ||
    session.activeWork.attemptId !== attemptId
  )
    throw new Error(
      'The current target solve work does not match this capture.',
    )
  return session.activeWork
}
