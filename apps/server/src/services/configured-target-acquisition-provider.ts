import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Effect, Schema } from 'effect'
import {
  AcquireActiveWork,
  AcquireSession,
  CameraExposureObservation,
} from '@astro-console/v2-contracts'
import type { PreflightProviderConfig } from '../config/environment-config.ts'
import type { CameraProviderShape } from './camera-command-service.ts'
import {
  materializeCapturedFrame,
  type CapturedFrameStorage,
} from './captured-frame-intake.ts'
import {
  inspectCapturedFrame,
  type FrameInspectionStorage,
} from './frame-inspection.ts'
import type { TargetAcquisitionProviderShape } from './target-acquisition-service.ts'
import {
  createPlateSolveWorker,
  type PlateSolveWorkerConfig,
} from '../workers/plate-solve-worker.ts'

const AlpacaEnvelope = Schema.Struct({
  Value: Schema.optionalKey(Schema.Unknown),
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})
const WorkRow = Schema.Struct({
  kind: Schema.String,
  payload: Schema.String,
  state: Schema.String,
})
const SessionRow = Schema.Struct({ session: Schema.String })
const StateRow = Schema.Struct({ value: Schema.String })
const DefinitionRow = Schema.Struct({ definition: Schema.String })
const SolveRow = Schema.Struct({ evidence: Schema.String })
const RetainedReceipt = Schema.Struct({
  outcome: Schema.Literal('accepted'),
  assetId: Schema.String,
  checksum: Schema.String,
})
const RetainedReceiptRow = Schema.Struct({ response: Schema.String })
const RetainedEventRow = Schema.Struct({ checksum: Schema.String })
const RetainedAssetRow = Schema.Struct({
  format: Schema.Literals(['fits', 'cameraRaw']),
  availability: Schema.String,
})
const StoredRun = Schema.Struct({
  id: Schema.String,
  sourceDefinitionId: Schema.String,
  activeSequenceIndex: Schema.optionalKey(Schema.Int),
})
const StoredDefinition = Schema.Struct({
  definition: Schema.Struct({
    executionContext: Schema.Struct({
      rigId: Schema.String,
      cameraDeviceId: Schema.String,
      mountDeviceId: Schema.optionalKey(Schema.String),
      completionBehavior: Schema.String,
    }),
    sequences: Schema.Array(
      Schema.Struct({
        sequenceId: Schema.String,
        rightAscensionHours: Schema.Number,
        declinationDegrees: Schema.Number,
      }),
    ),
  }),
})
const ProviderResultBinding = Schema.Struct({
  runId: Schema.String,
  providerResult: Schema.Unknown,
})
const PointingPayload = Schema.Struct({
  rightAscensionHours: Schema.Number,
  declinationDegrees: Schema.Number,
})

type ConfiguredAlpacaTargetOptions = {
  readonly database: DatabaseSync
  readonly alpaca: PreflightProviderConfig
  readonly cameraProvider: CameraProviderShape
  readonly capturedFrameStorage: CapturedFrameStorage
  readonly plateSolveWorker: PlateSolveWorkerConfig
  readonly frameInspectionStorage?: FrameInspectionStorage
  readonly publish?: (type: string, cursor: number) => void
  readonly request?: typeof fetch
}

/** Configured live-shaped Acquire adapter. It has no park or filter-wheel path. */
export function configuredTargetAcquisitionProvider(
  options: ConfiguredAlpacaTargetOptions,
): TargetAcquisitionProviderShape {
  const request = options.request ?? fetch
  return {
    capture: (method, attemptId) =>
      Effect.tryPromise({
        try: async () => {
          if (method !== 'deepSkyPlateSolve')
            throw new Error(
              'Configured Acquire supports deep-sky solving only.',
            )
          const run = currentRun(options.database)
          assertConfiguredIdentity(run, options.alpaca)
          const work = currentSolveWork(options.database, run.runId, attemptId)
          const prior = recordedProviderResult(
            options.database,
            run.runId,
            attemptId,
          )
          if (prior !== undefined) return prior
          const slewAcknowledgement =
            work.purpose === 'initial'
              ? await pointAt(
                  options.database,
                  options.alpaca,
                  request,
                  `${run.runId}:${attemptId}:slew`,
                  {
                    rightAscensionHours: run.rightAscensionHours,
                    declinationDegrees: run.declinationDegrees,
                  },
                )
              : {
                  acknowledgedAtEpochMs: Date.now(),
                  acknowledgementRef: `alpaca:pointing-retained:${attemptId}`,
                }
          const parameters = solveParameters(
            options.database,
            run.runId,
            work.seriesId,
          )
          const retained = await captureAndRetain(
            options,
            run,
            attemptId,
            parameters.exposureSeconds,
            parameters.binning,
          )
          const solved = await createPlateSolveWorker(
            options.database,
            options.plateSolveWorker,
          ).solveEvidence(retained.assetId, attemptId)
          if (solved.outcome === 'rejected')
            throw new Error(
              `Local solve rejected the retained frame: ${solved.reason}.`,
            )
          const result = {
            _tag: 'Captured' as const,
            slewAcknowledgement,
            evidence: solved.evidence,
          }
          bindProviderResult(options.database, run.runId, attemptId, result)
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
          assertConfiguredIdentity(run, options.alpaca)
          const effectId = `${run.runId}:${correctionAttemptId}:correction`
          let row = storedWork(options.database, effectId)
          let allowWrite = false
          if (row === undefined) {
            const current = await telescopeObservation(options.alpaca, request)
            const cosine = Math.cos(
              (current.declinationDegrees * Math.PI) / 180,
            )
            if (Math.abs(cosine) < 0.01)
              throw new Error(
                'The correction is too close to the celestial pole.',
              )
            const target = {
              rightAscensionHours:
                current.rightAscensionHours +
                correction.rightAscensionArcsec / cosine / 3_600 / 15,
              declinationDegrees:
                current.declinationDegrees +
                correction.declinationArcsec / 3_600,
            }
            allowWrite = claimWork(
              options.database,
              effectId,
              'correction',
              target,
            ).new
            row = storedWork(options.database, effectId)
          }
          if (row === undefined || row.kind !== 'correction')
            throw new Error('The pointing correction claim is unavailable.')
          const target = Schema.decodeUnknownSync(PointingPayload)(
            JSON.parse(row.payload),
          )
          await executeOrReconcilePointing(
            options.database,
            options.alpaca,
            request,
            effectId,
            target,
            allowWrite,
          )
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

async function captureAndRetain(
  options: ConfiguredAlpacaTargetOptions,
  run: ReturnType<typeof currentRun>,
  attemptId: string,
  durationSeconds: number,
  binning: number,
) {
  const effectId = `${run.runId}:${attemptId}:exposure`
  const claim = claimWork(options.database, effectId, 'exposure', {
    durationSeconds,
  })
  let state = claim.state
  if (claim.new) {
    const outcome = await Effect.runPromise(
      options.cameraProvider.startExposure(durationSeconds),
    )
    if (outcome !== undefined && 'summary' in outcome)
      throw new Error(outcome.summary)
    settleWork(options.database, effectId, 'acknowledged')
    state = 'acknowledged'
  } else if (state === 'claimed') {
    const observation = await cameraObservation(options.cameraProvider)
    if (!activeCameraState(observation.cameraState))
      throw new Error(
        'The claimed exposure is not proven active; it will not replay.',
      )
    settleWork(options.database, effectId, 'observed')
    state = 'observed'
  }
  if (state === 'completed') {
    const retained = reconciledRetainedCapture(options, run.runId, attemptId)
    if (retained !== undefined) return retained
    throw new Error('Completed Acquire exposure has no retained original.')
  }
  if (state === 'retained') {
    const retained = reconciledRetainedCapture(options, run.runId, attemptId)
    if (retained !== undefined) return retained
    throw new Error('Retained Acquire work has no immutable original.')
  }
  if (state === 'retrieving') {
    const retained = reconciledRetainedCapture(options, run.runId, attemptId)
    if (retained !== undefined) {
      settleWork(options.database, effectId, 'retained')
      return retained
    }
    throw new Error(
      'The target image retrieval outcome needs reconciliation; it will not replay.',
    )
  }
  if (state === 'acknowledged') {
    let observedActive = false
    for (let poll = 0; poll < 24; poll += 1) {
      const observation = await cameraObservation(options.cameraProvider)
      if (activeCameraState(observation.cameraState)) {
        observedActive = true
        settleWork(options.database, effectId, 'observed')
        state = 'observed'
        break
      }
      await delay(100)
    }
    if (!observedActive)
      throw new Error(
        'The acknowledged exposure was not observed active; it will not replay.',
      )
  }
  if (state !== 'observed')
    throw new Error('The target exposure outcome needs reconciliation.')
  let ready = false
  for (let poll = 0; poll < Math.ceil(durationSeconds * 4) + 40; poll += 1) {
    const observation = await cameraObservation(options.cameraProvider)
    if (observation.cameraState === 'idle') {
      ready = true
      break
    }
    await delay(250)
  }
  if (!ready) throw new Error('The target exposure is not ready for retrieval.')
  const retrieval = options.database
    .prepare(
      "UPDATE configured_acquire_work SET state='retrieving' WHERE effect_id=? AND state='observed'",
    )
    .run(effectId)
  if (retrieval.changes !== 1)
    throw new Error('The target image retrieval is already claimed.')
  const reader = options.cameraProvider.readImageArray
  if (reader === undefined)
    throw new Error('The configured Alpaca camera has no image reader.')
  const image = await Effect.runPromise(reader())
  const identity = captureIdentity(run.runId, attemptId)
  const capturedAt = new Date().toISOString()
  const retained = materializeCapturedFrame(
    options.database,
    options.capturedFrameStorage,
    {
      ...identity,
      capturedAt,
      format: image.format,
      equipment: { rigId: run.rigId, cameraDeviceId: run.cameraDeviceId },
      capture: {
        exposureSeconds: durationSeconds,
        filter: 'No filter',
        binning,
        frameType: 'light',
      },
      lineage: {
        runId: run.runId,
        sequenceId: run.sequenceId,
        acquisitionId: attemptId,
      },
      idempotencyKey: `configured-acquire:${run.runId}:${attemptId}`,
    },
    image.bytes,
  )
  if (retained.outcome !== 'accepted')
    throw new Error('The configured Acquire frame was not retained.')
  options.publish?.('CapturedFrameMaterialized', retained.cursor)
  settleWork(options.database, effectId, 'retained')
  if (options.frameInspectionStorage !== undefined) {
    const inspection = await Effect.runPromise(
      inspectCapturedFrame(
        options.database,
        options.frameInspectionStorage,
        retained.assetId,
      ),
    )
    options.publish?.('FrameInspectionUpdated', inspection.cursor)
  }
  return { assetId: retained.assetId }
}

async function pointAt(
  database: DatabaseSync,
  config: PreflightProviderConfig,
  request: typeof fetch,
  effectId: string,
  target: typeof PointingPayload.Type,
) {
  const claim = claimWork(database, effectId, 'slew', target)
  await executeOrReconcilePointing(
    database,
    config,
    request,
    effectId,
    target,
    claim.new,
  )
  return {
    acknowledgedAtEpochMs: Date.now(),
    acknowledgementRef: `alpaca:slewtocoordinatesasync:${effectId}`,
  }
}

async function executeOrReconcilePointing(
  database: DatabaseSync,
  config: PreflightProviderConfig,
  request: typeof fetch,
  effectId: string,
  target: typeof PointingPayload.Type,
  allowWrite: boolean,
) {
  const work = storedWork(database, effectId)
  if (work === undefined) throw new Error('The pointing claim is unavailable.')
  if (work.state === 'completed') return
  if (work.state === 'claimed') {
    const observed = await telescopeObservation(config, request)
    if (pointingProven(observed, target)) {
      settleWork(database, effectId, 'completed')
      return
    }
    if (work.kind !== 'slew' && work.kind !== 'correction')
      throw new Error('The pointing claim kind is invalid.')
    if (work.state === 'claimed' && work.payload !== JSON.stringify(target))
      throw new Error(
        'The pointing claim does not match the requested coordinates.',
      )
    if (!allowWrite)
      return reconcileClaimedPointing(
        database,
        config,
        request,
        effectId,
        target,
      )
    await slewToCoordinates(config, request, target)
    settleWork(database, effectId, 'acknowledged')
  }
  for (let poll = 0; poll < 120; poll += 1) {
    const observed = await telescopeObservation(config, request)
    if (pointingProven(observed, target)) {
      settleWork(database, effectId, 'completed')
      return
    }
    await delay(250)
  }
  throw new Error(
    'The configured telescope did not prove the requested coordinates.',
  )
}

async function reconcileClaimedPointing(
  database: DatabaseSync,
  config: PreflightProviderConfig,
  request: typeof fetch,
  effectId: string,
  target: typeof PointingPayload.Type,
) {
  for (let poll = 0; poll < 120; poll += 1) {
    const observed = await telescopeObservation(config, request)
    if (pointingProven(observed, target)) {
      settleWork(database, effectId, 'completed')
      return
    }
    if (!observed.slewing)
      throw new Error(
        'The claimed pointing coordinates are not proven; the write will not replay.',
      )
    await delay(250)
  }
  throw new Error(
    'The claimed pointing movement did not settle at the requested coordinates.',
  )
}

function claimWork(
  database: DatabaseSync,
  effectId: string,
  kind: string,
  payload: unknown,
) {
  const encoded = JSON.stringify(payload)
  const inserted = database
    .prepare(
      "INSERT OR IGNORE INTO configured_acquire_work (effect_id,kind,payload,state) VALUES (?,?,?,'claimed')",
    )
    .run(effectId, kind, encoded)
  const row = storedWork(database, effectId)
  if (row === undefined || row.kind !== kind || row.payload !== encoded)
    throw new Error('The durable Acquire claim does not match this work.')
  return { new: inserted.changes === 1, state: row.state }
}

function storedWork(database: DatabaseSync, effectId: string) {
  return Schema.decodeUnknownSync(Schema.optional(WorkRow))(
    database
      .prepare(
        'SELECT kind,payload,state FROM configured_acquire_work WHERE effect_id=?',
      )
      .get(effectId),
  )
}

function settleWork(database: DatabaseSync, effectId: string, state: string) {
  database
    .prepare('UPDATE configured_acquire_work SET state=? WHERE effect_id=?')
    .run(state, effectId)
}

async function slewToCoordinates(
  config: PreflightProviderConfig,
  request: typeof fetch,
  target: typeof PointingPayload.Type,
) {
  const device = configuredTelescope(config)
  const response = await request(
    `http://${config.host}:${config.port}/api/v1/telescope/${device.deviceNumber}/slewtocoordinatesasync`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({
        RightAscension: String(normalizeHours(target.rightAscensionHours)),
        Declination: String(target.declinationDegrees),
      }),
    },
  )
  const envelope = Schema.decodeUnknownSync(AlpacaEnvelope)(
    await response.json(),
  )
  if (!response.ok || envelope.ErrorNumber !== 0)
    throw new Error(
      envelope.ErrorMessage ?? 'The configured telescope rejected the slew.',
    )
}

async function telescopeObservation(
  config: PreflightProviderConfig,
  request: typeof fetch,
) {
  const device = configuredTelescope(config)
  const base = `http://${config.host}:${config.port}/api/v1/telescope/${device.deviceNumber}`
  const [rightAscensionHours, declinationDegrees, slewing] = await Promise.all([
    alpacaValue(request, `${base}/rightascension`),
    alpacaValue(request, `${base}/declination`),
    alpacaValue(request, `${base}/slewing`),
  ])
  if (
    typeof rightAscensionHours !== 'number' ||
    typeof declinationDegrees !== 'number' ||
    typeof slewing !== 'boolean'
  )
    throw new Error('The configured telescope observation is invalid.')
  return { rightAscensionHours, declinationDegrees, slewing }
}

async function alpacaValue(request: typeof fetch, url: string) {
  const response = await request(url)
  const envelope = Schema.decodeUnknownSync(AlpacaEnvelope)(
    await response.json(),
  )
  if (!response.ok || envelope.ErrorNumber !== 0)
    throw new Error(
      envelope.ErrorMessage ?? 'The configured telescope read failed.',
    )
  return envelope.Value
}

function pointingProven(
  observed: Awaited<ReturnType<typeof telescopeObservation>>,
  target: typeof PointingPayload.Type,
) {
  if (observed.slewing) return false
  const declinationDifference =
    (observed.declinationDegrees - target.declinationDegrees) * 3_600
  const rightAscensionDifference =
    shortestHours(observed.rightAscensionHours - target.rightAscensionHours) *
    15 *
    3_600 *
    Math.cos((target.declinationDegrees * Math.PI) / 180)
  return Math.hypot(declinationDifference, rightAscensionDifference) <= 5
}

async function cameraObservation(camera: CameraProviderShape) {
  return Schema.decodeUnknownSync(CameraExposureObservation)(
    await Effect.runPromise(camera.readState()),
  )
}

function activeCameraState(state: string) {
  return (
    state === 'waiting' ||
    state === 'exposing' ||
    state === 'reading' ||
    state === 'download'
  )
}

function currentRun(database: DatabaseSync) {
  const row = Schema.decodeUnknownSync(StateRow)(
    database.prepare("SELECT value FROM state WHERE key='run'").get(),
  )
  const run = Schema.decodeUnknownSync(StoredRun)(JSON.parse(row.value))
  const stored = Schema.decodeUnknownSync(DefinitionRow)(
    database
      .prepare(
        'SELECT definition FROM run_definitions WHERE run_definition_id=?',
      )
      .get(run.sourceDefinitionId),
  )
  const definition = Schema.decodeUnknownSync(StoredDefinition)(
    JSON.parse(stored.definition),
  ).definition
  const sequence = definition.sequences[run.activeSequenceIndex ?? 0]
  if (sequence === undefined)
    throw new Error('The configured Acquire sequence is unavailable.')
  return {
    runId: run.id,
    sequenceId: sequence.sequenceId,
    rightAscensionHours: sequence.rightAscensionHours,
    declinationDegrees: sequence.declinationDegrees,
    rigId: definition.executionContext.rigId,
    cameraDeviceId: definition.executionContext.cameraDeviceId,
    mountDeviceId: definition.executionContext.mountDeviceId,
    completionBehavior: definition.executionContext.completionBehavior,
  }
}

function assertConfiguredIdentity(
  run: ReturnType<typeof currentRun>,
  config: PreflightProviderConfig,
) {
  const camera = config.devices.camera
  const telescope = config.devices.telescope
  if (
    run.completionBehavior !== 'hold' ||
    camera?.uniqueId === undefined ||
    telescope?.uniqueId === undefined ||
    run.rigId !== config.rigId ||
    run.cameraDeviceId !== camera.uniqueId ||
    run.mountDeviceId !== telescope.uniqueId
  )
    throw new Error(
      'The accepted run does not match the configured hold-only rig identities.',
    )
}

function configuredTelescope(config: PreflightProviderConfig) {
  const telescope = config.devices.telescope
  if (telescope?.uniqueId === undefined)
    throw new Error('Configured Acquire requires a telescope UniqueID.')
  return telescope
}

function currentSolveWork(
  database: DatabaseSync,
  runId: string,
  attemptId: string,
) {
  const row = Schema.decodeUnknownSync(SessionRow)(
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

function solveParameters(
  database: DatabaseSync,
  runId: string,
  seriesId: string,
) {
  const row = Schema.decodeUnknownSync(SessionRow)(
    database
      .prepare('SELECT session FROM acquire_sessions WHERE run_id=?')
      .get(runId),
  )
  const session = Schema.decodeUnknownSync(AcquireSession)(
    JSON.parse(row.session),
  )
  const series = session.solveSeries.find(
    (candidate) => candidate.seriesId === seriesId,
  )
  if (series === undefined) throw new Error('The solve series is unavailable.')
  return series.parameters
}

function bindProviderResult(
  database: DatabaseSync,
  runId: string,
  attemptId: string,
  providerResult: unknown,
) {
  const row = Schema.decodeUnknownSync(SolveRow)(
    database
      .prepare('SELECT evidence FROM plate_solve_runs WHERE attempt_id=?')
      .get(attemptId),
  )
  database
    .prepare('UPDATE plate_solve_runs SET evidence=? WHERE attempt_id=?')
    .run(
      JSON.stringify({ ...JSON.parse(row.evidence), runId, providerResult }),
      attemptId,
    )
}

function recordedProviderResult(
  database: DatabaseSync,
  runId: string,
  attemptId: string,
) {
  const row = Schema.decodeUnknownSync(Schema.optional(SolveRow))(
    database
      .prepare('SELECT evidence FROM plate_solve_runs WHERE attempt_id=?')
      .get(attemptId),
  )
  if (row === undefined) return undefined
  try {
    const binding = Schema.decodeUnknownSync(ProviderResultBinding)(
      JSON.parse(row.evidence),
    )
    return binding.runId === runId ? binding.providerResult : undefined
  } catch {
    return undefined
  }
}

function reconciledRetainedCapture(
  options: ConfiguredAlpacaTargetOptions,
  runId: string,
  attemptId: string,
) {
  const assetId = captureIdentity(runId, attemptId).assetId
  const receiptRow = Schema.decodeUnknownSync(
    Schema.optional(RetainedReceiptRow),
  )(
    options.database
      .prepare(
        'SELECT response FROM captured_frame_receipts WHERE idempotency_key=?',
      )
      .get(`configured-acquire:${runId}:${attemptId}`),
  )
  const event = Schema.decodeUnknownSync(Schema.optional(RetainedEventRow))(
    options.database
      .prepare('SELECT checksum FROM captured_frame_events WHERE asset_id=?')
      .get(assetId),
  )
  const asset = Schema.decodeUnknownSync(Schema.optional(RetainedAssetRow))(
    options.database
      .prepare(
        'SELECT format,availability FROM library_assets WHERE asset_id=?',
      )
      .get(assetId),
  )
  if (receiptRow === undefined || event === undefined || asset === undefined)
    return undefined
  let receipt: typeof RetainedReceipt.Type
  try {
    receipt = Schema.decodeUnknownSync(RetainedReceipt)(
      JSON.parse(receiptRow.response),
    )
  } catch {
    return undefined
  }
  if (
    receipt.assetId !== assetId ||
    receipt.checksum !== event.checksum ||
    asset.availability !== 'availableLocally'
  )
    return undefined
  try {
    const actual = createHash('sha256')
      .update(
        readFileSync(
          join(
            options.capturedFrameStorage.originalsRoot,
            `${assetId}.${asset.format}`,
          ),
        ),
      )
      .digest('hex')
    return actual === receipt.checksum ? { assetId } : undefined
  } catch {
    return undefined
  }
}

function captureIdentity(runId: string, attemptId: string) {
  const digest = createHash('sha256')
    .update(`${runId}:${attemptId}`)
    .digest('hex')
    .slice(0, 32)
  return { assetId: `asset-capture-${digest}`, frameId: `frame-${digest}` }
}

function normalizeHours(value: number) {
  return ((value % 24) + 24) % 24
}

function shortestHours(value: number) {
  return ((value + 36) % 24) - 12
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
