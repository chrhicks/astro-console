import assert from 'node:assert/strict'
import test from 'node:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import type { IncomingMessage } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { Cause, ConfigProvider, Effect, Exit, Schema } from 'effect'
import {
  AcquireSnapshot,
  AcquireSession,
  AcquireCommandResponse,
  BootstrapHttpSuccessEnvelope,
  BootstrapSseEventEnvelope,
  CommandHttpFailureEnvelope,
  CommandHttpSuccessEnvelope,
  DomainEvent,
  LibraryPage,
  ObserveCommandResponse,
  PlanCommandResponse,
  planSequencePresentation,
  ProcessSourceHandoff,
  OpenedProcessingProject,
  ProcessingProjectChanged,
  ProcessingProjectEvidence,
  PreflightSnapshot,
  RefreshPreflightResponse,
  RunSnapshot,
} from '@astro-console/v2-contracts'

const revisePlanSequence = <
  Sequence extends {
    readonly definition: Parameters<typeof planSequencePresentation>[0]
  },
>(
  sequence: Sequence,
  changes: Partial<Sequence['definition']>,
) => {
  const definition = { ...sequence.definition, ...changes }
  return {
    ...sequence,
    ...planSequencePresentation(definition),
    definition,
  }
}
import {
  createOriginAdmission,
  createLocalOwnerAdmission,
  createLocalWebService,
} from './app/origin-service.ts'
import {
  createJwksKeyResolver,
  createMembershipBootstrapResolver,
  createProductionAccessAdmission,
} from './auth/access-admission.ts'
import {
  DatabasePathNotAppOwned,
  openAppOwnedDatabase,
} from './persistence/database.ts'
import { originServerConfig } from './config/environment-config.ts'
import { alpacaPreflightProvider } from './providers/alpaca-preflight-provider.ts'
import { alpacaCameraProvider } from './providers/alpaca-camera-provider.ts'
import { materializeCapturedFrame } from './services/captured-frame-intake.ts'
import { createPlateSolveWorker } from './workers/plate-solve-worker.ts'

function createFixtureService(
  databasePath?: Parameters<typeof createLocalWebService>[0],
  identityResolver?: Parameters<typeof createLocalWebService>[1],
  unused?: Parameters<typeof createLocalWebService>[2],
  downloadGrants?: Parameters<typeof createLocalWebService>[3],
) {
  return createLocalWebService(
    databasePath,
    identityResolver,
    unused,
    downloadGrants,
    { fixture: 'm27' },
  )
}

async function bootstrapSnapshot(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const body: unknown = await response.json()
  return Schema.decodeUnknownSync(BootstrapHttpSuccessEnvelope)(body).data
}

function retainedFitsWithHints() {
  const card = (key: string, value: string) =>
    `${key.padEnd(8)}= ${value}`.padEnd(80, ' ')
  return new TextEncoder().encode(
    `${card('RA', '210.0')}${card('DEC', '54.0')}${'END'.padEnd(80, ' ')}`,
  )
}

function previewFits2x2() {
  const card = (key: string, value: string) =>
    `${key.padEnd(8)}= ${value}`.padEnd(80, ' ')
  const header = [
    card('SIMPLE', 'T'),
    card('BITPIX', '16'),
    card('NAXIS', '2'),
    card('NAXIS1', '2'),
    card('NAXIS2', '2'),
    card('BZERO', '32768'),
    'END'.padEnd(80, ' '),
  ].join('')
  const bytes = new Uint8Array(2888)
  bytes.set(new TextEncoder().encode(header.padEnd(2880, ' ')))
  const view = new DataView(bytes.buffer)
  ;[-32_768, -10_000, 10_000, 32_767].forEach((value, index) =>
    view.setInt16(2880 + index * 2, value, false),
  )
  return bytes
}

const capturedEquipment = {
  rigId: 'fixture-rig',
  cameraDeviceId: 'fixture-camera',
}

test('local plate solver records solved and no-solution evidence without a mount path', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-plate-solve-'))
  const databasePath = join(root, 'state.sqlite')
  const originalsRoot = join(root, 'originals')
  let calls = 0
  const service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    {
      fixture: 'target-deep-sky',
      capturedFrameStorage: { originalsRoot },
      plateSolveWorker: {
        originalsRoot,
        executable: '/usr/bin/solve-field',
        indexesRoot: '/home/chicks/.local/share/astrometry/indexes',
        timeoutMs: 45_000,
        solverVersion: '0.97',
        scaleLowDeg: 20,
        scaleHighDeg: 30,
        searchRadiusDeg: 15,
        execute: async ({ args }) => {
          calls += 1
          assert.deepEqual(args.slice(2, 8), [
            '--dir',
            args[3],
            '--no-plots',
            '--overwrite',
            '--cpulimit',
            '45',
          ])
          const backendConfigPath = args[1]
          assert.ok(backendConfigPath)
          assert.equal(
            readFileSync(backendConfigPath, 'utf8'),
            'add_path /home/chicks/.local/share/astrometry/indexes\nautoindex\n',
          )
          assert.deepEqual(args.slice(8, 20), [
            '--scale-units',
            'degwidth',
            '--scale-low',
            '20',
            '--scale-high',
            '30',
            '--ra',
            '210',
            '--dec',
            '54',
            '--radius',
            '15',
          ])
          return {
            exitCode: 0,
            stdout: `${'verbose solver output '.repeat(200)}Field center: (299.901, 22.721)`,
            stderr: '',
          }
        },
      },
    },
  )
  const intake = {
    assetId: 'asset-capture-plate-solve-001',
    frameId: 'plate-solve-001',
    capturedAt: '2026-08-05T10:00:00.000Z',
    format: 'fits' as const,
    equipment: capturedEquipment,
    capture: {
      exposureSeconds: 30,
      filter: 'L',
      binning: 1,
      frameType: 'light' as const,
    },
    lineage: {
      runId: 'run-m27',
      sequenceId: 'plate-solve',
      acquisitionId: 'plate-solve-001',
    },
    idempotencyKey: 'plate-solve-001',
  }
  assert.equal(
    service.ingestCapturedFrame(intake, retainedFitsWithHints()).outcome,
    'accepted',
  )
  const solved = await service.solveRetainedFrame(intake.assetId)
  assert.deepEqual(solved.outcome, 'recorded')
  if (solved.outcome !== 'recorded') throw new Error('solve was not recorded')
  assert.equal(solved.result, 'Solved')
  assert.equal(calls, 1)
  assert.equal(existsSync(join(originalsRoot, `${intake.assetId}.fits`)), true)
  const evidence = databaseRow(
    PlateSolveEvidenceRow,
    service.database.prepare('SELECT evidence FROM plate_solve_runs').get(),
  )
  assert.match(evidence.evidence, /astrometry.net/)
  assert.match(evidence.evidence, /asset-capture-plate-solve-001/)
  const session = databaseRow(
    AcquireSessionRow,
    service.database.prepare('SELECT session FROM acquire_sessions').get(),
  )
  assert.match(session.session, /SolveAttempt/)
  assert.doesNotMatch(session.session, /CorrectionAccepted/)

  service.close()
  const resumed = createLocalWebService(databasePath)
  t.after(() => resumed.close())
  assert.equal(
    databaseRow(
      PlateSolveEvidenceRow,
      resumed.database.prepare('SELECT evidence FROM plate_solve_runs').get(),
    ).evidence,
    evidence.evidence,
  )
  assert.equal(existsSync(join(originalsRoot, `${intake.assetId}.fits`)), true)
})

test('local plate solver records a bounded failure as typed no-solution and retains its source', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-plate-solve-failure-'))
  const originalsRoot = join(root, 'originals')
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    { fixture: 'target-deep-sky', capturedFrameStorage: { originalsRoot } },
  )
  t.after(() => service.close())
  const assetId = 'asset-capture-plate-solve-timeout'
  service.ingestCapturedFrame(
    {
      assetId,
      frameId: 'plate-solve-timeout',
      capturedAt: '2026-08-05T10:00:00.000Z',
      format: 'fits',
      equipment: capturedEquipment,
      capture: {
        exposureSeconds: 30,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: 'run-m27',
        sequenceId: 'plate-solve',
        acquisitionId: 'plate-timeout',
      },
      idempotencyKey: 'plate-solve-timeout',
    },
    retainedFitsWithHints(),
  )
  const outcome = await createPlateSolveWorker(service.database, {
    originalsRoot,
    executable: '/usr/bin/solve-field',
    indexesRoot: '/home/chicks/.local/share/astrometry/indexes',
    timeoutMs: 45_000,
    solverVersion: '0.97',
    scaleLowDeg: 20,
    scaleHighDeg: 30,
    searchRadiusDeg: 15,
    execute: async () => ({
      exitCode: -1,
      stdout: '',
      stderr: 'timed out after 45 seconds',
    }),
  }).solve(assetId)
  assert.equal(outcome.outcome, 'recorded')
  if (outcome.outcome !== 'recorded') throw new Error('solve was not recorded')
  assert.equal(outcome.result, 'NoSolution')
  assert.equal(existsSync(join(originalsRoot, `${assetId}.fits`)), true)
  const session = databaseRow(
    AcquireSessionRow,
    service.database.prepare('SELECT session FROM acquire_sessions').get(),
  )
  assert.match(session.session, /solver-failure/)
})

test('local plate solver records normal solve-field exit 1 as no-solution', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-plate-solve-none-'))
  const originalsRoot = join(root, 'originals')
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    { fixture: 'target-deep-sky', capturedFrameStorage: { originalsRoot } },
  )
  t.after(() => service.close())
  const assetId = 'asset-capture-plate-solve-none'
  service.ingestCapturedFrame(
    {
      assetId,
      frameId: 'plate-solve-none',
      capturedAt: '2026-08-05T10:00:00.000Z',
      format: 'fits',
      equipment: capturedEquipment,
      capture: {
        exposureSeconds: 30,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: 'run-m27',
        sequenceId: 'plate-solve',
        acquisitionId: 'plate-none',
      },
      idempotencyKey: 'plate-solve-none',
    },
    retainedFitsWithHints(),
  )
  const result = await createPlateSolveWorker(service.database, {
    originalsRoot,
    executable: '/usr/bin/solve-field',
    indexesRoot: '/home/chicks/.local/share/astrometry/indexes',
    timeoutMs: 90_000,
    solverVersion: '0.97',
    scaleLowDeg: 20,
    scaleHighDeg: 30,
    searchRadiusDeg: 15,
    execute: async () => ({ exitCode: 1, stdout: 'no match', stderr: '' }),
  }).solve(assetId)
  assert.equal(result.outcome, 'recorded')
  const session = databaseRow(
    AcquireSessionRow,
    service.database.prepare('SELECT session FROM acquire_sessions').get(),
  )
  assert.match(session.session, /no-solution/)
  assert.doesNotMatch(session.session, /solver-failure/)
})

test('materializes deterministic captured bytes as an immutable Library asset with restart, HTTP, and SSE projection', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-captured-frame-'))
  const databasePath = join(root, 'state.sqlite')
  const originalsRoot = join(root, 'originals')
  const previewsRoot = join(root, 'previews')
  const service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    {
      capturedFrameStorage: { originalsRoot },
      frameInspectionStorage: { originalsRoot, previewsRoot },
    },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  if (reader === undefined) throw new Error('SSE response has no body')
  await reader.read()
  const first = service.ingestCapturedFrame(
    {
      assetId: 'asset-capture-m27-001',
      frameId: 'frame-m27-001',
      capturedAt: '2026-08-04T01:02:03.000Z',
      format: 'fits',
      equipment: capturedEquipment,
      capture: {
        exposureSeconds: 180,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: 'run-capture-m27',
        sequenceId: 'sequence-l',
        acquisitionId: 'acquire-m27-001',
      },
      idempotencyKey: 'capture-m27-001',
    },
    previewFits2x2(),
  )
  assert.equal(first.outcome, 'accepted')
  if (first.outcome !== 'accepted')
    throw new Error('capture frame was rejected')
  assert.deepEqual(
    service.ingestCapturedFrame(
      {
        assetId: 'asset-capture-m27-001',
        frameId: 'frame-m27-001',
        capturedAt: '2026-08-04T01:02:03.000Z',
        format: 'fits',
        equipment: capturedEquipment,
        capture: {
          exposureSeconds: 180,
          filter: 'L',
          binning: 1,
          frameType: 'light',
        },
        lineage: {
          runId: 'run-capture-m27',
          sequenceId: 'sequence-l',
          acquisitionId: 'acquire-m27-001',
        },
        idempotencyKey: 'capture-m27-001',
      },
      previewFits2x2(),
    ),
    first,
  )
  const emitted = new TextDecoder().decode((await reader.read()).value)
  assert.match(emitted, /"eventCursor":1/)
  const inspected = service.inspectFrame('asset-capture-m27-001')
  assert.equal(inspected?.inspection._tag, 'Available')
  assert.equal(
    existsSync(join(previewsRoot, 'asset-capture-m27-001.png')),
    true,
  )
  const preview = await fetch(
    `${base}/api/library/assets/asset-capture-m27-001/preview`,
  )
  assert.equal(preview.status, 200)
  assert.equal(preview.headers.get('content-type'), 'image/png')
  assert.equal(preview.headers.get('cache-control'), 'private, no-store')
  assert.equal(preview.headers.get('x-astro-preview-max-bytes'), '65536')
  assert.equal(preview.headers.get('x-astro-preview-refresh-ms'), '1000')
  assert.equal(preview.headers.get('x-astro-preview-concurrent-limit'), '2')
  const repeatedPreview = await fetch(
    `${base}/api/library/assets/asset-capture-m27-001/preview`,
  )
  assert.equal(repeatedPreview.status, 429)
  assert.deepEqual(await repeatedPreview.json(), {
    outcome: 'rejected',
    reason: 'PreviewRefreshLimited',
  })
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare(
          "SELECT count(*) AS count FROM events WHERE type='FrameInspectionUpdated'",
        )
        .get(),
    ).count,
    1,
  )
  const detail = await fetch(
    `${base}/api/library/assets/asset-capture-m27-001`,
  ).then((response) => response.json())
  assert.deepEqual(detail.capture, {
    frameId: 'frame-m27-001',
    exposureSeconds: 180,
    filter: 'L',
    binning: 1,
    frameType: 'light',
  })
  assert.deepEqual(detail.equipment, capturedEquipment)
  assert.deepEqual(detail.lineage, {
    sourceAssetIds: [],
    runId: 'run-capture-m27',
    solveAttemptId: 'acquire-m27-001',
    sequenceId: 'sequence-l',
    acquisitionId: 'acquire-m27-001',
  })
  assert.equal(detail.inspection._tag, 'Available')
  assert.equal(
    detail.inspection.preview.provenance.algorithm,
    'bounded-pixel-preview-v1',
  )
  assert.deepEqual(
    [...readFileSync(join(originalsRoot, 'asset-capture-m27-001.fits'))],
    [...previewFits2x2()],
  )
  await reader.cancel()
  await listener.close()
  service.close()
  const recovered = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    {
      capturedFrameStorage: { originalsRoot },
      frameInspectionStorage: { originalsRoot, previewsRoot },
    },
  )
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const recoveredDetail = await fetch(
    `http://127.0.0.1:${recoveredListener.port}/api/library/assets/asset-capture-m27-001`,
  ).then((response) => response.json())
  assert.equal(recoveredDetail.assetId, 'asset-capture-m27-001')
  assert.equal(recoveredDetail.inspection._tag, 'Available')
})

test('records a checksum-backed captured-frame orphan when the SQLite transaction fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-captured-frame-orphan-'))
  const database = openAppOwnedDatabase(join(root, 'state.sqlite'), `${root}/`)
  database.exec(
    "CREATE TRIGGER reject_capture_event BEFORE INSERT ON captured_frame_events BEGIN SELECT RAISE(ABORT, 'forced capture intake failure'); END;",
  )
  const result = materializeCapturedFrame(
    database,
    { originalsRoot: join(root, 'originals') },
    {
      assetId: 'asset-capture-orphan-001',
      frameId: 'frame-orphan-001',
      capturedAt: '2026-08-04T01:02:03.000Z',
      format: 'fits',
      equipment: capturedEquipment,
      capture: {
        exposureSeconds: 180,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: 'run-capture-m27',
        sequenceId: 'sequence-l',
        acquisitionId: 'acquire-m27-001',
      },
      idempotencyKey: 'capture-orphan-001',
    },
    new TextEncoder().encode('orphaned-fits-bytes'),
  )
  assert.deepEqual(result, {
    outcome: 'rejected',
    reason: 'MaterializationFailed',
  })
  const orphan = databaseRow(
    Schema.Struct({ path: Schema.String, checksum: Schema.String }),
    database.prepare('SELECT path,checksum FROM captured_frame_orphans').get(),
  )
  assert.equal(existsSync(orphan.path), true)
  assert.match(orphan.checksum, /^[0-9a-f]{64}$/)
  assert.equal(
    databaseRow(
      CountRow,
      database.prepare('SELECT count(*) AS count FROM library_assets').get(),
    ).count,
    0,
  )
  database.close()
})

test('rejects and records a mismatched retained original without creating Library truth', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-captured-frame-mismatch-'))
  const database = openAppOwnedDatabase(join(root, 'state.sqlite'), `${root}/`)
  const originalsRoot = join(root, 'originals')
  mkdirSync(originalsRoot, { recursive: true })
  const finalPath = join(originalsRoot, 'asset-capture-mismatch-001.fits')
  const existingBytes = new TextEncoder().encode('different retained bytes')
  writeFileSync(finalPath, existingBytes)
  const result = materializeCapturedFrame(
    database,
    { originalsRoot },
    {
      assetId: 'asset-capture-mismatch-001',
      frameId: 'frame-mismatch-001',
      capturedAt: '2026-08-04T01:02:03.000Z',
      format: 'fits',
      equipment: capturedEquipment,
      capture: {
        exposureSeconds: 180,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: 'run-capture-m27',
        sequenceId: 'sequence-l',
        acquisitionId: 'acquire-m27-001',
      },
      idempotencyKey: 'capture-mismatch-001',
    },
    previewFits2x2(),
  )
  assert.deepEqual(result, {
    outcome: 'rejected',
    reason: 'MaterializationFailed',
  })
  assert.deepEqual([...readFileSync(finalPath)], [...existingBytes])
  assert.equal(
    databaseRow(
      CountRow,
      database
        .prepare(
          'SELECT count(*) AS count FROM captured_frame_orphans WHERE path=?',
        )
        .get(finalPath),
    ).count,
    1,
  )
  assert.equal(
    databaseRow(
      CountRow,
      database.prepare('SELECT count(*) AS count FROM library_assets').get(),
    ).count,
    0,
  )
  assert.equal(
    databaseRow(
      CountRow,
      database
        .prepare('SELECT count(*) AS count FROM captured_frame_receipts')
        .get(),
    ).count,
    0,
  )
  database.close()
})

test('Phase 4 deterministic chain carries one current captured frame through Library review and restart', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-phase-4-chain-'))
  const databasePath = join(root, 'state.sqlite')
  const originalsRoot = join(root, 'originals')
  const previewsRoot = join(root, 'previews')
  let service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    {
      fixture: 'live-frame',
      capturedFrameStorage: { originalsRoot },
      frameInspectionStorage: { originalsRoot, previewsRoot },
    },
  )
  let listener = await service.listen()
  let base = `http://127.0.0.1:${listener.port}`
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (
    initial.activeRun._tag !== 'Active' ||
    initial.observe?.acquire === undefined
  )
    throw new Error('Live-frame chain fixture is unavailable')
  const recorded = await submitPolar(base, {
    _tag: 'RecordLiveFrameEvidence',
    expectedLeaseRevision: initial.control.revision,
    expectedRunRevision: initial.activeRun.run.revision,
    expectedAcquireRevision: initial.observe.acquire.revision,
    idempotencyKey: 'phase-4-live-frame',
  })
  assert.equal(recorded.response.status, 200)
  const first = service.ingestCapturedFrame(
    {
      assetId: 'asset-capture-live-001',
      frameId: 'frame-live-001',
      capturedAt: '2026-08-04T01:02:03.000Z',
      format: 'fits',
      equipment: capturedEquipment,
      capture: {
        exposureSeconds: 180,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: initial.activeRun.run.runId,
        sequenceId: 'sequence-l',
        acquisitionId: 'acquire-live-001',
      },
      idempotencyKey: 'phase-4-capture-live',
    },
    previewFits2x2(),
  )
  assert.equal(first.outcome, 'accepted')
  assert.equal(
    service.inspectFrame('asset-capture-live-001')?.inspection._tag,
    'Available',
  )
  const asset = await fetch(
    `${base}/api/library/assets/asset-capture-live-001`,
  ).then((response) => response.json())
  assert.equal(asset.inspection._tag, 'Available')
  assert.equal(asset.inspection.rationale.decision, 'unreviewed')
  assert.match(asset.inspection.rationale.summary, /retained original pixels/i)
  const review = await fetch(
    `${base}/api/library/assets/asset-capture-live-001/review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedAssetRevision: asset.revision,
        expectedReviewRevision: 0,
        decision: 'accepted',
        idempotencyKey: 'phase-4-review-live',
      }),
    },
  ).then((response) => response.json())
  assert.equal(review.outcome, 'accepted')
  assert.equal(review.review.decision, 'accepted')
  const second = service.ingestCapturedFrame(
    {
      assetId: 'asset-capture-live-002',
      frameId: 'frame-live-002',
      capturedAt: '2026-08-04T01:02:04.000Z',
      format: 'fits',
      equipment: capturedEquipment,
      capture: {
        exposureSeconds: 180,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: initial.activeRun.run.runId,
        sequenceId: 'sequence-l',
        acquisitionId: 'acquire-live-002',
      },
      idempotencyKey: 'phase-4-capture-second',
    },
    new TextEncoder().encode('phase-4-second-fits-bytes'),
  )
  assert.equal(second.outcome, 'accepted')
  const firstPage = await fetch(
    `${base}/api/library?queryId=phase-4&pageSize=1&sort=capturedAtDescending`,
  ).then((response) => response.json())
  assert.equal(firstPage.results.length, 1)
  assert.equal(firstPage.nextCursor, '1')
  const secondPage = await fetch(
    `${base}/api/library?queryId=phase-4&cursor=1&pageSize=1&sort=capturedAtDescending`,
  ).then((response) => response.json())
  assert.equal(secondPage.results.length, 1)
  assert.notEqual(firstPage.results[0].assetId, secondPage.results[0].assetId)
  assert.equal(
    (
      await fetch(
        `${base}/api/library?queryId=phase-4&pageSize=101&sort=capturedAtDescending`,
      )
    ).status,
    400,
  )
  const currentReview = await fetch(`${base}/api/observe/live-frame`).then(
    (response) => response.json(),
  )
  assert.equal(currentReview._tag, 'Available')
  assert.equal(currentReview.asset.assetId, 'asset-capture-live-001')
  assert.equal(currentReview.asset.review.decision, 'accepted')
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  if (reader === undefined) throw new Error('SSE response has no body')
  const connected = new TextDecoder().decode((await reader.read()).value)
  assert.match(connected, /eventCursor/)
  await reader.cancel()
  await listener.close()
  service.close()
  service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    {
      capturedFrameStorage: { originalsRoot },
      frameInspectionStorage: { originalsRoot, previewsRoot },
    },
  )
  listener = await service.listen()
  base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const restartedReview = await fetch(`${base}/api/observe/live-frame`).then(
    (response) => response.json(),
  )
  assert.equal(restartedReview._tag, 'Available')
  assert.equal(restartedReview.asset.inspection._tag, 'Available')
  assert.equal(restartedReview.asset.review.decision, 'accepted')
  const reconnect = await fetch(`${base}/api/events`)
  const reconnectReader = reconnect.body?.getReader()
  if (reconnectReader === undefined)
    throw new Error('SSE reconnect has no body')
  assert.match(
    new TextDecoder().decode((await reconnectReader.read()).value),
    /eventCursor/,
  )
  await reconnectReader.cancel()
})

test('live-frame-library fixture exposes the available current review without a catalog request', async (t) => {
  const service = createLocalWebService(
    ':memory:',
    undefined,
    undefined,
    undefined,
    { fixture: 'live-frame-library' },
  )
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const review = await fetch(
    `http://127.0.0.1:${listener.port}/api/observe/live-frame`,
  ).then((response) => response.json())
  assert.equal(review._tag, 'Available')
  assert.equal(review.asset.assetId, 'asset-capture-live-001')
  assert.equal(review.asset.inspection._tag, 'Available')
  assert.equal(review.asset.review.decision, 'accepted')
})

test('persists truthful unavailable inspection state when a retained original is absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-inspection-unavailable-'))
  const originalsRoot = join(root, 'originals')
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    {
      capturedFrameStorage: { originalsRoot },
      frameInspectionStorage: {
        originalsRoot,
        previewsRoot: join(root, 'previews'),
      },
    },
  )
  const created = service.ingestCapturedFrame(
    {
      assetId: 'asset-capture-unavailable-001',
      frameId: 'frame-unavailable-001',
      capturedAt: '2026-08-04T01:02:03.000Z',
      format: 'fits',
      equipment: capturedEquipment,
      capture: {
        exposureSeconds: 180,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: 'run-capture-m27',
        sequenceId: 'sequence-l',
        acquisitionId: 'acquire-m27-001',
      },
      idempotencyKey: 'capture-unavailable-001',
    },
    new TextEncoder().encode('unavailable-fits-bytes'),
  )
  assert.equal(created.outcome, 'accepted')
  unlinkSync(join(originalsRoot, 'asset-capture-unavailable-001.fits'))
  assert.deepEqual(
    service.inspectFrame('asset-capture-unavailable-001')?.inspection,
    {
      _tag: 'Unavailable',
      summary: 'The immutable original is not available for inspection.',
    },
  )
  service.close()
})

test('persists truthful failed inspection state when a retained original changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-inspection-failed-'))
  const originalsRoot = join(root, 'originals')
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    {
      capturedFrameStorage: { originalsRoot },
      frameInspectionStorage: {
        originalsRoot,
        previewsRoot: join(root, 'previews'),
      },
    },
  )
  const created = service.ingestCapturedFrame(
    {
      assetId: 'asset-capture-failed-001',
      frameId: 'frame-failed-001',
      capturedAt: '2026-08-04T01:02:03.000Z',
      format: 'fits',
      equipment: capturedEquipment,
      capture: {
        exposureSeconds: 180,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: 'run-capture-m27',
        sequenceId: 'sequence-l',
        acquisitionId: 'acquire-m27-001',
      },
      idempotencyKey: 'capture-failed-001',
    },
    new TextEncoder().encode('original-fits-bytes'),
  )
  assert.equal(created.outcome, 'accepted')
  writeFileSync(
    join(originalsRoot, 'asset-capture-failed-001.fits'),
    'changed-fits-bytes',
  )
  assert.equal(
    service.inspectFrame('asset-capture-failed-001')?.inspection._tag,
    'Failed',
  )
  service.close()
})

test('Library review is owner-only, revision-guarded, idempotent, durable, and projected', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-library-review-'))
  const databasePath = join(root, 'state.sqlite')
  const service = createFixtureService(databasePath)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  if (reader === undefined) throw new Error('SSE response has no body')
  await reader.read()
  const asset = await fetch(`${base}/api/library/assets/asset-m27-001`).then(
    (response) => response.json(),
  )
  const request = {
    expectedAssetRevision: asset.revision,
    expectedReviewRevision: 0,
    decision: 'accepted',
    rating: 5,
    annotation: 'Keep this frame.',
    idempotencyKey: 'review-m27-001',
  }
  const accepted = await fetch(
    `${base}/api/library/assets/asset-m27-001/review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    },
  ).then((response) => response.json())
  assert.equal(accepted.outcome, 'accepted')
  const reviewEvent = new TextDecoder().decode((await reader.read()).value)
  assert.match(reviewEvent, /"eventCursor":1/)
  assert.deepEqual(
    await fetch(`${base}/api/library/assets/asset-m27-001/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }).then((response) => response.json()),
    accepted,
  )
  assert.equal(
    (
      await fetch(`${base}/api/library/assets/asset-m27-001/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...request,
          idempotencyKey: 'review-stale',
          expectedReviewRevision: 0,
          decision: 'rejected',
        }),
      })
    ).status,
    409,
  )
  const detail = await fetch(`${base}/api/library/assets/asset-m27-001`).then(
    (response) => response.json(),
  )
  assert.deepEqual(detail.review, accepted.review)
  const reviewedPage = Schema.decodeUnknownSync(LibraryPage)(
    await fetch(
      `${base}/api/library?queryId=review-summary&pageSize=3&sort=sharpestFirst`,
    ).then((response) => response.json()),
  )
  const reviewedSummary = reviewedPage.results.find(
    (summary) => summary.assetId === 'asset-m27-001',
  )
  assert.deepEqual(reviewedSummary?.review, {
    decision: 'accepted',
    rating: 5,
  })
  assert.equal('annotation' in (reviewedSummary?.review ?? {}), false)
  const viewer = createFixtureService(undefined, () => ({
    personId: 'viewer',
    clientId: 'viewer',
    role: 'viewer' as const,
    capability: 'readOnly' as const,
  }))
  const viewerListener = await viewer.listen()
  t.after(async () => {
    await viewerListener.close()
    viewer.close()
  })
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:${viewerListener.port}/api/library/assets/asset-m27-001/review`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        },
      )
    ).status,
    403,
  )
  await reader.cancel()
  await listener.close()
  service.close()
  const recovered = createFixtureService(databasePath)
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const recoveredDetail = await fetch(
    `http://127.0.0.1:${recoveredListener.port}/api/library/assets/asset-m27-001`,
  ).then((response) => response.json())
  assert.deepEqual(recoveredDetail.review, accepted.review)
})

test('bootstrap and bounded control transport decode shared contracts before mutation', async (t) => {
  const service = createFixtureService(undefined, () => ({
    personId: 'member',
    clientId: 'desktop-member',
    role: 'viewer' as const,
    capability: 'controlCapable' as const,
  }))
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const snapshot = Schema.decodeUnknownSync(BootstrapHttpSuccessEnvelope)(
    await fetch(`${base}/api/snapshot`).then((response) => response.json()),
  )
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.data.health.storage.state, 'unknown')
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  if (reader === undefined) throw new Error('SSE response has no body')
  const first = new TextDecoder().decode((await reader.read()).value)
  const id = first.match(/^id: (\d+)$/m)?.[1]
  const data = first.match(/^data: (.+)$/m)?.[1]
  if (id === undefined || data === undefined)
    throw new Error('SSE projection envelope is incomplete')
  const event = Schema.decodeUnknownSync(BootstrapSseEventEnvelope)({
    id: Number(id),
    event: 'ProjectionChanged',
    data: JSON.parse(data),
  })
  assert.equal(event.id, event.data.eventCursor)
  const before = databaseRow(
    CountRow,
    service.database.prepare('SELECT count(*) AS count FROM events').get(),
  ).count
  const malformed = Schema.decodeUnknownSync(CommandHttpFailureEnvelope)(
    await fetch(`${base}/api/commands/control`, {
      method: 'POST',
      body: JSON.stringify({ commandId: 'control-malformed' }),
    }).then((response) => response.json()),
  )
  assert.equal(malformed.failure._tag, 'InvalidInput')
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM events').get(),
    ).count,
    before,
  )
  const accepted = Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(
    await fetch(`${base}/api/commands/control`, {
      method: 'POST',
      body: JSON.stringify({
        commandId: 'control-request',
        command: {
          _tag: 'RequestControl',
          expectedLeaseRevision: 1,
          idempotencyKey: 'control-request',
        },
      }),
    }).then((response) => response.json()),
  )
  assert.equal(accepted.data.eventCursor, before + 1)
  await reader.cancel()
})

test('Plan command transport decodes one closed request boundary and projects persisted eligibility', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const malformed = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  assert.equal(malformed.status, 400)
  assert.equal(
    Schema.decodeUnknownSync(PlanCommandResponse)(await malformed.json())._tag,
    'Rejected',
  )
  const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (snapshot.plan === undefined)
    throw new Error('Fixture Plan is unavailable')
  assert.equal(snapshot.plan?.actions?.saveDraft._tag, 'Eligible')
  assert.equal(snapshot.plan?.actions?.startAcceptedRun._tag, 'Eligible')
  const started = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'StartAcceptedRun',
        planId: snapshot.plan.planId,
        expectedPlanRevision: snapshot.plan.revision,
        expectedLeaseRevision: snapshot.control.revision,
        idempotencyKey: 'plan-command-start-001',
      },
    }),
  })
  assert.equal(started.status, 202)
  assert.equal(
    Schema.decodeUnknownSync(PlanCommandResponse)(await started.json())._tag,
    'Accepted',
  )
})

test('Alpaca preflight adapter emits only GET reads and derives a blocked mount verdict', async () => {
  const requests: Array<{ readonly url: string; readonly method: string }> = []
  const request: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, method: init?.method ?? 'GET' })
    const value = url.endsWith('/configureddevices')
      ? [
          {
            DeviceName: 'Recorded mount',
            DeviceNumber: 0,
            DeviceType: 'Telescope',
            UniqueID: 'recorded-mount-001',
          },
        ]
      : url.endsWith('/connected')
        ? true
        : url.endsWith('/atpark')
          ? true
          : url.endsWith('/slewing')
            ? false
            : url.endsWith('/canpark')
              ? true
              : 'Recorded mount'
    return Response.json({ Value: value, ErrorNumber: 0 })
  }
  const provider = alpacaPreflightProvider(
    {
      kind: 'alpaca',
      rigId: 'fixture-rig',
      host: '192.168.4.63',
      port: 32323,
      devices: { telescope: { deviceNumber: 0 } },
    },
    request,
  )

  const snapshot = Schema.decodeUnknownSync(PreflightSnapshot)(
    await Effect.runPromise(provider.observe()),
  )

  assert.equal(snapshot.verdict, 'blocked')
  assert.equal(snapshot.checks[1]?.key, 'telescope-parked')
  assert.equal(snapshot.rig?.devices[0]?.uniqueId, 'recorded-mount-001')
  assert.equal(snapshot.rig?.devices[0]?.capabilities[0], 'park')
  assert.deepEqual(
    requests.map((entry) => entry.method),
    ['GET', 'GET', 'GET', 'GET', 'GET', 'GET'],
  )
  assert.deepEqual(
    requests.map((entry) => entry.url),
    [
      'http://192.168.4.63:32323/management/v1/configureddevices',
      'http://192.168.4.63:32323/api/v1/telescope/0/connected',
      'http://192.168.4.63:32323/api/v1/telescope/0/name',
      'http://192.168.4.63:32323/api/v1/telescope/0/atpark',
      'http://192.168.4.63:32323/api/v1/telescope/0/slewing',
      'http://192.168.4.63:32323/api/v1/telescope/0/canpark',
    ],
  )
})

test('Alpaca inventory preserves an unavailable optional configured device without inventing capability', async () => {
  const requests: Array<{ readonly url: string; readonly method: string }> = []
  const request: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, method: init?.method ?? 'GET' })
    const value = url.endsWith('/configureddevices')
      ? [
          {
            DeviceName: 'Recorded camera',
            DeviceNumber: 0,
            DeviceType: 'Camera',
            UniqueID: 'camera-001',
          },
        ]
      : url.endsWith('/connected')
        ? true
        : url.endsWith('/name')
          ? 'Recorded camera'
          : url.endsWith('/canabortexposure')
            ? true
            : url.endsWith('/canstopexposure')
              ? false
              : false
    return Response.json({ Value: value, ErrorNumber: 0 })
  }
  const provider = alpacaPreflightProvider(
    {
      kind: 'alpaca',
      rigId: 'recorded-rig',
      host: '192.168.4.104',
      port: 11111,
      devices: {
        camera: { deviceNumber: 0, uniqueId: 'camera-001' },
        focuser: { deviceNumber: 0 },
      },
    },
    request,
  )

  const snapshot = Schema.decodeUnknownSync(PreflightSnapshot)(
    await Effect.runPromise(provider.observe()),
  )
  assert.equal(snapshot.rig?.rigId, 'recorded-rig')
  assert.equal(snapshot.rig?.devices[0]?.capabilities[0], 'abort exposure')
  assert.equal(snapshot.rig?.devices[1]?.state, 'unavailable')
  assert.deepEqual(snapshot.rig?.devices[1]?.capabilities, [])
  assert.ok(requests.every((entry) => entry.method === 'GET'))
  assert.ok(requests.some((entry) => entry.url.endsWith('/canstopexposure')))
  assert.ok(!requests.some((entry) => entry.url.endsWith('/cansubexposure')))
  assert.ok(
    !requests.some((entry) => entry.url.includes('/focuser/0/connected')),
  )
})

test('Alpaca camera adapter keeps a provider error message from a non-2xx envelope', async () => {
  const provider = alpacaCameraProvider(
    {
      kind: 'alpaca',
      rigId: 'recorded-rig',
      host: '192.168.4.104',
      port: 11111,
      devices: { camera: { deviceNumber: 0 } },
    },
    async () =>
      Response.json(
        {
          Value: null,
          ErrorNumber: 1025,
          ErrorMessage: 'Camera is not connected.',
        },
        { status: 400 },
      ),
  )
  const exit = await Effect.runPromiseExit(provider.startExposure(15))
  assert.equal(exit._tag, 'Success')
  if (Exit.isSuccess(exit))
    assert.deepEqual(exit.value, {
      _tag: 'Rejected',
      summary: 'Camera is not connected.',
    })
})

test('Alpaca camera adapter keeps bounded plain-text non-2xx diagnostics', async () => {
  const provider = alpacaCameraProvider(
    {
      kind: 'alpaca',
      rigId: 'recorded-rig',
      host: '192.168.4.104',
      port: 11111,
      devices: { camera: { deviceNumber: 0 } },
    },
    async () =>
      new Response('The name or value is not valid for this camera.', {
        status: 400,
      }),
  )
  const exit = await Effect.runPromiseExit(provider.startExposure(15))
  if (Exit.isFailure(exit))
    assert.match(Cause.pretty(exit.cause), /name or value is not valid/)
  else throw new Error('Expected the recorded 400 response to fail.')
})

test('Alpaca camera adapter sends exact StartExposure form parameters in its PUT body', async () => {
  const requests: Array<{
    readonly url: string
    readonly method: string
    readonly body: string
    readonly contentType: string | undefined
  }> = []
  const provider = alpacaCameraProvider(
    {
      kind: 'alpaca',
      rigId: 'recorded-rig',
      host: '192.168.4.104',
      port: 11111,
      devices: { camera: { deviceNumber: 0 } },
    },
    async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: String(init?.body),
        contentType:
          new Headers(init?.headers).get('content-type') ?? undefined,
      })
      return Response.json({ Value: null, ErrorNumber: 0 })
    },
  )
  await Effect.runPromise(provider.startExposure(15))
  assert.deepEqual(requests, [
    {
      method: 'PUT',
      url: 'http://192.168.4.104:11111/api/v1/camera/0/startexposure',
      body: 'Duration=15&Light=true',
      contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
    },
  ])
})

function recordedImageBytes() {
  const bytes = new Uint8Array(52)
  const view = new DataView(bytes.buffer)
  for (const [index, value] of [1, 0, 0, 0, 44, 2, 8, 2, 2, 2, 0].entries())
    view.setUint32(index * 4, value, true)
  for (const [index, value] of [0, 20_000, 40_000, 65_535].entries())
    view.setUint16(44 + index * 2, value, true)
  return bytes
}

const recordedCameraProvider = (response: () => Response) =>
  alpacaCameraProvider(
    {
      kind: 'alpaca',
      rigId: 'recorded-rig',
      host: '192.168.4.104',
      port: 11111,
      devices: { camera: { deviceNumber: 0 } },
    },
    async () => response(),
  )

test('Alpaca camera adapter retains bounded ImageBytes binary as cameraRaw', async () => {
  const bytes = recordedImageBytes()
  const provider = alpacaCameraProvider(
    {
      kind: 'alpaca',
      rigId: 'recorded-rig',
      host: '192.168.4.104',
      port: 11111,
      devices: { camera: { deviceNumber: 0 } },
    },
    async () =>
      new Response(bytes, {
        headers: {
          'content-type': 'application/imagebytes',
          'content-length': String(bytes.byteLength),
        },
      }),
  )
  const image = await Effect.runPromise(
    provider.readImageArray?.() ?? Effect.die('missing image reader'),
  )
  assert.equal(image.format, 'cameraRaw')
  assert.deepEqual([...image.bytes], [...bytes])
})

test('Alpaca camera adapter rejects a FITS signature under ImageBytes content type', async () => {
  const provider = recordedCameraProvider(
    () =>
      new Response(new TextEncoder().encode('SIMPLE truncated'), {
        headers: { 'content-type': 'application/imagebytes' },
      }),
  )
  await assert.rejects(
    Effect.runPromise(
      provider.readImageArray?.() ?? Effect.die('missing image reader'),
    ),
    /ImageBytes response is too short/,
  )
})

test('Alpaca camera adapter accepts bounded FITS only with explicit FITS content type', async () => {
  const bytes = previewFits2x2()
  const provider = recordedCameraProvider(
    () =>
      new Response(bytes, {
        headers: { 'content-type': 'application/fits' },
      }),
  )
  const image = await Effect.runPromise(
    provider.readImageArray?.() ?? Effect.die('missing image reader'),
  )
  assert.equal(image.format, 'fits')
  assert.deepEqual(image.bytes, bytes)
})

test('Alpaca camera adapter validates streamed ImageBytes without Content-Length', async () => {
  const bytes = recordedImageBytes()
  const provider = recordedCameraProvider(
    () =>
      new Response(bytes, {
        headers: { 'content-type': 'application/imagebytes' },
      }),
  )
  const image = await Effect.runPromise(
    provider.readImageArray?.() ?? Effect.die('missing image reader'),
  )
  assert.deepEqual(image.bytes, bytes)
})

test('Alpaca camera adapter rejects mismatched metadata and trailing ImageBytes', async () => {
  for (const bytes of [
    (() => {
      const value = recordedImageBytes()
      new DataView(value.buffer).setUint32(20, 0, true)
      return value
    })(),
    Uint8Array.from([...recordedImageBytes(), 0]),
  ]) {
    const provider = recordedCameraProvider(
      () =>
        new Response(bytes, {
          headers: { 'content-type': 'application/imagebytes' },
        }),
    )
    await assert.rejects(
      Effect.runPromise(
        provider.readImageArray?.() ?? Effect.die('missing image reader'),
      ),
      /ImageBytes/,
    )
  }
})

test('Alpaca camera adapter stops an oversized stream without Content-Length', async () => {
  const chunk = new Uint8Array(1024 * 1024)
  let emitted = 0
  const provider = recordedCameraProvider(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (emitted >= 65) controller.close()
            else {
              emitted += 1
              controller.enqueue(chunk)
            }
          },
        }),
        { headers: { 'content-type': 'application/imagebytes' } },
      ),
  )
  await assert.rejects(
    Effect.runPromise(
      provider.readImageArray?.() ?? Effect.die('missing image reader'),
    ),
    /outside the supported size/,
  )
})

test('Alpaca camera adapter rejects oversized JSON before parsing', async () => {
  const provider = recordedCameraProvider(
    () =>
      new Response('{"ErrorNumber":0,"Value":[]}', {
        headers: {
          'content-type': 'application/json',
          'content-length': String(64 * 1024 * 1024 + 1),
        },
      }),
  )
  await assert.rejects(
    Effect.runPromise(
      provider.readImageArray?.() ?? Effect.die('missing image reader'),
    ),
    /outside the supported size/,
  )
})

const readyCameraPreflightProvider = {
  observe: () =>
    Effect.succeed({
      observedAt: '2026-08-05T10:00:00.000Z',
      verdict: 'ready' as const,
      nextAction: 'Camera command eligibility is current.',
      checks: [
        {
          key: 'camera-connected',
          state: 'ready' as const,
          observedAt: '2026-08-05T10:00:00.000Z',
          reason: 'The camera reports an active Alpaca connection.',
        },
      ],
    }),
}

const refreshCameraPreflight = (
  base: string,
  run: { readonly runId: string; readonly revision: number },
) =>
  fetch(`${base}/api/observe/preflight`, {
    method: 'POST',
    body: JSON.stringify({
      runId: run.runId,
      expectedRunRevision: run.revision,
    }),
  })

test('camera commands reject stale authority before the provider and retain only reconciled observations', async (t) => {
  let starts = 0
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    {
      fixture: 'preflight',
      preflightProvider: readyCameraPreflightProvider,
      cameraProvider: {
        startExposure: () => {
          starts += 1
          return Effect.succeed(undefined)
        },
        abortExposure: () => Effect.succeed(undefined),
        readState: () =>
          Effect.succeed({
            observedAt: '2026-08-05T10:00:00.000Z',
            cameraState: 'exposing',
          }),
      },
    },
  )
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const base = `http://127.0.0.1:${listener.port}`
  const started = await startFixtureRun(base, 'camera-command-run')
  if (started.activeRun._tag !== 'Active') throw new Error('Run unavailable')
  const activeRun = started.activeRun.run
  const command = (lease: number, key: string) =>
    fetch(`${base}/api/acquire/commands`, {
      method: 'POST',
      body: JSON.stringify({
        intent: {
          _tag: 'StartCameraExposure',
          expectedLeaseRevision: lease,
          expectedRunRevision: activeRun.revision,
          durationSeconds: 2,
          idempotencyKey: key,
        },
      }),
    })
  assert.equal((await command(999, 'camera-stale')).status, 409)
  assert.equal(starts, 0)
  assert.equal(
    (await command(started.control.revision, 'camera-no-truth')).status,
    409,
  )
  assert.equal(starts, 0)
  assert.equal((await refreshCameraPreflight(base, activeRun)).status, 200)
  const accepted = await command(started.control.revision, 'camera-start')
  assert.equal(accepted.status, 202)
  assert.equal(starts, 1)
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).observe?.preflight?.camera
      ?.cameraState,
    'exposing',
  )
  assert.equal(
    databaseRow(
      Schema.Struct({ observation: Schema.String }),
      service.database
        .prepare('SELECT observation FROM camera_observations WHERE run_id=?')
        .get(activeRun.runId),
    ).observation.includes('exposing'),
    true,
  )
  assert.equal(
    (await command(started.control.revision, 'camera-start')).status,
    202,
  )
  assert.equal(starts, 1)
})

test('camera provider failure persists recover truth and the receipt prevents command replay after restart', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-camera-recover-')),
    'state.sqlite',
  )
  let calls = 0
  const service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    {
      fixture: 'preflight',
      preflightProvider: readyCameraPreflightProvider,
      cameraProvider: {
        startExposure: () => {
          calls += 1
          return Effect.fail(new Error('recorded timeout'))
        },
        abortExposure: () => Effect.fail(new Error('recorded disconnect')),
        readState: () => Effect.fail(new Error('unreachable')),
      },
    },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const started = await startFixtureRun(base, 'camera-recover-run')
  if (started.activeRun._tag !== 'Active') throw new Error('Run unavailable')
  assert.equal(
    (await refreshCameraPreflight(base, started.activeRun.run)).status,
    200,
  )
  const intent = {
    _tag: 'StartCameraExposure',
    expectedLeaseRevision: started.control.revision,
    expectedRunRevision: started.activeRun.run.revision,
    durationSeconds: 2,
    idempotencyKey: 'camera-timeout',
  }
  const command = () =>
    fetch(`${base}/api/acquire/commands`, {
      method: 'POST',
      body: JSON.stringify({ intent }),
    })
  assert.equal((await command()).status, 503)
  assert.equal((await command()).status, 503)
  assert.equal(calls, 1)
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).observe?.preflight
      ?.verdict,
    'unavailable',
  )
  await listener.close()
  service.close()
  const recovered = createLocalWebService(databasePath)
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const snapshot = await bootstrapSnapshot(
    `http://127.0.0.1:${recoveredListener.port}/api/snapshot`,
  )
  assert.equal(snapshot.observe?.preflight?.camera?.cameraState, 'unknown')
  const replay = await fetch(
    `http://127.0.0.1:${recoveredListener.port}/api/acquire/commands`,
    { method: 'POST', body: JSON.stringify({ intent }) },
  )
  assert.equal(replay.status, 503)
})

test('completed camera image becomes a durable Library original and duplicate completion does not reread it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-camera-library-'))
  const databasePath = join(root, 'state.sqlite')
  let reads = 0
  const service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    {
      fixture: 'preflight',
      preflightProvider: readyCameraPreflightProvider,
      cameraProvider: {
        startExposure: () => Effect.succeed(undefined),
        abortExposure: () => Effect.succeed(undefined),
        readState: () =>
          Effect.succeed({
            observedAt: '2026-08-05T10:00:00.000Z',
            cameraState: 'idle',
          }),
        readImageArray: () => {
          reads += 1
          return Effect.succeed({
            bytes: new TextEncoder().encode(
              'SIMPLE  =                    T                                                  END                                                                             ',
            ),
            format: 'fits' as const,
          })
        },
      },
      capturedFrameStorage: { originalsRoot: join(root, 'originals') },
      frameInspectionStorage: {
        originalsRoot: join(root, 'originals'),
        previewsRoot: join(root, 'previews'),
      },
    },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const started = await startFixtureRun(base, 'camera-library-run')
  if (started.activeRun._tag !== 'Active') throw new Error('Run unavailable')
  await refreshCameraPreflight(base, started.activeRun.run)
  const intent = {
    _tag: 'CompleteCameraExposure',
    expectedLeaseRevision: started.control.revision,
    expectedRunRevision: started.activeRun.run.revision,
    idempotencyKey: 'camera-library-complete',
    frameId: 'camera-frame-001',
    capturedAt: '2026-08-05T10:00:00.000Z',
    exposureSeconds: 15,
    filter: 'L',
    binning: 1,
    frameType: 'light',
  }
  const complete = () =>
    fetch(`${base}/api/acquire/commands`, {
      method: 'POST',
      body: JSON.stringify({ intent }),
    })
  assert.equal((await complete()).status, 202)
  assert.equal((await complete()).status, 202)
  assert.equal(reads, 1)
  const assetId = 'asset-capture-camera-library-complete'
  assert.ok(existsSync(join(root, 'originals', `${assetId}.fits`)))
  const detail = await fetch(`${base}/api/library/assets/${assetId}`)
  assert.equal(detail.status, 200)
  const detailText = JSON.stringify(await detail.json())
  assert.match(detailText, /alpaca-imagearray/)
  assert.match(detailText, /SIMPLE/)
  assert.match(detailText, /Preview unavailable/)
  const download = await fetch(`${base}/api/library/assets/${assetId}/download`)
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('content-type'), 'application/fits')
  assert.match(
    new TextDecoder().decode(await download.arrayBuffer()),
    /^SIMPLE/,
  )
  await listener.close()
  service.close()
  const recovered = createLocalWebService(databasePath)
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:${recoveredListener.port}/api/library/assets/${assetId}`,
      )
    ).status,
    200,
  )
})

test('target fixtures keep provisional slew acknowledgement separate from deep-sky and lunar image evidence', async (t) => {
  for (const fixture of ['target-deep-sky', 'target-lunar'] as const) {
    const service = createLocalWebService(
      undefined,
      undefined,
      undefined,
      undefined,
      {
        fixture,
      },
    )
    const listener = await service.listen()
    const base = `http://127.0.0.1:${listener.port}`
    const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
    if (
      snapshot.activeRun._tag !== 'Active' ||
      snapshot.observe?.acquire === undefined
    )
      throw new Error('Target fixture is unavailable')
    const response = await submitPolar(base, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      expectedLeaseRevision: snapshot.control.revision,
      expectedRunRevision: snapshot.activeRun.run.revision,
      expectedAcquireRevision: snapshot.observe.acquire.revision,
      idempotencyKey: `target-${fixture}`,
    })
    assert.equal(response.response.status, 200)
    const recorded = await bootstrapSnapshot(`${base}/api/snapshot`)
    assert.equal(recorded.observe?.acquire?.phase, 'completed')
    assert.equal(
      recorded.observe?.acquire?.latestEvidence?._tag,
      fixture === 'target-deep-sky' ? 'Solved' : 'LunarDiskLimbMeasurement',
    )
    const session = Schema.decodeUnknownSync(
      Schema.Struct({ session: Schema.String }),
    )(service.database.prepare('SELECT session FROM acquire_sessions').get())
    assert.match(session.session, /TargetSlewAcknowledged/)
    await listener.close()
    service.close()
  }
  t.after(() => undefined)
})

test('lunar target acquisition publishes image evidence and survives restart', async () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-target-lunar-')),
    'state.sqlite',
  )
  let service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    { fixture: 'target-lunar' },
  )
  let listener = await service.listen()
  let base = `http://127.0.0.1:${listener.port}`
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (
    snapshot.activeRun._tag !== 'Active' ||
    snapshot.observe?.acquire === undefined
  )
    throw new Error('Lunar target fixture is unavailable')
  const response = await submitPolar(base, {
    _tag: 'CaptureTargetAcquisitionEvidence',
    expectedLeaseRevision: snapshot.control.revision,
    expectedRunRevision: snapshot.activeRun.run.revision,
    expectedAcquireRevision: snapshot.observe.acquire.revision,
    idempotencyKey: 'target-lunar-restart',
  })
  assert.equal(response.response.status, 200)
  assert.match(await nextEvent(reader), /LunarDiskLimbMeasurement/)
  await reader?.cancel()
  await listener.close()
  service.close()

  service = createLocalWebService(databasePath)
  listener = await service.listen()
  base = `http://127.0.0.1:${listener.port}`
  const restarted = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(restarted.observe?.acquire?.phase, 'completed')
  assert.equal(
    restarted.observe?.acquire?.latestEvidence?._tag,
    'LunarDiskLimbMeasurement',
  )
  await listener.close()
  service.close()
})

test('live frame evidence is durable, idempotent, published over SSE, and stays read-only on phone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-live-frame-'))
  const databasePath = join(root, 'state.sqlite')
  let service = createLocalWebService(
    databasePath,
    (request) =>
      request?.headers.authorization === 'Bearer phone'
        ? {
            personId: 'owner-chicks',
            clientId: 'phone-owner',
            role: 'owner' as const,
            capability: 'readOnly' as const,
          }
        : {
            personId: 'owner-chicks',
            clientId: 'desktop-owner',
            role: 'owner' as const,
            capability: 'controlCapable' as const,
          },
    undefined,
    undefined,
    { fixture: 'live-frame' },
  )
  let listener = await service.listen()
  let base = `http://127.0.0.1:${listener.port}`
  const phone = await bootstrapSnapshot(`${base}/api/snapshot`, {
    headers: { authorization: 'Bearer phone' },
  })
  assert.deepEqual(phone.observe?.acquire?.actions, [])
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (
    initial.activeRun._tag !== 'Active' ||
    initial.observe?.acquire === undefined
  )
    throw new Error('Live frame fixture is unavailable')
  const intent = {
    _tag: 'RecordLiveFrameEvidence' as const,
    expectedLeaseRevision: initial.control.revision,
    expectedRunRevision: initial.activeRun.run.revision,
    expectedAcquireRevision: initial.observe.acquire.revision,
    idempotencyKey: 'live-frame-replay',
  }
  assert.equal((await submitPolar(base, intent)).response.status, 200)
  assert.match(await nextEvent(reader), /liveFrame/)
  assert.equal((await submitPolar(base, intent)).response.status, 200)
  const recorded = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(
    recorded.observe?.acquire?.liveFrame?.sourceFrameAssetId,
    'asset-capture-live-001',
  )
  assert.equal(recorded.observe?.acquire?.liveFrame?.acceptedFrameCount, 1)
  assert.equal(recorded.observe?.acquire?.liveFrame?.focus._tag, 'Unknown')
  const unresolvedReview = await fetch(`${base}/api/observe/live-frame`).then(
    (response) => response.json(),
  )
  assert.equal(unresolvedReview._tag, 'Unavailable')
  assert.equal(unresolvedReview.reason, 'LibraryAssetNotFound')
  assert.deepEqual(
    materializeCapturedFrame(
      service.database,
      { originalsRoot: join(root, 'originals') },
      {
        assetId: 'asset-capture-live-001',
        frameId: 'frame-live-001',
        capturedAt: '2026-08-04T01:02:03.000Z',
        format: 'fits',
        equipment: capturedEquipment,
        capture: {
          exposureSeconds: 180,
          filter: 'L',
          binning: 1,
          frameType: 'light',
        },
        lineage: {
          runId: 'run-live-frame',
          sequenceId: 'sequence-l',
          acquisitionId: 'acquire-live-001',
        },
        idempotencyKey: 'capture-live-001',
      },
      new TextEncoder().encode('live-frame-fits-bytes'),
    ).outcome,
    'accepted',
  )
  const resolvedReview = await fetch(`${base}/api/observe/live-frame`).then(
    (response) => response.json(),
  )
  assert.equal(resolvedReview._tag, 'Available')
  assert.equal(resolvedReview.asset.assetId, 'asset-capture-live-001')
  assert.equal(
    (
      await fetch(`${base}/api/observe/live-frame`, {
        headers: { authorization: 'Bearer phone' },
      })
    ).status,
    200,
  )
  const stored = Schema.decodeUnknownSync(
    Schema.Struct({ session: Schema.String }),
  )(service.database.prepare('SELECT session FROM acquire_sessions').get())
  assert.equal(
    Schema.decodeUnknownSync(AcquireSession)(
      JSON.parse(stored.session),
    ).evidence.filter((evidence) => evidence._tag === 'LiveFrame').length,
    1,
  )
  await reader?.cancel()
  await listener.close()
  service.close()

  service = createLocalWebService(databasePath)
  listener = await service.listen()
  base = `http://127.0.0.1:${listener.port}`
  const restarted = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(restarted.observe?.acquire?.liveFrame?.targetFraming, 'inFrame')
  assert.equal(
    restarted.observe?.acquire?.liveFrame?.storageForecastMb._tag,
    'Known',
  )
  await listener.close()
  service.close()
})

test('managed capture persists guarded progress actions, replay, SSE, restart, and phone read-only state', async () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-managed-capture-')),
    'state.sqlite',
  )
  const admission = (request?: Pick<IncomingMessage, 'headers'>) =>
    request?.headers.authorization === 'Bearer phone'
      ? {
          personId: 'owner-chicks',
          clientId: 'phone-owner',
          role: 'owner' as const,
          capability: 'readOnly' as const,
        }
      : {
          personId: 'owner-chicks',
          clientId: 'desktop-owner',
          role: 'owner' as const,
          capability: 'controlCapable' as const,
        }
  let service = createLocalWebService(
    databasePath,
    admission,
    undefined,
    undefined,
    { fixture: 'managed-capture' },
  )
  let listener = await service.listen()
  let base = `http://127.0.0.1:${listener.port}`
  const phone = await bootstrapSnapshot(`${base}/api/snapshot`, {
    headers: { authorization: 'Bearer phone' },
  })
  assert.deepEqual(phone.observe?.acquire?.actions, [])
  const initialFixture = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(initialFixture.activeRun._tag, 'Active')
  assert.equal(
    initialFixture.activeRun._tag === 'Active'
      ? initialFixture.activeRun.run.phase
      : undefined,
    'capture',
  )
  assert.equal(initialFixture.observe?.acquire?.managedCapture?.state, 'active')
  assert.equal(
    initialFixture.observe?.acquire?.managedCapture?.exposureCount,
    8,
  )
  assert.deepEqual(initialFixture.observe?.acquire?.actions, [
    { _tag: 'Available', action: 'PauseManagedCapture' },
    { _tag: 'Available', action: 'StopManagedCapture' },
  ])
  const command = async (
    _tag: 'StartManagedCapture' | 'PauseManagedCapture' | 'StopManagedCapture',
    idempotencyKey: string,
  ) => {
    const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
    if (
      snapshot.activeRun._tag !== 'Active' ||
      snapshot.observe?.acquire === undefined
    )
      throw new Error('Managed capture fixture is unavailable')
    return submitPolar(base, {
      _tag,
      expectedLeaseRevision: snapshot.control.revision,
      expectedRunRevision: snapshot.activeRun.run.revision,
      expectedAcquireRevision: snapshot.observe.acquire.revision,
      idempotencyKey,
    })
  }
  assert.equal(
    (await command('PauseManagedCapture', 'capture-pause')).response.status,
    200,
  )
  assert.equal(
    (await command('PauseManagedCapture', 'capture-pause')).response.status,
    200,
  )
  const active = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(active.observe?.acquire?.managedCapture?.state, 'paused')
  assert.equal(active.observe?.acquire?.managedCapture?.exposureCount, 8)
  assert.equal(
    active.observe?.acquire?.managedCapture?.resourceProtection,
    'available',
  )
  assert.equal(
    (await command('StopManagedCapture', 'capture-stop')).response.status,
    200,
  )
  const stopped = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(stopped.observe?.acquire?.managedCapture?.state, 'stopped')
  const stale = await submitPolar(base, {
    _tag: 'StartManagedCapture',
    expectedLeaseRevision: stopped.control.revision,
    expectedRunRevision:
      stopped.activeRun._tag === 'Active' ? stopped.activeRun.run.revision : 0,
    expectedAcquireRevision: 0,
    idempotencyKey: 'capture-stale',
  })
  assert.equal(stale.response.status, 409)
  await listener.close()
  service.close()
  service = createLocalWebService(databasePath, admission)
  listener = await service.listen()
  base = `http://127.0.0.1:${listener.port}`
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).observe?.acquire
      ?.managedCapture?.state,
    'stopped',
  )
  await listener.close()
  service.close()
})

test('Acquire recovery is bounded, reconciled, idempotent, streamed, restart-safe, and phone read-only', async () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-acquire-recovery-')),
    'state.sqlite',
  )
  const admission = (request?: Pick<IncomingMessage, 'headers'>) =>
    request?.headers.authorization === 'Bearer phone'
      ? {
          personId: 'owner-chicks',
          clientId: 'phone-owner',
          role: 'owner' as const,
          capability: 'readOnly' as const,
        }
      : {
          personId: 'owner-chicks',
          clientId: 'desktop-owner',
          role: 'owner' as const,
          capability: 'controlCapable' as const,
        }
  let service = createLocalWebService(
    databasePath,
    admission,
    undefined,
    undefined,
    { fixture: 'acquire-recovery' },
  )
  let listener = await service.listen()
  let base = `http://127.0.0.1:${listener.port}`
  const phone = await bootstrapSnapshot(`${base}/api/snapshot`, {
    headers: { authorization: 'Bearer phone' },
  })
  assert.deepEqual(phone.observe?.acquire?.actions, [])
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const paused = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (
    paused.activeRun._tag !== 'Active' ||
    paused.observe?.acquire === undefined
  )
    throw new Error('Acquire recovery fixture is unavailable')
  assert.equal(paused.observe.acquire.phase, 'paused')
  assert.deepEqual(paused.observe.acquire.actions, [
    { _tag: 'Available', action: 'RetryPlateSolveWithParameters' },
    { _tag: 'Available', action: 'SkipAcquireTarget' },
    { _tag: 'Available', action: 'AbortAcquire' },
  ])
  assert.equal(paused.observe.acquire.recovery?.remainingAttempts, 0)
  assert.equal(paused.observe.acquire.recovery?.remainingRecoverySeries, 1)
  const recovery = {
    _tag: 'RetryPlateSolveWithParameters' as const,
    expectedLeaseRevision: paused.control.revision,
    expectedRunRevision: paused.activeRun.run.revision,
    expectedAcquireRevision: paused.observe.acquire.revision,
    parameters: {
      exposureSeconds: 15,
      binning: 1,
      solverProfile: 'deep-sky-plate-solve',
    },
    idempotencyKey: 'recovery-replay',
  }
  assert.equal((await submitPolar(base, recovery)).response.status, 200)
  assert.match(await nextEvent(reader), /"phase":"solving"/)
  assert.equal((await submitPolar(base, recovery)).response.status, 200)
  const recovered = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(recovered.observe?.acquire?.phase, 'solving')
  assert.equal(recovered.observe?.acquire?.recovery?.remainingRecoverySeries, 0)
  assert.equal(
    (
      await submitPolar(base, {
        ...recovery,
        idempotencyKey: 'recovery-stale',
      })
    ).response.status,
    409,
  )
  await reader?.cancel()
  await listener.close()
  service.close()

  service = createLocalWebService(databasePath, admission)
  listener = await service.listen()
  base = `http://127.0.0.1:${listener.port}`
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).observe?.acquire?.phase,
    'solving',
  )
  await listener.close()
  service.close()

  const skipService = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    { fixture: 'acquire-recovery' },
  )
  const skipListener = await skipService.listen()
  const skipBase = `http://127.0.0.1:${skipListener.port}`
  const skipSnapshot = await bootstrapSnapshot(`${skipBase}/api/snapshot`)
  if (
    skipSnapshot.activeRun._tag !== 'Active' ||
    skipSnapshot.observe?.acquire === undefined
  )
    throw new Error('Acquire recovery skip fixture is unavailable')
  const skip = {
    _tag: 'SkipAcquireTarget' as const,
    expectedLeaseRevision: skipSnapshot.control.revision,
    expectedRunRevision: skipSnapshot.activeRun.run.revision,
    expectedAcquireRevision: skipSnapshot.observe.acquire.revision,
    idempotencyKey: 'skip-replay',
  }
  assert.equal((await submitPolar(skipBase, skip)).response.status, 200)
  assert.equal((await submitPolar(skipBase, skip)).response.status, 200)
  assert.equal(
    (await bootstrapSnapshot(`${skipBase}/api/snapshot`)).observe?.acquire
      ?.phase,
    'skipped',
  )
  await skipListener.close()
  skipService.close()
})

test('AbortAcquire is lease and revision guarded, durable, idempotent, and streamed', async () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-acquire-abort-')),
    'state.sqlite',
  )
  let service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    { fixture: 'acquire-recovery' },
  )
  let listener = await service.listen()
  let base = `http://127.0.0.1:${listener.port}`
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (
    initial.activeRun._tag !== 'Active' ||
    initial.observe?.acquire === undefined
  )
    throw new Error('Acquire abort fixture is unavailable')
  const intent = {
    _tag: 'AbortAcquire' as const,
    expectedLeaseRevision: initial.control.revision,
    expectedRunRevision: initial.activeRun.run.revision,
    expectedAcquireRevision: initial.observe.acquire.revision,
    idempotencyKey: 'abort-replay',
  }
  assert.equal(
    (
      await submitPolar(base, {
        ...intent,
        expectedLeaseRevision: initial.control.revision + 1,
        idempotencyKey: 'abort-lease-stale',
      })
    ).response.status,
    409,
  )
  assert.equal((await submitPolar(base, intent)).response.status, 200)
  assert.match(await nextEvent(reader), /"phase":"aborted"/)
  assert.equal((await submitPolar(base, intent)).response.status, 200)
  assert.equal(
    (
      await submitPolar(base, {
        ...intent,
        idempotencyKey: 'abort-revision-stale',
      })
    ).response.status,
    409,
  )
  await reader?.cancel()
  await listener.close()
  service.close()

  service = createLocalWebService(databasePath)
  listener = await service.listen()
  base = `http://127.0.0.1:${listener.port}`
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).observe?.acquire?.phase,
    'aborted',
  )
  await listener.close()
  service.close()
})

test('target correction fixture installs a durable large pending proposal without a provider call', async (t) => {
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    { fixture: 'target-correction' },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(snapshot.observe?.acquire?.phase, 'awaitingApproval')
  assert.equal(
    snapshot.observe?.acquire?.pendingProposal?.correction.rightAscensionArcsec,
    90,
  )
  assert.equal(snapshot.observe?.acquire?.correctionAttemptsRemaining, 2)
})

test('target verification fixture exposes provisional acknowledgement and fresh-image verification', async (t) => {
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    { fixture: 'target-verification' },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(snapshot.observe?.acquire?.phase, 'verifying')
  assert.equal(snapshot.observe?.acquire?.latestEvidence?._tag, 'Solved')
  assert.match(
    snapshot.observe?.acquire?.attention ?? '',
    /acknowledgement is provisional.*fresh solved frame/i,
  )
  assert.deepEqual(snapshot.observe?.acquire?.actions, [
    { _tag: 'Available', action: 'CaptureTargetAcquisitionEvidence' },
  ])
})

test('pointing correction keeps provider acknowledgement provisional until a fresh solved frame verifies it', async (t) => {
  let captures = 0
  let corrections = 0
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    {
      fixture: 'target-deep-sky',
      targetAcquisitionProvider: {
        capture: () => {
          captures += 1
          return Effect.succeed({
            _tag: 'Captured' as const,
            slewAcknowledgement: {
              acknowledgedAtEpochMs: 1_722_729_600_000,
              acknowledgementRef: 'fixture-slew',
            },
            evidence: {
              sourceFrameAssetId: `fixture-correction-frame-${captures}`,
              capturedAtEpochMs: 1_722_729_600_100 + captures,
              solverId: 'fixture-plate-solver',
              solverVersion: '1.0.0',
              result: {
                _tag: 'Solved' as const,
                desiredCenter: {
                  rightAscensionDegrees: 299.901,
                  declinationDegrees: 22.721,
                },
                solvedCenter: {
                  rightAscensionDegrees: 299.901,
                  declinationDegrees: 22.721,
                },
                correction: {
                  rightAscensionArcsec: captures === 1 ? 40 : 0,
                  declinationArcsec: 0,
                  convention: 'mountRaDec' as const,
                },
                uncertaintyArcsec: 4,
              },
            },
          })
        },
        correct: () => {
          corrections += 1
          return Effect.succeed({
            _tag: 'Accepted' as const,
            acknowledgedAtEpochMs: 1_722_729_600_200,
            acknowledgementRef: 'fixture-correction-acknowledgement',
          })
        },
      },
    },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const first = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (first.activeRun._tag !== 'Active' || first.observe?.acquire === undefined)
    throw new Error('Target fixture is unavailable')
  const command = (snapshot: typeof first, key: string) => {
    if (
      snapshot.activeRun._tag !== 'Active' ||
      snapshot.observe?.acquire === undefined
    )
      throw new Error('Target fixture is unavailable')
    return submitPolar(base, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      expectedLeaseRevision: snapshot.control.revision,
      expectedRunRevision: snapshot.activeRun.run.revision,
      expectedAcquireRevision: snapshot.observe.acquire.revision,
      idempotencyKey: key,
    })
  }
  const accepted = await command(first, 'pointing-correction-first')
  assert.equal(accepted.response.status, 200)
  assert.equal(corrections, 1)
  const provisional = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(provisional.observe?.acquire?.phase, 'verifying')
  assert.equal(provisional.observe?.acquire?.latestEvidence?._tag, 'Solved')
  const verified = await command(provisional, 'pointing-correction-verify')
  assert.equal(verified.response.status, 200)
  const completed = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(completed.observe?.acquire?.phase, 'completed')
  assert.equal(captures, 2)
  const row = Schema.decodeUnknownSync(
    Schema.Struct({ session: Schema.String }),
  )(service.database.prepare('SELECT session FROM acquire_sessions').get())
  assert.match(row.session, /CorrectionAccepted/)
  assert.match(row.session, /verificationOfCorrectionAttemptId/)
})

test('recovery retains prior solved evidence when later verification frames have no solution', async (t) => {
  let captures = 0
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    {
      fixture: 'target-deep-sky',
      targetAcquisitionProvider: {
        capture: () => {
          captures += 1
          return Effect.succeed({
            _tag: 'Captured' as const,
            slewAcknowledgement: {
              acknowledgedAtEpochMs: 1_722_729_600_000,
              acknowledgementRef: 'fixture-retained-slew',
            },
            evidence:
              captures === 1
                ? {
                    sourceFrameAssetId: 'fixture-retained-solved-frame',
                    capturedAtEpochMs: 1_722_729_600_100,
                    solverId: 'fixture-plate-solver',
                    solverVersion: '1.0.0',
                    result: {
                      _tag: 'Solved' as const,
                      desiredCenter: {
                        rightAscensionDegrees: 299.901,
                        declinationDegrees: 22.721,
                      },
                      solvedCenter: {
                        rightAscensionDegrees: 299.901,
                        declinationDegrees: 22.721,
                      },
                      correction: {
                        rightAscensionArcsec: 40,
                        declinationArcsec: 0,
                        convention: 'mountRaDec' as const,
                      },
                      uncertaintyArcsec: 4,
                    },
                  }
                : {
                    sourceFrameAssetId: `fixture-retained-unverified-${captures}`,
                    capturedAtEpochMs: 1_722_729_600_100 + captures,
                    solverId: 'fixture-plate-solver',
                    solverVersion: '1.0.0',
                    result: {
                      _tag: 'NoSolution' as const,
                      category: 'stars-insufficient',
                      retryable: true,
                      diagnosticRef: `fixture-retained-diagnostic-${captures}`,
                    },
                  },
          })
        },
        correct: () =>
          Effect.succeed({
            _tag: 'Accepted' as const,
            acknowledgedAtEpochMs: 1_722_729_600_200,
            acknowledgementRef: 'fixture-retained-correction',
          }),
      },
    },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const capture = async (idempotencyKey: string) => {
    const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
    if (
      snapshot.activeRun._tag !== 'Active' ||
      snapshot.observe?.acquire === undefined
    )
      throw new Error('Retained evidence fixture is unavailable')
    return submitPolar(base, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      expectedLeaseRevision: snapshot.control.revision,
      expectedRunRevision: snapshot.activeRun.run.revision,
      expectedAcquireRevision: snapshot.observe.acquire.revision,
      idempotencyKey,
    })
  }
  assert.equal((await capture('retained-solved')).response.status, 200)
  assert.equal((await capture('retained-unverified-1')).response.status, 200)
  assert.equal((await capture('retained-unverified-2')).response.status, 200)
  const paused = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(paused.observe?.acquire?.phase, 'paused')
  assert.equal(paused.observe?.acquire?.latestEvidence?._tag, 'NoSolution')
  assert.equal(
    paused.observe?.acquire?.recovery?.priorVerifiedState,
    'retained',
  )
  assert.match(
    paused.observe?.acquire?.recovery?.reconciliation ?? '',
    /Prior solved image evidence is retained/,
  )
  assert.equal(captures, 3)
})

test('pointing correction revision replays idempotently before approval and still requires fresh image verification', async (t) => {
  let captures = 0
  let corrections = 0
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    {
      fixture: 'target-deep-sky',
      targetAcquisitionProvider: {
        capture: () => {
          captures += 1
          return Effect.succeed({
            _tag: 'Captured' as const,
            slewAcknowledgement: {
              acknowledgedAtEpochMs: 1_722_729_600_000,
              acknowledgementRef: 'fixture-slew',
            },
            evidence: {
              sourceFrameAssetId: `fixture-revision-frame-${captures}`,
              capturedAtEpochMs: 1_722_729_600_100 + captures,
              solverId: 'fixture-plate-solver',
              solverVersion: '1.0.0',
              result: {
                _tag: 'Solved' as const,
                desiredCenter: {
                  rightAscensionDegrees: 299.901,
                  declinationDegrees: 22.721,
                },
                solvedCenter: {
                  rightAscensionDegrees: 299.901,
                  declinationDegrees: 22.721,
                },
                correction: {
                  rightAscensionArcsec: captures === 1 ? 90 : 0,
                  declinationArcsec: 0,
                  convention: 'mountRaDec' as const,
                },
                uncertaintyArcsec: 4,
              },
            },
          })
        },
        correct: () => {
          corrections += 1
          return Effect.succeed({
            _tag: 'Accepted' as const,
            acknowledgedAtEpochMs: 1_722_729_600_200,
            acknowledgementRef: 'fixture-revision-acknowledgement',
          })
        },
      },
    },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (
    initial.activeRun._tag !== 'Active' ||
    initial.observe?.acquire === undefined
  )
    throw new Error('Target fixture is unavailable')
  const capture = (snapshot: typeof initial, key: string) => {
    if (
      snapshot.activeRun._tag !== 'Active' ||
      snapshot.observe?.acquire === undefined
    )
      throw new Error('Target fixture is unavailable')
    return submitPolar(base, {
      _tag: 'CaptureTargetAcquisitionEvidence',
      expectedLeaseRevision: snapshot.control.revision,
      expectedRunRevision: snapshot.activeRun.run.revision,
      expectedAcquireRevision: snapshot.observe.acquire.revision,
      idempotencyKey: key,
    })
  }
  assert.equal(
    (await capture(initial, 'revision-initial')).response.status,
    200,
  )
  const proposed = await bootstrapSnapshot(`${base}/api/snapshot`)
  const proposedAcquire = proposed.observe?.acquire
  const proposal = proposedAcquire?.pendingProposal
  if (
    proposed.activeRun._tag !== 'Active' ||
    proposedAcquire === undefined ||
    proposal === undefined
  )
    throw new Error('Pointing correction proposal is unavailable')
  const revisionIntent = {
    _tag: 'RevisePointingCorrection' as const,
    expectedLeaseRevision: proposed.control.revision,
    expectedRunRevision: proposed.activeRun.run.revision,
    expectedAcquireRevision: proposedAcquire.revision,
    proposalId: proposal.proposalId,
    correction: { rightAscensionArcsec: 70, declinationArcsec: 0 },
    idempotencyKey: 'revision-replay',
  }
  const revised = await submitPolar(base, revisionIntent)
  assert.equal(revised.response.status, 200)
  assert.equal((await submitPolar(base, revisionIntent)).response.status, 200)
  assert.equal(corrections, 0)
  const revisedSnapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  const revisedAcquire = revisedSnapshot.observe?.acquire
  const revisedProposal = revisedAcquire?.pendingProposal
  if (
    revisedSnapshot.activeRun._tag !== 'Active' ||
    revisedAcquire === undefined ||
    revisedProposal === undefined
  )
    throw new Error('Revised pointing correction proposal is unavailable')
  assert.notEqual(revisedProposal.proposalId, proposal.proposalId)
  const approval = await submitPolar(base, {
    _tag: 'ApprovePointingCorrection',
    expectedLeaseRevision: revisedSnapshot.control.revision,
    expectedRunRevision: revisedSnapshot.activeRun.run.revision,
    expectedAcquireRevision: revisedAcquire.revision,
    proposalId: revisedProposal.proposalId,
    idempotencyKey: 'revision-approval',
  })
  assert.equal(approval.response.status, 200)
  assert.equal(corrections, 1)
  const verifying = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(verifying.observe?.acquire?.phase, 'verifying')
  assert.equal(
    (await capture(verifying, 'revision-verification')).response.status,
    200,
  )
  const completed = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(completed.observe?.acquire?.phase, 'completed')
  assert.equal(captures, 2)
})

test('read-only preflight persists configured provider facts, survives restart, and publishes SSE without work', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-preflight-')),
    'state.sqlite',
  )
  const provider = {
    observe: () =>
      Effect.succeed({
        observedAt: '2026-08-03T03:00:00.000Z',
        verdict: 'blocked' as const,
        nextAction: 'Resolve the mount horizon blocker before any command.',
        checks: [
          {
            key: 'mount-horizon',
            state: 'blocked' as const,
            observedAt: '2026-08-03T03:00:00.000Z',
            reason: 'The target is below the configured horizon.',
          },
        ],
      }),
  }
  const service = createLocalWebService(
    databasePath,
    (request) =>
      request?.headers.authorization === 'Bearer phone'
        ? {
            personId: 'owner-chicks',
            clientId: 'phone-owner',
            role: 'owner' as const,
            capability: 'readOnly' as const,
          }
        : {
            personId: 'owner-chicks',
            clientId: 'desktop-owner',
            role: 'owner' as const,
            capability: 'controlCapable' as const,
          },
    undefined,
    undefined,
    { fixture: 'preflight', preflightProvider: provider },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const started = await startFixtureRun(base, 'preflight-start')
  if (started.activeRun._tag !== 'Active') throw new Error('Run unavailable')
  const phone = await fetch(`${base}/api/observe/preflight`, {
    method: 'POST',
    headers: { authorization: 'Bearer phone' },
    body: JSON.stringify({
      runId: started.activeRun.run.runId,
      expectedRunRevision: started.activeRun.run.revision,
    }),
  })
  assert.equal(phone.status, 403)
  assert.equal(
    Schema.decodeUnknownSync(RefreshPreflightResponse)(await phone.json())._tag,
    'Rejected',
  )
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const response = await fetch(`${base}/api/observe/preflight`, {
    method: 'POST',
    body: JSON.stringify({
      runId: started.activeRun.run.runId,
      expectedRunRevision: started.activeRun.run.revision,
    }),
  })
  const responseBody: unknown = await response.json()
  assert.equal(response.status, 200, JSON.stringify(responseBody))
  assert.equal(
    Schema.decodeUnknownSync(RefreshPreflightResponse)(responseBody)._tag,
    'Refreshed',
  )
  assert.match(await nextEvent(reader), /"preflight"/)
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    0,
  )
  await reader?.cancel()
  await listener.close()
  service.close()
  const recovered = createLocalWebService(databasePath)
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const snapshot = await bootstrapSnapshot(
    `http://127.0.0.1:${recoveredListener.port}/api/snapshot`,
  )
  assert.equal(snapshot.observe?.preflight?.verdict, 'blocked')
  assert.equal(snapshot.observe?.preflight?.checks[0]?.state, 'blocked')
  const unavailable = await fetch(
    `http://127.0.0.1:${recoveredListener.port}/api/observe/preflight`,
    {
      method: 'POST',
      body: JSON.stringify({
        runId: started.activeRun.run.runId,
        expectedRunRevision: started.activeRun.run.revision,
      }),
    },
  )
  assert.equal(unavailable.status, 503)
  assert.equal(
    Schema.decodeUnknownSync(RefreshPreflightResponse)(await unavailable.json())
      ._tag,
    'Unavailable',
  )
})

test('configured provider failure persists an unavailable preflight snapshot before its 503 response', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-preflight-unavailable-')),
    'state.sqlite',
  )
  const service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    {
      fixture: 'preflight',
      preflightProvider: {
        observe: () => Effect.fail(new Error('recorded provider outage')),
        unavailableSnapshot: () => ({
          observedAt: '2026-08-05T10:00:00.000Z',
          verdict: 'unavailable' as const,
          nextAction: 'Restore the configured rig provider before any command.',
          checks: [
            {
              key: 'camera-available',
              state: 'unavailable' as const,
              observedAt: '2026-08-05T10:00:00.000Z',
              reason: 'Alpaca did not return a read-only observation.',
            },
          ],
          rig: {
            rigId: 'recorded-rig',
            observedAt: '2026-08-05T10:00:00.000Z',
            devices: [
              {
                kind: 'camera' as const,
                state: 'unavailable' as const,
                observedAt: '2026-08-05T10:00:00.000Z',
                capabilities: [],
                safety: [
                  {
                    key: 'camera-available',
                    state: 'unavailable' as const,
                    observedAt: '2026-08-05T10:00:00.000Z',
                    reason: 'Alpaca did not return a read-only observation.',
                  },
                ],
              },
            ],
          },
        }),
      },
    },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const started = await startFixtureRun(base, 'preflight-unavailable-start')
  if (started.activeRun._tag !== 'Active') throw new Error('Run unavailable')
  const response = await fetch(`${base}/api/observe/preflight`, {
    method: 'POST',
    body: JSON.stringify({
      runId: started.activeRun.run.runId,
      expectedRunRevision: started.activeRun.run.revision,
    }),
  })
  assert.equal(response.status, 503)
  assert.equal(
    Schema.decodeUnknownSync(RefreshPreflightResponse)(await response.json())
      ._tag,
    'Unavailable',
  )
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).observe?.preflight
      ?.verdict,
    'unavailable',
  )
  await listener.close()
  service.close()
  const recovered = createLocalWebService(databasePath)
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const snapshot = await bootstrapSnapshot(
    `http://127.0.0.1:${recoveredListener.port}/api/snapshot`,
  )
  assert.equal(snapshot.observe?.preflight?.rig?.rigId, 'recorded-rig')
  assert.equal(snapshot.observe?.preflight?.checks[0]?.state, 'unavailable')
})

test('polar inspect fixture records deterministic guidance with acceptance available', async (t) => {
  const service = createLocalWebService(
    undefined,
    undefined,
    undefined,
    undefined,
    { fixture: 'polar' },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  const capture = polarCaptureIntent(initial, 'polar-inspect-guidance')
  assert.equal((await submitPolar(base, capture)).response.status, 200)
  const guidance = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(guidance.observe?.acquire?.phase, 'polarGuidance')
  assert.equal(
    guidance.observe?.acquire?.latestEvidence?._tag,
    'PolarMeasurement',
  )
  assert.equal(guidance.observe?.acquire?.latestEvidence?.withinTolerance, true)
  assert.deepEqual(guidance.observe?.acquire?.actions, [
    { _tag: 'Available', action: 'AcceptPolarAlignmentEvidence' },
  ])
})

test('polar Acquire records only solved evidence, requires current in-tolerance acceptance, replays idempotently, survives restart, and publishes SSE', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-polar-')),
    'state.sqlite',
  )
  let measurements = 0
  const provider = {
    measure: () => {
      measurements += 1
      const error = measurements === 1 ? 90 : 12
      return Effect.succeed({
        sourceFrameAssetId: `polar-frame-${measurements}`,
        measuredAtEpochMs: 1_754_187_200_000 + measurements,
        desiredPole: { rightAscensionDegrees: 0, declinationDegrees: 90 },
        measuredMountAxis: { rightAscensionDegrees: 0, declinationDegrees: 90 },
        altitudeErrorArcsec: error,
        azimuthErrorArcsec: 0,
        uncertaintyArcsec: 4,
      })
    },
  }
  const unavailable = createLocalWebService(
    ':memory:',
    undefined,
    undefined,
    undefined,
    {
      fixture: 'polar',
      polarMeasurementProvider: {
        measure: () => Effect.fail('fixture provider unavailable'),
      },
    },
  )
  const unavailableListener = await unavailable.listen()
  const unavailableBase = `http://127.0.0.1:${unavailableListener.port}`
  const unavailableSnapshot = await bootstrapSnapshot(
    `${unavailableBase}/api/snapshot`,
  )
  const unavailableResponse = await fetch(
    `${unavailableBase}/api/acquire/commands`,
    {
      method: 'POST',
      body: JSON.stringify({
        intent: polarCaptureIntent(unavailableSnapshot, 'polar-unavailable'),
      }),
    },
  )
  assert.equal(unavailableResponse.status, 503)
  assert.equal(
    Schema.decodeUnknownSync(AcquireCommandResponse)(
      await unavailableResponse.json(),
    )._tag,
    'Unavailable',
  )
  await unavailableListener.close()
  unavailable.close()

  let service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    { fixture: 'polar', polarMeasurementProvider: provider },
  )
  let listener = await service.listen()
  let base = `http://127.0.0.1:${listener.port}`
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  const firstIntent = polarCaptureIntent(initial, 'polar-measurement-1')
  const first = await submitPolar(base, firstIntent)
  assert.equal(first.response.status, 200)
  assert.equal(first.body._tag, 'Accepted')
  assert.match(await nextEvent(reader), /"_tag":"PolarMeasurement"/)
  assert.equal(measurements, 1)
  const afterOutOfTolerance = await bootstrapSnapshot(`${base}/api/snapshot`)
  const firstEvidence = polarEvidence(afterOutOfTolerance)
  assert.equal(firstEvidence.withinTolerance, false)
  const rejected = await submitPolar(
    base,
    polarAcceptIntent(
      afterOutOfTolerance,
      firstEvidence.attemptId,
      'polar-accept-outside',
    ),
  )
  assert.equal(rejected.response.status, 409)
  assert.equal(rejected.body._tag, 'Rejected')
  const replay = await submitPolar(base, firstIntent)
  assert.equal(replay.response.status, 200)
  assert.equal(replay.body._tag, 'Accepted')
  assert.equal(measurements, 1)
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).eventCursor,
    afterOutOfTolerance.eventCursor,
  )

  const secondSnapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  const second = await submitPolar(
    base,
    polarCaptureIntent(secondSnapshot, 'polar-measurement-2'),
  )
  assert.equal(second.response.status, 200)
  const withinTolerance = await bootstrapSnapshot(`${base}/api/snapshot`)
  const secondEvidence = polarEvidence(withinTolerance)
  assert.equal(secondEvidence.withinTolerance, true)
  const accepted = await submitPolar(
    base,
    polarAcceptIntent(
      withinTolerance,
      secondEvidence.attemptId,
      'polar-accept-2',
    ),
  )
  assert.equal(accepted.response.status, 200)
  assert.equal(accepted.body._tag, 'Accepted')
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).observe?.acquire?.phase,
    'completed',
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    0,
  )
  await reader?.cancel()
  await listener.close()
  service.close()

  service = createLocalWebService(databasePath)
  listener = await service.listen()
  base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const recovered = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(recovered.observe?.acquire?.phase, 'completed')
  assert.equal(
    recovered.observe?.acquire?.latestEvidence?._tag,
    'PolarMeasurement',
  )
  assert.equal(
    recovered.observe?.acquire?.latestEvidence?.withinTolerance,
    true,
  )
})

test('every retired direct Plan, Observe, and control route returns a JSON 404', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  for (const path of [
    '/api/commands/start-run',
    '/api/commands/save-plan-draft',
    '/api/commands/accept-run-definition',
    '/api/commands/pause-run',
    '/api/commands/resume-run',
    '/api/commands/stop-run',
    '/api/commands/skip-fake-sequence',
    '/api/commands/retry-fake-phase',
    '/api/commands/request-fake-park',
    '/api/commands/preview-run-mutation',
    '/api/commands/apply-run-mutation',
    '/api/commands/approve-disruptive-run-mutation',
    '/api/commands/request-control',
    '/api/commands/grant-control',
    '/api/commands/take-control',
    '/api/commands/controller-disconnected',
    '/api/commands/controller-reconnected',
  ]) {
    const response = await fetch(`${base}${path}`, { method: 'POST' })
    assert.equal(response.status, 404)
    assert.match(
      response.headers.get('content-type') ?? '',
      /^application\/json/,
    )
    assert.equal(
      Schema.decodeUnknownSync(
        Schema.Struct({
          outcome: Schema.Literal('rejected'),
          reason: Schema.Literal('InvalidInput'),
        }),
      )(await response.json()).reason,
      'InvalidInput',
    )
  }
})

test('canonical control commands persist exact requests, actor-scoped receipts, and SSE truth', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-canonical-control-')),
    'state.sqlite',
  )
  const service = createFixtureService(databasePath, (request) => {
    const token = request?.headers.authorization
    if (token === 'Bearer owner')
      return {
        personId: 'owner',
        clientId: 'desktop-owner',
        role: 'owner' as const,
        capability: 'controlCapable' as const,
      }
    if (token === 'Bearer member')
      return {
        personId: 'member',
        clientId: 'desktop-member',
        role: 'viewer' as const,
        capability: 'controlCapable' as const,
      }
    if (token === 'Bearer friend')
      return {
        personId: 'friend',
        clientId: 'desktop-friend',
        role: 'viewer' as const,
        capability: 'controlCapable' as const,
      }
    if (token === 'Bearer phone')
      return {
        personId: 'owner',
        clientId: 'phone-owner',
        role: 'owner' as const,
        capability: 'readOnly' as const,
      }
    return undefined
  })
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const owner = { authorization: 'Bearer owner' }
  const member = { authorization: 'Bearer member' }
  const friend = { authorization: 'Bearer friend' }
  const submit = async (command: unknown, headers: HeadersInit) => {
    const response = await fetch(`${base}/api/commands/control`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ commandId: crypto.randomUUID(), command }),
    })
    return { response, body: await response.json() }
  }
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const stream = await fetch(`${base}/api/events`, { headers: owner })
  const reader = stream.body?.getReader()
  await nextEvent(reader)
  const beforeRejectedRequest = await bootstrapSnapshot(
    `${base}/api/snapshot`,
    {
      headers: owner,
    },
  )
  const currentHolder = await submit(
    {
      _tag: 'RequestControl',
      expectedLeaseRevision: 1,
      idempotencyKey: 'owner-request',
    },
    owner,
  )
  assert.equal(currentHolder.response.status, 403)
  const currentHolderFailure = Schema.decodeUnknownSync(
    CommandHttpFailureEnvelope,
  )(currentHolder.body)
  if (currentHolderFailure.failure._tag !== 'CommandRejected')
    throw new Error('Current holder request did not reject')
  if (currentHolderFailure.failure.failure._tag !== 'AuthorizationFailure')
    throw new Error('Current holder request used the wrong failure')
  assert.equal(currentHolderFailure.failure.failure.reason, 'AlreadyController')
  const afterRejectedRequest = await bootstrapSnapshot(`${base}/api/snapshot`, {
    headers: owner,
  })
  assert.equal(
    afterRejectedRequest.snapshotVersion,
    beforeRejectedRequest.snapshotVersion,
  )
  assert.equal(
    afterRejectedRequest.eventCursor,
    beforeRejectedRequest.eventCursor,
  )
  const requested = await submit(
    {
      _tag: 'RequestControl',
      expectedLeaseRevision: 1,
      idempotencyKey: 'member-request',
    },
    member,
  )
  assert.equal(requested.response.status, 202)
  const requestSnapshot = Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(
    requested.body,
  ).data
  const pending = requestSnapshot.control.pendingRequests?.[0]
  if (pending === undefined) throw new Error('Control request is unavailable')
  assert.equal(pending.clientId, 'desktop-member')
  assert.equal(Date.parse(pending.expiresAt) > Date.now(), true)
  assert.equal(
    databaseRow(
      Schema.Struct({ target_control_capable: Schema.Int }),
      service.database
        .prepare(
          'SELECT target_control_capable FROM control_requests WHERE request_id=?',
        )
        .get(pending.requestId),
    ).target_control_capable,
    1,
  )
  assert.match(await nextEvent(reader), /ProjectionChanged/)
  const duplicate = await submit(
    {
      _tag: 'RequestControl',
      expectedLeaseRevision: 1,
      idempotencyKey: 'member-request-duplicate',
    },
    member,
  )
  assert.equal(duplicate.response.status, 403)
  const duplicateFailure = Schema.decodeUnknownSync(CommandHttpFailureEnvelope)(
    duplicate.body,
  )
  if (duplicateFailure.failure._tag !== 'CommandRejected')
    throw new Error('Duplicate control request did not reject')
  if (duplicateFailure.failure.failure._tag !== 'AuthorizationFailure')
    throw new Error('Duplicate control request used the wrong failure')
  assert.equal(
    duplicateFailure.failure.failure.reason,
    'ControlRequestAlreadyPending',
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare('SELECT count(*) AS count FROM control_command_receipts')
        .get(),
    ).count,
    1,
  )
  const friendRequested = await submit(
    {
      _tag: 'RequestControl',
      expectedLeaseRevision: 1,
      idempotencyKey: 'friend-request-for-grant',
    },
    friend,
  )
  const friendPending = Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(
    friendRequested.body,
  ).data.control.pendingRequests?.find(
    (request) => request.clientId === 'desktop-friend',
  )
  if (friendPending === undefined)
    throw new Error('Friend control request is unavailable')
  assert.match(await nextEvent(reader), /desktop-friend/)
  const conflict = await submit(
    {
      _tag: 'TakeControl',
      expectedLeaseRevision: 1,
      idempotencyKey: 'member-request',
    },
    member,
  )
  assert.equal(conflict.response.status, 409)
  const mismatch = await submit(
    {
      _tag: 'GrantControl',
      expectedLeaseRevision: 1,
      requestId: pending.requestId,
      targetClientId: 'desktop-other',
      idempotencyKey: 'grant-mismatch',
    },
    owner,
  )
  assert.equal(mismatch.response.status, 409)
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM events').get(),
    ).count,
    2,
  )
  const granted = await submit(
    {
      _tag: 'GrantControl',
      expectedLeaseRevision: 1,
      requestId: pending.requestId,
      targetClientId: pending.clientId,
      idempotencyKey: 'grant-member',
    },
    owner,
  )
  assert.equal(granted.response.status, 202)
  assert.equal(
    Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(granted.body).data
      .control.holderClientId,
    'desktop-member',
  )
  assert.deepEqual(
    Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(granted.body).data
      .control.pendingRequests,
    [],
  )
  assert.doesNotMatch(await nextEvent(reader), /desktop-friend/)
  const staleGrant = await submit(
    {
      _tag: 'GrantControl',
      expectedLeaseRevision: 2,
      requestId: friendPending.requestId,
      targetClientId: friendPending.clientId,
      idempotencyKey: 'grant-stale-friend',
    },
    owner,
  )
  assert.equal(staleGrant.response.status, 409)
  const friendRequestedForRelease = await submit(
    {
      _tag: 'RequestControl',
      expectedLeaseRevision: 2,
      idempotencyKey: 'friend-request-for-release',
    },
    friend,
  )
  assert.equal(friendRequestedForRelease.response.status, 202)
  const oldController = await submit(
    {
      _tag: 'ReleaseControl',
      expectedLeaseRevision: 2,
      idempotencyKey: 'old-release',
    },
    owner,
  )
  assert.equal(oldController.response.status, 403)
  const released = await submit(
    {
      _tag: 'ReleaseControl',
      expectedLeaseRevision: 2,
      idempotencyKey: 'member-release',
    },
    member,
  )
  assert.equal(released.response.status, 202)
  assert.deepEqual(
    databaseRow(
      Schema.Struct({ type: Schema.String, snapshot: Schema.String }),
      service.database
        .prepare(
          'SELECT type,snapshot FROM events ORDER BY cursor DESC LIMIT 1',
        )
        .get(),
    ),
    {
      type: 'ControlReleased',
      snapshot: JSON.stringify({
        _tag: 'ControlReleased',
        previousHolderClientId: 'desktop-member',
      }),
    },
  )
  assert.deepEqual(
    Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(released.body).data
      .control.pendingRequests,
    [],
  )
  const friendRequestedForTake = await submit(
    {
      _tag: 'RequestControl',
      expectedLeaseRevision: 3,
      idempotencyKey: 'friend-request-for-take',
    },
    friend,
  )
  assert.equal(friendRequestedForTake.response.status, 202)
  const ownerTake = await submit(
    {
      _tag: 'TakeControl',
      expectedLeaseRevision: 3,
      idempotencyKey: 'member-release',
    },
    owner,
  )
  assert.equal(ownerTake.response.status, 202)
  assert.deepEqual(
    Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(ownerTake.body).data
      .control.pendingRequests,
    [],
  )
  const requestedForDecline = await submit(
    {
      _tag: 'RequestControl',
      expectedLeaseRevision: 4,
      idempotencyKey: 'member-decline-request',
    },
    member,
  )
  const declinedPending = Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(
    requestedForDecline.body,
  ).data.control.pendingRequests?.[0]
  if (declinedPending === undefined)
    throw new Error('Decline request is unavailable')
  const retainedRequest = await submit(
    {
      _tag: 'RequestControl',
      expectedLeaseRevision: 4,
      idempotencyKey: 'friend-request-for-decline',
    },
    friend,
  )
  assert.equal(retainedRequest.response.status, 202)
  const declined = await submit(
    {
      _tag: 'DeclineControl',
      expectedLeaseRevision: 4,
      requestId: declinedPending.requestId,
      idempotencyKey: 'owner-decline',
    },
    owner,
  )
  assert.equal(declined.response.status, 202)
  assert.deepEqual(
    databaseRow(
      Schema.Struct({ type: Schema.String, snapshot: Schema.String }),
      service.database
        .prepare(
          'SELECT type,snapshot FROM events ORDER BY cursor DESC LIMIT 1',
        )
        .get(),
    ),
    {
      type: 'ControlDeclined',
      snapshot: JSON.stringify({
        _tag: 'ControlDeclined',
        requestId: declinedPending.requestId,
      }),
    },
  )
  assert.deepEqual(
    Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(
      declined.body,
    ).data.control.pendingRequests?.map((request) => request.clientId),
    ['desktop-friend'],
  )
  const stale = await submit(
    {
      _tag: 'ReleaseControl',
      expectedLeaseRevision: 3,
      idempotencyKey: 'stale-release',
    },
    owner,
  )
  assert.equal(stale.response.status, 409)
  const phone = await submit(
    {
      _tag: 'TakeControl',
      expectedLeaseRevision: 4,
      idempotencyKey: 'phone-take',
    },
    { authorization: 'Bearer phone' },
  )
  assert.equal(phone.response.status, 403)
  const replay = await submit(
    {
      _tag: 'TakeControl',
      expectedLeaseRevision: 3,
      idempotencyKey: 'member-release',
    },
    owner,
  )
  assert.equal(replay.response.status, 200)
  const controlEvents = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({ type: Schema.String, snapshot: Schema.String }),
    ),
  )(
    service.database
      .prepare(
        "SELECT type,snapshot FROM events WHERE type IN ('ControlRequested','ControlGranted','ControlDeclined','ControlReleased','OwnerTookControl') ORDER BY cursor",
      )
      .all(),
  )
  assert.deepEqual(
    controlEvents.map(
      (row) =>
        Schema.decodeUnknownSync(DomainEvent)(JSON.parse(row.snapshot))._tag,
    ),
    controlEvents.map((row) => row.type),
  )
  await reader?.cancel()
  await listener.close()
  service.close()
  const recovered = createFixtureService(databasePath, () => ({
    personId: 'owner',
    clientId: 'desktop-owner',
    role: 'owner' as const,
    capability: 'controlCapable' as const,
  }))
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const recoveredSnapshot = await bootstrapSnapshot(
    `http://127.0.0.1:${recoveredListener.port}/api/snapshot`,
  )
  assert.equal(recoveredSnapshot.control.holderClientId, 'desktop-owner')
  assert.deepEqual(
    recoveredSnapshot.control.pendingRequests?.map(
      (request) => request.clientId,
    ),
    ['desktop-friend'],
  )
})

test('reconnect lease expiry records the canonical control event once', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const before = databaseRow(
    CountRow,
    service.database.prepare('SELECT count(*) AS count FROM events').get(),
  ).count
  const beforeSnapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  const update = service.database.prepare(
    'UPDATE state SET value=? WHERE key=?',
  )
  update.run(JSON.stringify('desktop-member'), 'leaseHolder')
  update.run(JSON.stringify('reconnecting'), 'leaseState')
  update.run(JSON.stringify(new Date(0).toISOString()), 'reconnectGraceUntil')
  const afterSnapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  const event = databaseRow(
    Schema.Struct({ type: Schema.String, snapshot: Schema.String }),
    service.database
      .prepare('SELECT type,snapshot FROM events ORDER BY cursor DESC LIMIT 1')
      .get(),
  )
  assert.equal(event.type, 'ControlLeaseExpired')
  assert.deepEqual(
    Schema.decodeUnknownSync(DomainEvent)(JSON.parse(event.snapshot)),
    {
      _tag: 'ControlLeaseExpired',
      previousHolderClientId: 'desktop-member',
    },
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM events').get(),
    ).count,
    before + 1,
  )
  assert.equal(afterSnapshot.eventCursor, beforeSnapshot.eventCursor + 1)
})

test('expired control requests are removed before projection and grant', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-control-request-expiry-')),
    'state.sqlite',
  )
  const admission = (request?: Pick<IncomingMessage, 'headers'>) =>
    request?.headers.authorization === 'Bearer member'
      ? {
          personId: 'member',
          clientId: 'desktop-member',
          role: 'viewer' as const,
          capability: 'controlCapable' as const,
        }
      : {
          personId: 'owner',
          clientId: 'desktop-owner',
          role: 'owner' as const,
          capability: 'controlCapable' as const,
        }
  const service = createFixtureService(databasePath, admission)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const requested = Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(
    await fetch(`${base}/api/commands/control`, {
      method: 'POST',
      headers: { authorization: 'Bearer member' },
      body: JSON.stringify({
        commandId: 'expired-request',
        command: {
          _tag: 'RequestControl',
          expectedLeaseRevision: 1,
          idempotencyKey: 'expired-request',
        },
      }),
    }).then((response) => response.json()),
  )
  const pending = requested.data.control.pendingRequests?.[0]
  if (pending === undefined) throw new Error('Control request is unavailable')
  service.database
    .prepare(
      'UPDATE control_requests SET target_control_capable=0 WHERE request_id=?',
    )
    .run(pending.requestId)
  const beforeUnavailableGrant = requested.data.eventCursor
  const unavailableGrant = await fetch(`${base}/api/commands/control`, {
    method: 'POST',
    body: JSON.stringify({
      commandId: 'unavailable-target-grant',
      command: {
        _tag: 'GrantControl',
        expectedLeaseRevision: requested.data.control.revision,
        requestId: pending.requestId,
        targetClientId: pending.clientId,
        idempotencyKey: 'unavailable-target-grant',
      },
    }),
  })
  assert.equal(unavailableGrant.status, 409)
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).eventCursor,
    beforeUnavailableGrant,
  )
  service.database
    .prepare(
      'UPDATE control_requests SET target_control_capable=1,expires_at=? WHERE request_id=?',
    )
    .run('2000-01-01T00:00:00.000Z', pending.requestId)
  const projected = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.deepEqual(projected.control.pendingRequests, [])
  const beforeGrant = projected.eventCursor
  const rejected = await fetch(`${base}/api/commands/control`, {
    method: 'POST',
    body: JSON.stringify({
      commandId: 'expired-grant',
      command: {
        _tag: 'GrantControl',
        expectedLeaseRevision: projected.control.revision,
        requestId: pending.requestId,
        targetClientId: pending.clientId,
        idempotencyKey: 'expired-grant',
      },
    }),
  })
  assert.equal(rejected.status, 409)
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).eventCursor,
    beforeGrant,
  )
  await listener.close()
  service.close()
  const recovered = createFixtureService(databasePath, admission)
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  assert.deepEqual(
    (
      await bootstrapSnapshot(
        `http://127.0.0.1:${recoveredListener.port}/api/snapshot`,
      )
    ).control.pendingRequests,
    [],
  )
})

test('Plan command preview responses preserve persisted notice and disruptive domain results', async (t) => {
  const service = createLocalWebService(
    ':memory:',
    undefined,
    undefined,
    undefined,
    { fixture: 'plan-draft' },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (initial.plan === undefined) throw new Error('Fixture Plan is unavailable')
  const saved = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'SaveDraft',
        planId: initial.plan.planId,
        expectedPlanRevision: initial.plan.revision,
        idempotencyKey: 'plan-preview-save',
        sequences: initial.plan.sequences.map(
          ({ viability: _viability, ...sequence }) =>
            revisePlanSequence(sequence, {
              targetName: `${sequence.definition.targetName} revised`,
            }),
        ),
      },
    }),
  })
  assert.equal(saved.status, 202)
  const savedSnapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (savedSnapshot.plan === undefined)
    throw new Error('Saved fixture Plan is unavailable')
  const accepted = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'AcceptRunDefinition',
        planId: savedSnapshot.plan.planId,
        expectedPlanRevision: savedSnapshot.plan.revision,
        expectedLeaseRevision: savedSnapshot.control.revision,
        idempotencyKey: 'plan-preview-accept',
      },
    }),
  })
  assert.equal(accepted.status, 202)
  const acceptedSnapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (acceptedSnapshot.plan === undefined)
    throw new Error('Accepted fixture Plan is unavailable')
  const started = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'StartAcceptedRun',
        planId: acceptedSnapshot.plan.planId,
        expectedPlanRevision: acceptedSnapshot.plan.revision,
        expectedLeaseRevision: acceptedSnapshot.control.revision,
        idempotencyKey: 'plan-preview-start',
      },
    }),
  })
  assert.equal(started.status, 202)
  const active = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (active.activeRun._tag !== 'Active')
    throw new Error('Expected an active fake run')
  for (const expected of [
    {
      mutation: 'shortenSecond' as const,
      classification: 'notice' as const,
      approvalRequired: false,
    },
    {
      mutation: 'discardCurrent' as const,
      classification: 'disruptive' as const,
      approvalRequired: true,
    },
  ]) {
    const response: Response = await fetch(`${base}/api/plan/commands`, {
      method: 'POST',
      body: JSON.stringify({
        intent: {
          _tag: 'PreviewRunMutation',
          mutation: expected.mutation,
          expectedLeaseRevision: active.control.revision,
          expectedRunRevision: active.activeRun.run.revision,
          idempotencyKey: `plan-preview-${expected.classification}`,
        },
      }),
    })
    assert.equal(response.status, 202)
    const body = Schema.decodeUnknownSync(PlanCommandResponse)(
      await response.json(),
    )
    assert.equal(body._tag, 'Accepted')
    if (body._tag !== 'Accepted' || body.result._tag !== 'RunMutationPreviewed')
      throw new Error('Expected a mapped mutation preview result')
    assert.equal(body.result.classification, expected.classification)
    assert.equal(body.result.approvalRequired, expected.approvalRequired)
    assert.notEqual(body.result.previewId, '')
    assert.notEqual(body.result.consequences, '')
    assert.notEqual(body.result.expiresAt, '')
    assert.equal(
      expected.approvalRequired,
      body.result.approvalToken !== undefined,
    )
    const persisted = databaseRow(
      Schema.Struct({
        preview_id: Schema.String,
        classification: Schema.String,
        consequences: Schema.String,
        expires_at: Schema.String,
      }),
      service.database
        .prepare(
          'SELECT preview_id,classification,consequences,expires_at FROM run_mutation_previews WHERE preview_id=?',
        )
        .get(body.result.previewId),
    )
    assert.equal(persisted.preview_id, body.result.previewId)
    assert.equal(persisted.classification, body.result.classification)
    assert.equal(persisted.consequences, body.result.consequences)
    assert.equal(persisted.expires_at, body.result.expiresAt)
    assert.equal(
      body.snapshot.plan?.runMutationPreview?.previewId,
      body.result.previewId,
    )
  }
})

test('later drafts retain the latest accepted definition summary without making it current', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (initial.plan === undefined) throw new Error('Fixture Plan is unavailable')
  const saved = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'SaveDraft',
        planId: initial.plan.planId,
        expectedPlanRevision: initial.plan.revision,
        idempotencyKey: 'later-draft',
        sequences: initial.plan.sequences.map((sequence) =>
          revisePlanSequence(sequence, {
            targetName: `${sequence.definition.targetName} revised`,
          }),
        ),
      },
    }),
  })
  assert.equal(saved.status, 202)
  const later = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(later.plan?.revision, initial.plan.revision + 1)
  assert.equal(
    later.plan?.acceptedRunDefinition?.id,
    'run-definition-m27-fixture',
  )
  assert.equal(
    later.plan?.acceptedRunDefinition?.sourcePlanRevision,
    initial.plan.revision,
  )
  assert.deepEqual(later.plan?.actions?.startAcceptedRun, {
    _tag: 'Ineligible',
    reason: 'acceptedDefinitionRequired',
  })
})

test('malformed persisted Plan execution data returns a bounded unavailable response', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (snapshot.plan === undefined)
    throw new Error('Fixture Plan is unavailable')
  service.database.prepare('UPDATE run_definitions SET definition=?').run('{')
  const response = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'StartAcceptedRun',
        planId: snapshot.plan.planId,
        expectedPlanRevision: snapshot.plan.revision,
        expectedLeaseRevision: snapshot.control.revision,
        idempotencyKey: 'malformed-definition',
      },
    }),
  })
  assert.equal(response.status, 503)
  const unavailable = Schema.decodeUnknownSync(PlanCommandResponse)(
    await response.json(),
  )
  assert.equal(unavailable._tag, 'Unavailable')
  assert.equal((await fetch(`${base}/health/live`)).status, 200)
})

function first<Value>(values: ReadonlyArray<Value>) {
  const value = values[0]
  assert.ok(value !== undefined)
  return value
}

const CountRow = Schema.Struct({ count: Schema.Int })
const ProjectionRow = Schema.Struct({ value: Schema.String })
const RunDefinitionEvidenceRow = Schema.Struct({ definition: Schema.String })
const PublicationRow = Schema.Struct({ object_key: Schema.String })
const PlateSolveEvidenceRow = Schema.Struct({ evidence: Schema.String })
const AcquireSessionRow = Schema.Struct({ session: Schema.String })

function databaseRow<Row>(
  schema: Schema.Schema<Row> & Schema.ConstraintDecoder<unknown>,
  row: unknown,
): Row {
  return Schema.decodeUnknownSync(schema)(row)
}

async function nextEvent(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
) {
  assert.ok(reader !== undefined)
  const event = await reader.read()
  assert.ok(event.value !== undefined)
  return new TextDecoder().decode(event.value)
}

test('Processing Project HTTP accepts explicit Project changes and exposes settled evidence', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-stage-publication-'))
  const service = createLocalWebService(
    join(root, 'state.sqlite'),
    undefined,
    undefined,
    undefined,
    {
      fixture: 'm27',
      processWorkRoot: root,
      processWorkAutoRun: false,
    },
  )
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const base = `http://127.0.0.1:${listener.port}`
  const malformedResponse = await fetch(`${base}/api/process/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(malformedResponse.status, 400)
  assert.deepEqual(await malformedResponse.json(), {
    _tag: 'InvalidInput',
    message: 'The service could not read the Processing Project request.',
  })
  const oversizedResponse = await fetch(`${base}/api/process/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload: 'x'.repeat(16_385) }),
  })
  assert.equal(oversizedResponse.status, 413)
  assert.deepEqual(await oversizedResponse.json(), {
    _tag: 'RequestTooLarge',
    message: 'The Processing Project request is too large.',
  })
  const createdResponse = await fetch(`${base}/api/process/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'HTTP lifecycle proof',
      selection: { assetIds: [], captureSetIds: ['m27-stack-1'] },
      intentId: 'http-project-create',
    }),
  })
  assert.equal(createdResponse.status, 201)
  const created = Schema.decodeUnknownSync(ProcessingProjectChanged)(
    await createdResponse.json(),
  )
  const acceptedResponse = await fetch(
    `${base}/api/process/projects/${created.project.projectId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: created.project.projectId,
        expectedProjectRevision: created.project.revision,
        intentId: 'http-calibration-run',
        intent: {
          _tag: 'RunStage',
          stage: 'Calibration',
          from: { _tag: 'CurrentDraft' },
        },
      }),
    },
  )
  assert.equal(acceptedResponse.status, 200)
  const accepted = Schema.decodeUnknownSync(ProcessingProjectChanged)(
    await acceptedResponse.json(),
  )
  assert.equal(accepted.project.activeAttempt?.state, 'Queued')
  assert.deepEqual(service.processWorkPass(), {
    outcome: 'completed',
    kind: 'projectStage',
  })
  const opened = Schema.decodeUnknownSync(OpenedProcessingProject)(
    await fetch(
      `${base}/api/process/projects/${created.project.projectId}`,
    ).then((response) => response.json()),
  )
  assert.equal(
    opened.stages.find((stage) => stage.stage === 'Calibration')?.currentResult
      ?.outcome,
    'Succeeded',
  )
  const evidence = Schema.decodeUnknownSync(ProcessingProjectEvidence)(
    await fetch(
      `${base}/api/process/projects/${created.project.projectId}/evidence`,
    ).then((response) => response.json()),
  )
  assert.equal(evidence.attempts[0]?.state, 'succeeded')
  assert.equal(evidence.attempts[0]?.outputs[0]?.relation, 'WorkingResult')
})

test('fresh SQLite initialization creates the current V2 tables', () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-fresh-schema-')),
    'state.sqlite',
  )
  const service = createLocalWebService(databasePath)
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare(
          "SELECT count(*) AS count FROM pragma_table_info('outbox') WHERE name IN ('claim_token','claimed_by','claim_until','attempts','last_error','retry_after','ack_at')",
        )
        .get(),
    ).count,
    7,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare(
          "SELECT count(*) AS count FROM pragma_table_info('observing_plans') WHERE name='run_eligible'",
        )
        .get(),
    ).count,
    1,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
        )
        .get(),
    ).count,
    0,
  )
  service.close()
})

test('app-owned SQLite opener rejects paths outside its root with a tagged error', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-app-owned-root-'))
  assert.throws(
    () => openAppOwnedDatabase('/tmp/not-astro.sqlite', `${root}/`),
    (error: unknown) =>
      error instanceof DatabasePathNotAppOwned &&
      error._tag === 'Database.PathNotAppOwned',
  )
})

test('origin admission factory consumes decoded configuration', async (t) => {
  const config = await Effect.runPromise(
    originServerConfig.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ ASTRO_SERVER_CLIENT: 'phone' }),
        ),
      ),
    ),
  )
  const identity = createOriginAdmission(config)()
  assert.deepEqual(identity, {
    personId: 'owner-chicks',
    clientId: 'phone-monitor',
    capability: 'readOnly',
    role: 'owner',
  })
  const service = createFixtureService()
  const listener = await service.listen(0)
  t.after(async () => {
    await listener.close()
    service.close()
  })
  assert.ok(listener.port > 0)
})

test('origin configuration enables the real preflight adapter only with complete Alpaca values', async () => {
  const config = await Effect.runPromise(
    originServerConfig.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            ASTRO_PREFLIGHT_PROVIDER: 'alpaca',
            ASTRO_PREFLIGHT_ALPACA_RIG_ID: 'seestar-indoor',
            ASTRO_PREFLIGHT_ALPACA_HOST: '192.168.4.63',
            ASTRO_PREFLIGHT_ALPACA_PORT: '32323',
            ASTRO_PREFLIGHT_RIG_LATITUDE_DEGREES: '39.755',
            ASTRO_PREFLIGHT_RIG_LONGITUDE_DEGREES: '-74.2677777778',
            ASTRO_PREFLIGHT_RIG_ELEVATION_METERS: '12.5',
            ASTRO_PREFLIGHT_ALPACA_TELESCOPE_DEVICE_NUMBER: '0',
            ASTRO_PREFLIGHT_ALPACA_TELESCOPE_UNIQUE_ID: 'scope-001',
            ASTRO_PREFLIGHT_ALPACA_CAMERA_DEVICE_NUMBER: '0',
            ASTRO_PREFLIGHT_ALPACA_CAMERA_UNIQUE_ID: 'camera-001',
          }),
        ),
      ),
    ),
  )
  assert.deepEqual(config.preflightProvider, {
    kind: 'alpaca',
    rigId: 'seestar-indoor',
    host: '192.168.4.63',
    port: 32323,
    site: {
      latitudeDegrees: 39.755,
      longitudeDegrees: -74.2677777778,
      elevationMeters: 12.5,
    },
    devices: {
      camera: { deviceNumber: 0, uniqueId: 'camera-001' },
      telescope: { deviceNumber: 0, uniqueId: 'scope-001' },
    },
  })
  const incomplete = await Effect.runPromiseExit(
    originServerConfig.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ ASTRO_PREFLIGHT_PROVIDER: 'alpaca' }),
        ),
      ),
    ),
  )
  assert.equal(incomplete._tag, 'Failure')
})

test('operational endpoints expose bounded admitted health without internal detail', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  assert.deepEqual(
    await fetch(`${base}/health/live`).then((response) => response.json()),
    { status: 'alive' },
  )
  const ready = await fetch(`${base}/api/health/ready`).then((response) =>
    response.json(),
  )
  assert.deepEqual(ready, {
    status: 'ready',
    service: 'ready',
    database: 'ready',
    rig: 'unknown',
    tunnel: 'unknown',
    activeRun: 'none',
    message:
      'Service and local database are ready; rig and tunnel are not connected in this fixture.',
  })
  const operations = await fetch(`${base}/api/health/operations`).then(
    (response) => response.json(),
  )
  assert.equal(operations.release, 'server')
  assert.equal(operations.schemaVersion, 'current')
  assert.equal(operations.sqlite.journalMode, 'wal')
  assert.equal(operations.disk, 'unknown')
  assert.equal(operations.rig, 'unknown')
  assert.equal(JSON.stringify(operations).includes('/'), false)
  const denied = createFixtureService(':memory:', () => ({
    personId: 'viewer',
    clientId: 'viewer',
    capability: 'readOnly',
  }))
  const deniedListener = await denied.listen()
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:${deniedListener.port}/api/health/operations`,
      )
    ).status,
    403,
  )
  assert.equal(
    (await fetch(`http://127.0.0.1:${deniedListener.port}/api/health/ready`))
      .status,
    200,
  )
  await deniedListener.close()
  denied.close()
})

test('production admission rechecks normalized bootstrap policy and revokes removed viewer subjects', async () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-production-access-')),
    'state.sqlite',
  )
  const seeded = createFixtureService(databasePath)
  seeded.close()
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const issuer = 'https://access.example'
  const audience = 'audience'
  const claim = (email: string) => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid: 'viewer-key' }),
    ).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'viewer-subject',
        email,
        iss: issuer,
        aud: audience,
        exp: Math.floor(Date.now() / 1_000) + 60,
      }),
    ).toString('base64url')
    return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`
  }
  const jwksOutcomes: Array<string> = []
  const admissionReasons: Array<string> = []
  const keyResolver = createJwksKeyResolver({
    url: 'https://access.example/certs',
    fetcher: async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          keys: [
            {
              ...keys.publicKey.export({ format: 'jwk' }),
              kid: 'viewer-key',
              use: 'sig',
            },
          ],
        }),
    }),
    observe: (outcome) => jwksOutcomes.push(outcome),
  })
  const config = {
    issuer,
    audience,
    keyResolver,
    databasePath,
    clientContext: 'desktop' as const,
    bootstrap: [
      {
        email: ' Viewer@Example.com ',
        personId: 'viewer',
        role: 'viewer' as const,
      },
    ],
    observe: (reason) => admissionReasons.push(reason),
  } satisfies Parameters<typeof createProductionAccessAdmission>[0]
  const admitted = createProductionAccessAdmission(config)
  const request = {
    headers: { 'cf-access-jwt-assertion': claim('viewer@example.com') },
  }
  assert.deepEqual(await admitted(request), {
    personId: 'viewer',
    clientId: 'access:viewer-subject',
    capability: 'readOnly',
    role: 'viewer',
  })
  assert.equal(
    databaseRow(
      CountRow,
      new DatabaseSync(databasePath)
        .prepare(
          "SELECT count(*) AS count FROM memberships WHERE external_subject='viewer-subject'",
        )
        .get(),
    ).count,
    1,
  )
  const revoked = createProductionAccessAdmission({ ...config, bootstrap: [] })
  assert.equal(await revoked(request), undefined)
  assert.equal(await admitted({ headers: {} }), undefined)
  assert.deepEqual(jwksOutcomes, ['success'])
  assert.deepEqual(admissionReasons, [
    'admitted',
    'notMember',
    'missingOrInvalidToken',
  ])
  const bootstrap = first(config.bootstrap)
  assert.throws(
    () =>
      createProductionAccessAdmission({
        ...config,
        bootstrap: [
          { ...bootstrap },
          { ...bootstrap, email: 'viewer@example.com' },
        ],
      }),
    /unique/,
  )
})

test('production admission reloads a removed membership bootstrap file before the next interval', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'astro-bootstrap-reload-'))
  const databasePath = join(directory, 'state.sqlite')
  const bootstrapPath = join(directory, 'membership.json')
  const seeded = createFixtureService(databasePath)
  seeded.close()
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const issuer = 'https://access.example'
  const audience = 'bootstrap-audience'
  let now = 1_000
  writeFileSync(
    bootstrapPath,
    JSON.stringify([
      { email: 'owner@example.com', personId: 'reload-owner', role: 'owner' },
    ]),
  )
  const keyResolver = createJwksKeyResolver({
    url: 'https://access.example/certs',
    fetcher: async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          keys: [
            {
              ...keys.publicKey.export({ format: 'jwk' }),
              kid: 'reload-key',
              use: 'sig',
            },
          ],
        }),
    }),
  })
  const admission = createProductionAccessAdmission({
    issuer,
    audience,
    keyResolver,
    databasePath,
    clientContext: 'desktop',
    bootstrapResolver: createMembershipBootstrapResolver({
      path: bootstrapPath,
      now: () => now,
    }),
  })
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'reload-key' }),
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'reload-subject',
      email: 'owner@example.com',
      iss: issuer,
      aud: audience,
      exp: Math.floor(Date.now() / 1_000) + 60,
    }),
  ).toString('base64url')
  const token = `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`
  const request = {
    headers: { 'cf-access-jwt-assertion': token },
  }
  assert.equal((await admission(request))?.personId, 'reload-owner')
  unlinkSync(bootstrapPath)
  now += 1_000
  assert.equal(await admission(request), undefined)
})

test('production Access JWKS admission refreshes by kid, bounds cache use, and fails closed', async () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-jwks-')),
    'state.sqlite',
  )
  const seeded = createFixtureService(databasePath)
  seeded.close()
  const oldKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const newKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const issuer = 'https://access.example'
  const audience = 'jwks-audience'
  let now = 1_000
  let calls = 0
  let document = {
    keys: [
      {
        ...oldKeys.publicKey.export({ format: 'jwk' }),
        kid: 'old-kid',
        use: 'sig',
      },
    ],
  }
  const resolver = createJwksKeyResolver({
    url: 'https://access.example/cdn-cgi/access/certs',
    cacheTtlMs: 1_000,
    now: () => now,
    fetcher: async () => {
      calls += 1
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(document),
      }
    },
  })
  const claim = (kid: string, keys: ReturnType<typeof generateKeyPairSync>) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString(
      'base64url',
    )
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'rotation-subject',
        email: 'owner@example.com',
        iss: issuer,
        aud: audience,
        exp: Math.floor(Date.now() / 1_000) + 60,
      }),
    ).toString('base64url')
    return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`
  }
  const admission = createProductionAccessAdmission({
    issuer,
    audience,
    keyResolver: resolver,
    databasePath,
    clientContext: 'desktop',
    bootstrap: [
      { email: 'owner@example.com', personId: 'rotating-owner', role: 'owner' },
    ],
  })
  const request = (token: string) => ({
    headers: { 'cf-access-jwt-assertion': token },
  })
  assert.equal(
    (await admission(request(claim('old-kid', oldKeys))))?.personId,
    'rotating-owner',
  )
  assert.equal(calls, 1)
  document = {
    keys: [
      {
        ...newKeys.publicKey.export({ format: 'jwk' }),
        kid: 'new-kid',
        use: 'sig',
      },
    ],
  }
  assert.equal(
    (await admission(request(claim('new-kid', newKeys))))?.personId,
    'rotating-owner',
  )
  assert.equal(calls, 2)
  assert.equal(await admission(request(claim('old-kid', oldKeys))), undefined)
  assert.equal(calls, 3)
  assert.equal(
    await admission(request(claim('unknown-kid', newKeys))),
    undefined,
  )
  assert.equal(calls, 4)
  assert.equal(
    await admission(request(claim('unknown-kid', newKeys))),
    undefined,
  )
  assert.equal(calls, 4)
  now += 1_000
  document = { keys: [] }
  assert.equal(await admission(request(claim('new-kid', newKeys))), undefined)
  assert.equal(calls, 5)
  const missingKid = claim('new-kid', newKeys).replace(
    /eyJhbGciOiJSUzI1NiIsImtpZCI6Im5ldy1raWQifQ/,
    Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
  )
  assert.equal(await admission(request(missingKid)), undefined)
  assert.equal(calls, 5)
})

test('persisted exhausted correction keeps evidence visible without issuing work and projects over SSE', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const evidence = {
    frameId: 'frame-m27-042',
    capturedAt: '2026-07-23T03:12:00.000Z',
    quality: 'warning',
    desired: 'M27 center',
    solved: 'M27 center + 46 arcsec',
    uncertaintyArcsec: 7.1,
    correction: {
      state: 'exhausted',
      evidence:
        'Three solve-guided corrections did not return M27 within the framing bound.',
      bound:
        'Correction budget 3 of 3 exhausted; 46 arcsec exceeds the 30 arcsec bound.',
      protection:
        'Accepted capture is protected; no automatic correction or hardware command was issued.',
      action: 'Review recovery in Observe before any new command.',
    },
  }
  service.database
    .prepare("UPDATE state SET value=? WHERE key='evidence'")
    .run(JSON.stringify(evidence))
  service.database
    .prepare("UPDATE state SET value=? WHERE key='snapshotVersion'")
    .run('2')
  service.database
    .prepare("UPDATE state SET value=? WHERE key='eventCursor'")
    .run('1')
  const changed = await Promise.race([
    reader?.read(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('missing exhausted evidence projection')),
        2_000,
      ),
    ),
  ])
  const projected = new TextDecoder().decode(changed?.value)
  assert.match(projected, /ProjectionChanged/)
  const persisted = JSON.parse(
    databaseRow(
      ProjectionRow,
      service.database
        .prepare("SELECT value FROM state WHERE key='evidence'")
        .get(),
    ).value,
  )
  assert.equal(persisted.frameId, 'frame-m27-042')
  assert.equal(persisted.correction.state, 'exhausted')
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    0,
  )
  await reader?.cancel()
  await listener.close()
  service.close()
})

test('decoded adapter observation updates service evidence and malformed input fails closed', () => {
  const service = createFixtureService()
  const accepted = service.ingestObservation({
    frameId: 'frame-adapter-001',
    capturedAt: '2026-07-24T02:00:00.000Z',
    quality: 'verified',
    desired: 'M27 center',
    solved: 'M27 center + 8 arcsec',
    uncertaintyArcsec: 2.5,
    correctionState: 'automatic',
    correctionEvidence: 'Adapter solve accepted.',
    correctionBound: '8 arcsec within 30 arcsec bound.',
    protection: 'No operator action required.',
  })
  assert.equal(accepted?.evidence.frameId, 'frame-adapter-001')
  const before = JSON.stringify(accepted?.evidence)
  assert.equal(
    service.ingestObservation({ frameId: '', correctionState: 'automatic' }),
    undefined,
  )
  assert.equal(
    JSON.stringify(
      service.ingestObservation({ frameId: '', correctionState: 'automatic' })
        ?.evidence,
    ),
    undefined,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    0,
  )
  assert.equal(
    JSON.stringify(
      service.database
        .prepare("SELECT value FROM state WHERE key='evidence'")
        .get(),
    ).includes('frame-adapter-001'),
    true,
  )
  assert.equal(before.includes('frame-adapter-001'), true)
  service.close()
})

test('local solved-frame evidence faithfully decodes as the V2 AcquireSnapshot contract', () => {
  const service = createFixtureService()
  const snapshot = service.ingestObservation({
    frameId: 'frame-contract-001',
    capturedAt: '2026-07-24T02:00:00.000Z',
    quality: 'verified',
    desired: 'M27 center',
    solved: 'M27 center + 8 arcsec',
    uncertaintyArcsec: 2.5,
    correctionState: 'automatic',
    correctionEvidence: 'Adapter solve accepted.',
    correctionBound: '8 arcsec within 30 arcsec bound.',
    protection: 'No operator action required.',
  })
  const evidence = snapshot?.evidence
  const contract = Schema.decodeUnknownSync(AcquireSnapshot)({
    revision: 1,
    mode: 'pointing',
    phase: 'verifying',
    recoverySeries: 0,
    attemptCount: 1,
    latestEvidence: {
      _tag: 'Solved',
      attemptId: 'attempt-m27-001',
      sourceFrameAssetId: evidence?.frameId,
      correction: {
        rightAscensionArcsec: 8,
        declinationArcsec: 0,
        convention: 'mountRaDec',
      },
      magnitudeArcsec: 8,
      uncertaintyArcsec: evidence?.uncertaintyArcsec,
    },
    attention: evidence?.correction.protection,
    actions: [],
  })
  assert.equal(contract.latestEvidence?._tag, 'Solved')
  assert.equal(
    contract.latestEvidence?.sourceFrameAssetId,
    'frame-contract-001',
  )
  service.close()
})

test('accepted paused local run faithfully decodes as the V2 RunSnapshot contract', () => {
  const contract = Schema.decodeUnknownSync(RunSnapshot)({
    runId: 'run-m27-001',
    revision: 2,
    sourcePlanId: 'plan-m27',
    phase: 'paused',
    completedSequenceCount: 0,
    acceptedMutations: [],
    warnings: [],
    lastConfirmedAt: '2026-07-24T02:00:00.000Z',
    actions: [],
  })
  assert.equal(contract.phase, 'paused')
  assert.equal(contract.revision, 2)
})

test('accepted terminal local run faithfully decodes as the V2 RunSnapshot contract', () => {
  const contract = Schema.decodeUnknownSync(RunSnapshot)({
    runId: 'run-m27-001',
    revision: 3,
    sourcePlanId: 'plan-m27',
    phase: 'stopped',
    completedSequenceCount: 0,
    acceptedMutations: [],
    warnings: [],
    lastConfirmedAt: '2026-07-24T02:00:00.000Z',
    actions: [],
  })
  assert.equal(contract.phase, 'stopped')
  assert.equal(contract.revision, 3)
})

test('Library queries enforce bounded pages, cursor order, role filters, and allowed sorts', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const first = await fetch(
    `${base}/api/library?queryId=library-check&pageSize=3&sort=sharpestFirst`,
  ).then((response) => response.json())
  assert.equal(first.results.length, 3)
  assert.equal(first.results[0].assetId, 'asset-m27-001')
  assert.deepEqual(first.results[0].review, { decision: 'unreviewed' })
  assert.equal('rating' in first.results[0].review, false)
  assert.equal(first.nextCursor, '3')
  const next = await fetch(
    `${base}/api/library?queryId=library-check&pageSize=3&cursor=${first.nextCursor}&sort=sharpestFirst`,
  ).then((response) => response.json())
  assert.equal(next.results[0].assetId, 'asset-m27-004')
  const originals = await fetch(
    `${base}/api/library?queryId=library-check&pageSize=5&role=original&sort=capturedAtDescending`,
  ).then((response) => response.json())
  assert.equal(
    originals.results.every(
      (asset: { role: string }) => asset.role === 'original',
    ),
    true,
  )
  const updated = await fetch(
    `${base}/api/library?queryId=library-check&pageSize=1&sort=recentlyUpdated`,
  ).then((response) => response.json())
  assert.equal(updated.results.length, 1)
  assert.equal(
    (await fetch(`${base}/api/library?pageSize=101&sort=capturedAtDescending`))
      .status,
    400,
  )
  assert.equal(
    (
      await fetch(
        `${base}/api/library?pageSize=5&cursor=not-a-cursor&sort=capturedAtDescending`,
      )
    ).status,
    400,
  )
  assert.equal(
    (await fetch(`${base}/api/library?pageSize=5&sort=unsafe`)).status,
    400,
  )
  await listener.close()
  service.close()
})

test('Library detail uses stable identities and snapshot delivery remains catalog-bounded', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const detail = await fetch(`${base}/api/library/assets/asset-m27-001`).then(
    (response) => response.json(),
  )
  assert.equal(detail.assetId, 'asset-m27-001')
  assert.equal(detail.lineage.runId, 'run-m27-001')
  assert.deepEqual(detail.actions, [
    { _tag: 'Eligible', action: 'download' },
    { _tag: 'Eligible', action: 'openInProcess' },
  ])
  assert.equal(JSON.stringify(detail).includes('objectKey'), false)
  assert.equal(JSON.stringify(detail).includes('/Users/'), false)
  assert.equal(
    (await fetch(`${base}/api/library/assets/malformed`)).status,
    400,
  )
  const malformedPath = await fetch(`${base}/api/library/assets/%`)
  assert.equal(malformedPath.status, 400)
  assert.deepEqual(await malformedPath.json(), {
    outcome: 'rejected',
    reason: 'InvalidInput',
    message: 'The service could not read that action.',
  })
  assert.equal(
    (await fetch(`${base}/api/library/assets/asset-m27-999`)).status,
    404,
  )
  service.database
    .prepare(
      "UPDATE library_assets SET detail='{}' WHERE asset_id='asset-m27-001'",
    )
    .run()
  const corrupt = await fetch(`${base}/api/library/assets/asset-m27-001`)
  assert.equal(corrupt.status, 503)
  assert.deepEqual(await corrupt.json(), {
    outcome: 'rejected',
    reason: 'LibraryUnavailable',
  })
  const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(snapshot.activeRun._tag, 'None')
  assert.equal(JSON.stringify(snapshot).includes('asset-m27-'), false)
  await listener.close()
  service.close()
})

test('authenticated workspace projections preserve future intent, bounded Library evidence, and a stable Process handoff', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-process-source-handoff-')),
    'state.sqlite',
  )
  let service = createFixtureService(databasePath)
  let listener = await service.listen()
  let base = `http://127.0.0.1:${listener.port}`
  const outboxBefore = databaseRow(
    CountRow,
    service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
  ).count
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const plan = await fetch(`${base}/api/workspaces/plan`).then((response) =>
    response.json(),
  )
  assert.equal(plan.planId, 'plan-m27')
  assert.equal(plan.readiness, 'ready')
  assert.equal(plan.sequences.length, 2)
  assert.equal(plan.sequences[0].capture, '24 × 180s · L')
  assert.equal(plan.sequences[0].window.horizonClearanceDeg, 28)
  assert.equal(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(plan.sequences[0].window.startsAt)),
    '23:18',
  )
  assert.equal(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(plan.sequences[0].window.endsAt)),
    '01:02',
  )
  const library = await fetch(
    `${base}/api/library?queryId=workspace-coverage&pageSize=1&sort=capturedAtDescending`,
  ).then((response) => response.json())
  assert.equal(library.results.length, 1)
  assert.equal(library.nextCursor, '1')
  const assetId = library.results[0].assetId
  const detail = await fetch(`${base}/api/library/assets/${assetId}`).then(
    (response) => response.json(),
  )
  assert.equal(detail.assetId, assetId)
  assert.equal(detail.lineage.runId, 'run-m27-001')
  const processResponse = await fetch(
    `${base}/api/library/assets/${assetId}/process-source`,
  )
  assert.equal(processResponse.status, 200)
  const process = Schema.decodeUnknownSync(ProcessSourceHandoff)(
    await processResponse.json(),
  )
  assert.equal(process.sourceAssetId, assetId)
  assert.equal(process.processing.availability, 'available')
  assert.equal(process.recommendedSet?.candidateCount, 2)
  assert.equal(process.recommendedSet?.includedCount, 0)
  assert.equal(process.recommendedSet?.needsReviewCount, 2)
  assert.deepEqual(
    process.recommendedSet?.candidates.map(
      (candidate) => candidate.effectiveDecision,
    ),
    ['needsReview', 'needsReview'],
  )
  assert.equal('sessionId' in process, false)
  assert.equal('preview' in process, false)
  const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(snapshot.activeRun._tag, 'None')
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM events').get(),
    ).count,
    0,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    outboxBefore,
  )
  await listener.close()
  service.close()
  service = createFixtureService(databasePath)
  listener = await service.listen()
  base = `http://127.0.0.1:${listener.port}`
  const refreshed = await fetch(
    `${base}/api/library/assets/${assetId}/process-source`,
  )
  assert.equal(refreshed.status, 200)
  assert.equal(
    Schema.decodeUnknownSync(ProcessSourceHandoff)(await refreshed.json())
      .lineage.runId,
    'run-m27-001',
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM events').get(),
    ).count,
    0,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    outboxBefore,
  )
  assert.equal(
    (await fetch(`${base}/api/library/assets/asset-other/process-source`))
      .status,
    404,
  )
  const unavailable = await fetch(
    `${base}/api/library/assets/asset-m27-013/process-source`,
  )
  assert.equal(unavailable.status, 409)
  assert.deepEqual(await unavailable.json(), {
    outcome: 'rejected',
    reason: 'AssetUnavailable',
    message:
      'This asset is temporarily unavailable and cannot open in Process.',
  })
  service.database
    .prepare("UPDATE library_assets SET detail='{}' WHERE asset_id=?")
    .run(assetId)
  assert.equal(
    (await fetch(`${base}/api/library/assets/${assetId}/process-source`))
      .status,
    503,
  )
  assert.equal((await fetch(`${base}/api/process/projects`)).status, 200)
})

test('library-published fixture projects one durable Download Eligible M27 asset without work', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-library-published-fixture-')),
    'state.sqlite',
  )
  const service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    { fixture: 'library-published' },
  )
  const listener = await service.listen()
  let firstClosed = false
  t.after(async () => {
    if (firstClosed) return
    await listener.close()
    service.close()
  })
  const base = `http://127.0.0.1:${listener.port}`
  const detailResponse = await fetch(`${base}/api/library/assets/asset-m27-001`)
  assert.equal(detailResponse.status, 200)
  const detail = await detailResponse.json()
  assert.deepEqual(detail.actions, [
    { _tag: 'Eligible', action: 'download' },
    {
      _tag: 'Unavailable',
      action: 'openInProcess',
      reason: 'AssetNotAvailableLocally',
    },
  ])
  assert.equal(
    detail.representations.filter(
      (representation: { label?: string; state?: string }) =>
        representation.label === 'Published delivery available' &&
        representation.state === 'published',
    ).length,
    1,
  )
  assert.equal(JSON.stringify(detail).includes('objectKey'), false)
  assert.equal(JSON.stringify(detail).includes('published/'), false)
  assert.equal(JSON.stringify(detail).includes('X-Amz'), false)
  assert.equal(JSON.stringify(detail).includes('provider'), false)
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    0,
  )
  await listener.close()
  service.close()
  firstClosed = true

  const recovered = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    { fixture: 'library-published' },
  )
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const recoveredDetail = await fetch(
    `http://127.0.0.1:${recoveredListener.port}/api/library/assets/asset-m27-001`,
  ).then((response) => response.json())
  assert.deepEqual(recoveredDetail.actions, detail.actions)
  assert.equal(
    recoveredDetail.representations.filter(
      (representation: { label?: string; state?: string }) =>
        representation.label === 'Published delivery available' &&
        representation.state === 'published',
    ).length,
    1,
  )
  const publication = databaseRow(
    PublicationRow,
    recovered.database
      .prepare(
        "SELECT object_key FROM asset_publications WHERE asset_id='asset-m27-001' AND state='published'",
      )
      .get(),
  )
  assert.match(publication.object_key, /^published\//)
  assert.equal(
    databaseRow(
      CountRow,
      recovered.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    0,
  )
})

test('plan-draft fixture preserves UI-created fake definitions without run or hardware work', async (t) => {
  const standard = createFixtureService()
  assert.equal(
    databaseRow(
      CountRow,
      standard.database
        .prepare(
          "SELECT count(*) AS count FROM run_definitions WHERE run_definition_id='run-definition-m27-fixture'",
        )
        .get(),
    ).count,
    1,
  )
  standard.close()

  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-plan-draft-fixture-')),
    'state.sqlite',
  )
  const service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    { fixture: 'plan-draft' },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(initial.plan?.readiness, 'ready')
  assert.equal(initial.plan?.acceptedRunDefinition, undefined)
  assert.equal(initial.activeRun._tag, 'None')
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare('SELECT count(*) AS count FROM run_definitions')
        .get(),
    ).count,
    0,
  )
  if (initial.plan === undefined)
    throw new Error('Plan-draft fixture is unavailable')
  const saved = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'SaveDraft',
        planId: initial.plan.planId,
        expectedPlanRevision: initial.plan.revision,
        idempotencyKey: 'plan-draft-save',
        sequences: initial.plan.sequences.map(
          ({ viability: _viability, ...sequence }) =>
            revisePlanSequence(sequence, {
              targetName: `${sequence.definition.targetName} saved`,
            }),
        ),
      },
    }),
  })
  assert.equal(saved.status, 202)
  const afterSave = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (afterSave.plan === undefined) throw new Error('Saved Plan is unavailable')
  const accepted = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'AcceptRunDefinition',
        planId: afterSave.plan.planId,
        expectedPlanRevision: afterSave.plan.revision,
        expectedLeaseRevision: afterSave.control.revision,
        idempotencyKey: 'plan-draft-accept',
      },
    }),
  })
  assert.equal(accepted.status, 202)
  await listener.close()
  service.close()

  const recovered = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    { fixture: 'plan-draft' },
  )
  t.after(() => recovered.close())
  const definition = JSON.parse(
    databaseRow(
      RunDefinitionEvidenceRow,
      recovered.database
        .prepare('SELECT definition FROM run_definitions')
        .get(),
    ).definition,
  )
  assert.equal(definition.definition.executor, 'fake')
  assert.equal(
    databaseRow(
      CountRow,
      recovered.database
        .prepare('SELECT count(*) AS count FROM run_definitions')
        .get(),
    ).count,
    1,
  )
  assert.equal(
    databaseRow(
      CountRow,
      recovered.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    0,
  )
  const recoveredListener = await recovered.listen()
  const snapshot = await bootstrapSnapshot(
    `http://127.0.0.1:${recoveredListener.port}/api/snapshot`,
  )
  assert.equal(snapshot.activeRun._tag, 'None')
  await recoveredListener.close()
})

test('workspace projections remain behind existing admission', async (t) => {
  const service = createFixtureService(':memory:', () => undefined)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  for (const path of [
    '/api/workspaces/plan',
    '/api/process/projects',
    '/api/library?queryId=workspace-coverage&sort=capturedAtDescending',
  ])
    assert.equal((await fetch(`${base}${path}`)).status, 401)
})

test('a request query cannot select phone or controller capability', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const queried = await bootstrapSnapshot(`${base}/api/snapshot?mode=phone`, {
    headers: { 'x-client-capability': 'readOnly' },
  })
  assert.equal(queried.membership.capability, 'controlCapable')
  const phoneService = createFixtureService(':memory:', () => ({
    personId: 'owner-chicks',
    clientId: 'phone-monitor',
    capability: 'readOnly',
  }))
  const phoneListener = await phoneService.listen()
  t.after(async () => {
    await listener.close()
    service.close()
    await phoneListener.close()
    phoneService.close()
  })
  const trustedPhone = await bootstrapSnapshot(
    `http://127.0.0.1:${phoneListener.port}/api/snapshot?mode=desktop`,
  )
  assert.equal(trustedPhone.membership.capability, 'readOnly')
  await listener.close()
  service.close()
  await phoneListener.close()
  phoneService.close()
})

test('separate local owner and remote listeners keep Access clients read-only', async (t) => {
  const remoteAdmission = (request?: Pick<IncomingMessage, 'headers'>) =>
    request?.headers.authorization === 'Bearer remote'
      ? {
          personId: 'viewer-ada',
          clientId: 'access-viewer-ada',
          role: 'viewer' as const,
          capability: 'readOnly' as const,
        }
      : undefined
  const service = createFixtureService(':memory:', remoteAdmission)
  const remote = await service.listen(0, '127.0.0.1', remoteAdmission)
  const local = await service.listen(
    0,
    '127.0.0.1',
    createLocalOwnerAdmission(),
  )
  t.after(async () => {
    await remote.close()
    await local.close()
    service.close()
  })
  const remoteBase = `http://127.0.0.1:${remote.port}`
  const localBase = `http://127.0.0.1:${local.port}`
  const remoteSnapshot = await bootstrapSnapshot(`${remoteBase}/api/snapshot`, {
    headers: { authorization: 'Bearer remote' },
  })
  assert.equal(remoteSnapshot.membership.role, 'viewer')
  assert.equal(remoteSnapshot.membership.capability, 'readOnly')
  assert.equal(
    (
      await fetch(`${remoteBase}/api/observe/preflight`, {
        method: 'POST',
        headers: { authorization: 'Bearer remote' },
        body: JSON.stringify({}),
      })
    ).status,
    403,
  )
  const localSnapshot = await bootstrapSnapshot(`${localBase}/api/snapshot`)
  assert.equal(localSnapshot.membership.role, 'owner')
  assert.equal(localSnapshot.membership.capability, 'controlCapable')
})

test('separate remote desktop listener admits shared-control requests while phone remains read-only', async (t) => {
  const phoneAdmission = () => ({
    personId: 'owner-chicks',
    clientId: 'phone-owner',
    role: 'owner' as const,
    capability: 'readOnly' as const,
  })
  const desktopAdmission = () => ({
    personId: 'owner-chicks',
    clientId: 'access:owner-chicks-subject',
    role: 'owner' as const,
    capability: 'controlCapable' as const,
  })
  const service = createFixtureService(':memory:', phoneAdmission)
  const phone = await service.listen(0, '127.0.0.1', phoneAdmission)
  const desktop = await service.listen(0, '127.0.0.1', desktopAdmission)
  t.after(async () => {
    await phone.close()
    await desktop.close()
    service.close()
  })
  const phoneSnapshot = await bootstrapSnapshot(
    `http://127.0.0.1:${phone.port}/api/snapshot`,
  )
  assert.equal(phoneSnapshot.membership.capability, 'readOnly')
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${phone.port}/api/commands/control`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: 'phone-request',
          command: {
            _tag: 'TakeControl',
            expectedLeaseRevision: phoneSnapshot.control.revision,
            idempotencyKey: 'phone-request',
          },
        }),
      })
    ).status,
    403,
  )
  const desktopSnapshot = await bootstrapSnapshot(
    `http://127.0.0.1:${desktop.port}/api/snapshot`,
  )
  assert.equal(desktopSnapshot.membership.capability, 'controlCapable')
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${desktop.port}/api/commands/control`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: 'desktop-request',
          command: {
            _tag: 'TakeControl',
            expectedLeaseRevision: desktopSnapshot.control.revision,
            idempotencyKey: 'desktop-request',
          },
        }),
      })
    ).status,
    202,
  )
})

test('protected responses install browser security headers without caching service truth', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const response = await fetch(`${base}/api/snapshot`)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.match(
    response.headers.get('content-security-policy') ?? '',
    /frame-ancestors 'none'/,
  )
  assert.doesNotMatch(
    response.headers.get('content-security-policy') ?? '',
    /unsafe-inline/,
  )
})

test('listener shutdown closes a consumed keep-alive request', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  t.after(() => service.close())
  const response = await fetch(
    `http://127.0.0.1:${listener.port}/api/health/ready`,
  )
  assert.equal(response.status, 200)
  await response.text()
  await Promise.race([
    listener.close(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('listener shutdown timed out')), 1_000),
    ),
  ])
})

test('serves the web bundle with route fallback while preserving API precedence', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-web-bundle-'))
  const webDistPath = join(root, 'dist')
  const assets = join(webDistPath, 'assets')
  mkdirSync(assets, { recursive: true })
  writeFileSync(join(webDistPath, 'index.html'), '<main>Nightbook</main>')
  writeFileSync(join(assets, 'index-abcdefgh.js'), 'export {}')
  writeFileSync(join(assets, 'index-abcdefgh.css'), 'body{}')
  writeFileSync(join(root, 'outside.js'), 'outside')
  symlinkSync(join(root, 'outside.js'), join(assets, 'outside.js'))
  const service = createLocalWebService(
    ':memory:',
    undefined,
    undefined,
    undefined,
    { fixture: 'm27', webDistPath },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  for (const path of [
    '/',
    '/plan',
    '/observe',
    '/library',
    '/process',
    '/library/assets/asset-m27-001',
  ]) {
    const index = await fetch(`${base}${path}`)
    assert.equal(index.status, 200)
    assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(index.headers.get('cache-control'), 'no-store')
    assert.equal(await index.text(), '<main>Nightbook</main>')
    assert.doesNotMatch(
      index.headers.get('content-security-policy') ?? '',
      /unsafe-inline/,
    )
  }
  assert.equal(
    (await fetch(`${base}/process/sessions/process-m27-001`)).status,
    404,
  )
  const script = await fetch(`${base}/assets/index-abcdefgh.js`)
  assert.equal(
    script.headers.get('content-type'),
    'text/javascript; charset=utf-8',
  )
  assert.equal(
    script.headers.get('cache-control'),
    'public, max-age=31536000, immutable',
  )
  const stylesheet = await fetch(`${base}/assets/index-abcdefgh.css`)
  assert.equal(
    stylesheet.headers.get('content-type'),
    'text/css; charset=utf-8',
  )
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404)
  assert.equal(
    (await fetch(`${base}/api/unknown`)).headers.get('content-type'),
    'application/json; charset=utf-8',
  )
  assert.equal((await fetch(`${base}/not-a-web-route`)).status, 404)
  assert.equal((await fetch(`${base}/assets/outside.js`)).status, 404)
  assert.equal((await fetch(`${base}/assets/%2e%2e/outside.js`)).status, 404)
})

test('reports a missing web bundle without substituting an inline shell', async (t) => {
  const service = createLocalWebService(
    ':memory:',
    undefined,
    undefined,
    undefined,
    {
      fixture: 'm27',
      webDistPath: join(tmpdir(), 'astro-web-bundle-missing'),
    },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const response = await fetch(`${base}/`)
  assert.equal(response.status, 404)
  assert.equal(await response.text(), '')
  assert.equal((await fetch(`${base}/api/snapshot`)).status, 200)
})

async function submitPlan(
  base: string,
  intent: unknown,
  headers?: HeadersInit,
) {
  const response = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    ...(headers === undefined ? {} : { headers }),
    body: JSON.stringify({ intent }),
  })
  return {
    response,
    body: Schema.decodeUnknownSync(PlanCommandResponse)(await response.json()),
  }
}

async function submitObserve(
  base: string,
  intent: unknown,
  headers?: HeadersInit,
) {
  const response = await fetch(`${base}/api/observe/commands`, {
    method: 'POST',
    ...(headers === undefined ? {} : { headers }),
    body: JSON.stringify({ intent }),
  })
  return {
    response,
    body: Schema.decodeUnknownSync(ObserveCommandResponse)(
      await response.json(),
    ),
  }
}

async function submitPolar(base: string, intent: unknown) {
  const response = await fetch(`${base}/api/acquire/commands`, {
    method: 'POST',
    body: JSON.stringify({ intent }),
  })
  return {
    response,
    body: Schema.decodeUnknownSync(AcquireCommandResponse)(
      await response.json(),
    ),
  }
}

function polarCaptureIntent(
  snapshot: Awaited<ReturnType<typeof bootstrapSnapshot>>,
  idempotencyKey: string,
) {
  if (
    snapshot.activeRun._tag !== 'Active' ||
    snapshot.observe?.acquire === undefined
  )
    throw new Error('Polar fixture is unavailable')
  return {
    _tag: 'CapturePolarAlignmentMeasurement' as const,
    expectedLeaseRevision: snapshot.control.revision,
    expectedRunRevision: snapshot.activeRun.run.revision,
    expectedAcquireRevision: snapshot.observe.acquire.revision,
    idempotencyKey,
  }
}

function polarAcceptIntent(
  snapshot: Awaited<ReturnType<typeof bootstrapSnapshot>>,
  attemptId: string,
  idempotencyKey: string,
) {
  return {
    ...polarCaptureIntent(snapshot, idempotencyKey),
    _tag: 'AcceptPolarAlignmentEvidence' as const,
    attemptId,
  }
}

function polarEvidence(
  snapshot: Awaited<ReturnType<typeof bootstrapSnapshot>>,
) {
  const evidence = snapshot.observe?.acquire?.latestEvidence
  if (evidence === undefined || evidence._tag !== 'PolarMeasurement')
    throw new Error('Polar measurement evidence is unavailable')
  return evidence
}

async function startFixtureRun(base: string, idempotencyKey: string) {
  const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (snapshot.plan === undefined)
    throw new Error('Fixture Plan is unavailable')
  const started = await submitPlan(base, {
    _tag: 'StartAcceptedRun',
    planId: snapshot.plan.planId,
    expectedPlanRevision: snapshot.plan.revision,
    expectedLeaseRevision: snapshot.control.revision,
    idempotencyKey,
  })
  assert.equal(started.response.status, 202)
  assert.equal(started.body._tag, 'Accepted')
  return bootstrapSnapshot(`${base}/api/snapshot`)
}

test('canonical Plan commands persist draft readiness, immutable acceptance, idempotency, restart, and SSE truth', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-canonical-plan-')),
    'state.sqlite',
  )
  const service = createLocalWebService(
    databasePath,
    undefined,
    undefined,
    undefined,
    { fixture: 'plan-draft' },
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (initial.plan === undefined) throw new Error('Fixture Plan is unavailable')
  const sequences = initial.plan.sequences.map(
    ({ viability, ...sequence }) => sequence,
  )
  const firstSequence = sequences[0]
  if (firstSequence === undefined)
    throw new Error('Plan sequence is unavailable')
  const saved = await submitPlan(base, {
    _tag: 'SaveDraft',
    planId: initial.plan.planId,
    expectedPlanRevision: initial.plan.revision,
    idempotencyKey: 'canonical-plan-save',
    sequences: [
      {
        ...revisePlanSequence(firstSequence, {
          exposureSeconds: firstSequence.definition.exposureSeconds - 1,
          earliestStart: '2026-07-25T03:18:00.000Z',
          latestEnd: '2026-07-25T05:30:00.000Z',
          horizonClearanceDegrees: 20,
        }),
        window: {
          startsAt: '1999-01-01T00:00:00.000Z',
          endsAt: '1999-01-01T00:01:00.000Z',
          usableMinutes: 1,
          peakAltitudeDeg: -90,
          horizonClearanceDeg: -50,
        },
        horizon: 'blocked',
      },
    ],
  })
  assert.equal(saved.response.status, 202)
  assert.equal(saved.body._tag, 'Accepted')
  if (saved.body._tag !== 'Accepted') throw new Error('Draft was not accepted')
  assert.equal(saved.body.result._tag, 'DraftSaved')
  assert.match(await nextEvent(reader), /ProjectionChanged/)
  const duplicate = await submitPlan(base, {
    _tag: 'SaveDraft',
    planId: initial.plan.planId,
    expectedPlanRevision: initial.plan.revision,
    idempotencyKey: 'canonical-plan-duplicate',
    sequences: [sequences[0], sequences[0]],
  })
  assert.equal(duplicate.response.status, 400)
  const empty = await submitPlan(base, {
    _tag: 'SaveDraft',
    planId: initial.plan.planId,
    expectedPlanRevision: initial.plan.revision,
    idempotencyKey: 'canonical-plan-empty',
    sequences: [],
  })
  assert.equal(empty.response.status, 400)
  const mismatched = await submitPlan(base, {
    _tag: 'SaveDraft',
    planId: initial.plan.planId,
    expectedPlanRevision: initial.plan.revision,
    idempotencyKey: 'canonical-plan-mismatched-sequence',
    sequences: [
      {
        ...firstSequence,
        definition: {
          ...firstSequence.definition,
          sequenceId: 'different-sequence',
        },
      },
    ],
  })
  assert.equal(mismatched.response.status, 400)
  const draft = saved.body.snapshot.plan
  if (draft === undefined) throw new Error('Saved Plan is unavailable')
  assert.equal(
    draft.sequences[0]?.window.startsAt,
    draft.sequences[0]?.definition.earliestStart,
  )
  assert.equal(
    draft.sequences[0]?.window.endsAt,
    draft.sequences[0]?.definition.latestEnd,
  )
  assert.equal(draft.sequences[0]?.window.usableMinutes, 104)
  assert.equal(draft.sequences[0]?.window.peakAltitudeDeg, 62)
  assert.equal(draft.sequences[0]?.window.horizonClearanceDeg, 28)
  assert.equal(draft.sequences[0]?.definition.horizonClearanceDegrees, 20)
  assert.equal(draft.sequences[0]?.horizon, 'clear')
  assert.equal(draft.sequences[0]?.viability, 'viable')
  const accepted = await submitPlan(base, {
    _tag: 'AcceptRunDefinition',
    planId: draft.planId,
    expectedPlanRevision: draft.revision,
    expectedLeaseRevision: saved.body.snapshot.control.revision,
    idempotencyKey: 'canonical-definition-accept',
  })
  assert.equal(accepted.response.status, 202)
  const replay = await submitPlan(base, {
    _tag: 'AcceptRunDefinition',
    planId: draft.planId,
    expectedPlanRevision: draft.revision,
    expectedLeaseRevision: saved.body.snapshot.control.revision,
    idempotencyKey: 'canonical-definition-accept',
  })
  assert.equal(replay.response.status, 200)
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    0,
  )
  const later = await submitPlan(base, {
    _tag: 'SaveDraft',
    planId: draft.planId,
    expectedPlanRevision: draft.revision,
    idempotencyKey: 'canonical-later-draft',
    sequences: draft.sequences.map((sequence) =>
      revisePlanSequence(sequence, {
        targetName: `${sequence.definition.targetName} later`,
      }),
    ),
  })
  assert.equal(later.response.status, 202)
  const definition = databaseRow(
    RunDefinitionEvidenceRow,
    service.database.prepare('SELECT definition FROM run_definitions').get(),
  )
  assert.notEqual(
    JSON.parse(definition.definition).plan.sequences[0].target,
    `${firstSequence.definition.targetName} later`,
  )
  await reader?.cancel()
  await listener.close()
  service.close()
  const recovered = createFixtureService(databasePath)
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  assert.equal(
    (
      await bootstrapSnapshot(
        `http://127.0.0.1:${recoveredListener.port}/api/snapshot`,
      )
    ).plan?.revision,
    draft.revision + 1,
  )
})

test('canonical Observe commands drive fake lifecycle, recovery, terminal, and consequence paths', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const started = await startFixtureRun(base, 'canonical-observe-start')
  if (started.observe === undefined)
    throw new Error('Observe run is unavailable')
  const pause = await submitObserve(base, {
    _tag: 'PauseRun',
    expectedLeaseRevision: started.control.revision,
    expectedRunRevision: started.observe.revision,
    idempotencyKey: 'canonical-observe-pause',
  })
  assert.equal(pause.response.status, 202)
  assert.equal(pause.body._tag, 'Accepted')
  const paused = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(paused.observe?.phase, 'paused')
  assert.equal(service.advanceFakeRun(), undefined)
  if (paused.observe === undefined)
    throw new Error('Paused Observe run is unavailable')
  const resumed = await submitObserve(base, {
    _tag: 'ResumeRun',
    expectedLeaseRevision: paused.control.revision,
    expectedRunRevision: paused.observe.revision,
    idempotencyKey: 'canonical-observe-resume',
  })
  assert.equal(resumed.response.status, 202)
  const active = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (active.observe === undefined)
    throw new Error('Observe run is unavailable')
  for (const _tag of ['RetryPhase', 'SkipSequence'] as const) {
    const response = await submitObserve(base, {
      _tag,
      expectedLeaseRevision: active.control.revision,
      expectedRunRevision: (await bootstrapSnapshot(`${base}/api/snapshot`))
        .observe?.revision,
      idempotencyKey: `canonical-observe-${_tag}`,
    })
    assert.equal(response.response.status, 202)
    assert.equal(response.body._tag, 'Accepted')
  }
  const afterSkip = await bootstrapSnapshot(`${base}/api/snapshot`)
  if (afterSkip.observe === undefined)
    throw new Error('Observe run is unavailable')
  const parked = await submitObserve(base, {
    _tag: 'RequestPark',
    expectedLeaseRevision: afterSkip.control.revision,
    expectedRunRevision: afterSkip.observe.revision,
    idempotencyKey: 'canonical-observe-park',
  })
  assert.equal(parked.response.status, 202)
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).observe?.phase,
    'parkRequested',
  )
  const terminal = await submitObserve(base, {
    _tag: 'StopRun',
    expectedLeaseRevision: afterSkip.control.revision,
    expectedRunRevision: afterSkip.observe.revision,
    idempotencyKey: 'canonical-observe-terminal',
  })
  assert.equal(terminal.response.status, 409)
  assert.equal(terminal.body._tag, 'Rejected')
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
    ).count,
    0,
  )
  const stoppedService = createFixtureService()
  const stoppedListener = await stoppedService.listen()
  const stoppedBase = `http://127.0.0.1:${stoppedListener.port}`
  t.after(async () => {
    await stoppedListener.close()
    stoppedService.close()
  })
  const stoppedSnapshot = await startFixtureRun(
    stoppedBase,
    'canonical-observe-stop-start',
  )
  if (stoppedSnapshot.observe === undefined)
    throw new Error('Observe run is unavailable')
  const stopped = await submitObserve(stoppedBase, {
    _tag: 'StopRun',
    expectedLeaseRevision: stoppedSnapshot.control.revision,
    expectedRunRevision: stoppedSnapshot.observe.revision,
    idempotencyKey: 'canonical-observe-stop',
  })
  assert.equal(stopped.response.status, 202)
  assert.equal(
    (await bootstrapSnapshot(`${stoppedBase}/api/snapshot`)).observe?.phase,
    'stopped',
  )
})

test('canonical snapshot-first reconnect and shared SQLite projection keep commands unreplayed', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-canonical-projection-')),
    'state.sqlite',
  )
  const owner = createFixtureService(databasePath)
  const friend = createFixtureService(databasePath, () => ({
    personId: 'friend-ada',
    clientId: 'desktop-ada',
    role: 'viewer' as const,
    capability: 'controlCapable' as const,
  }))
  const ownerListener = await owner.listen()
  const friendListener = await friend.listen()
  const ownerBase = `http://127.0.0.1:${ownerListener.port}`
  const friendBase = `http://127.0.0.1:${friendListener.port}`
  t.after(async () => {
    await ownerListener.close()
    await friendListener.close()
    owner.close()
    friend.close()
  })
  const stream = await fetch(`${ownerBase}/api/events`)
  const reader = stream.body?.getReader()
  assert.match(await nextEvent(reader), /ProjectionChanged/)
  await startFixtureRun(ownerBase, 'canonical-reconnect-start')
  await reader?.cancel()
  const reconnect = await fetch(`${ownerBase}/api/events`)
  const reconnectReader = reconnect.body?.getReader()
  assert.match(await nextEvent(reconnectReader), /"phase":"capture"/)
  const before = databaseRow(
    CountRow,
    owner.database
      .prepare("SELECT count(*) AS count FROM events WHERE type='RunStarted'")
      .get(),
  ).count
  const requested = Schema.decodeUnknownSync(CommandHttpSuccessEnvelope)(
    await fetch(`${friendBase}/api/commands/control`, {
      method: 'POST',
      body: JSON.stringify({
        commandId: 'canonical-cross-process-request',
        command: {
          _tag: 'RequestControl',
          expectedLeaseRevision: 1,
          idempotencyKey: 'canonical-cross-process-request',
        },
      }),
    }).then((response) => response.json()),
  )
  assert.equal(requested.ok, true)
  assert.match(await nextEvent(reconnectReader), /"eventCursor":\d+/)
  assert.equal(
    databaseRow(
      CountRow,
      owner.database
        .prepare("SELECT count(*) AS count FROM events WHERE type='RunStarted'")
        .get(),
    ).count,
    before,
  )
  await reconnectReader?.cancel()
})

test('SSE controller presence persists reconnect grace and restores only after snapshot-first reconnect', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-controller-presence-')),
    'state.sqlite',
  )
  let service = createFixtureService(databasePath)
  let listener = await service.listen()
  let base = `http://127.0.0.1:${listener.port}`
  const waitForState = async (state: 'held' | 'reconnecting') => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
      if (snapshot.control.state === state) return snapshot
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail(`Control did not reach ${state}`)
  }
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  assert.match(await nextEvent(reader), /ProjectionChanged/)
  await reader?.cancel()
  const reconnecting = await waitForState('reconnecting')
  assert.ok(reconnecting.control.reconnectGraceUntil)
  const reconnectingVersion = reconnecting.snapshotVersion

  await listener.close()
  service.close()
  service = createFixtureService(databasePath)
  listener = await service.listen()
  base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  assert.equal(
    (await bootstrapSnapshot(`${base}/api/snapshot`)).control.state,
    'reconnecting',
  )
  const reconnectedStream = await fetch(`${base}/api/events`)
  const reconnectedReader = reconnectedStream.body?.getReader()
  assert.match(await nextEvent(reconnectedReader), /"state":"held"/)
  const held = await waitForState('held')
  assert.equal(held.control.reconnectGraceUntil, undefined)
  assert.ok(held.snapshotVersion > reconnectingVersion)
  await reconnectedReader?.cancel()
})

test('canonical Observe pause survives restart and resumes the persisted fake run', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-canonical-observe-restart-')),
    'state.sqlite',
  )
  const service = createFixtureService(databasePath)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const started = await startFixtureRun(base, 'canonical-restart-start')
  if (started.observe === undefined)
    throw new Error('Observe run is unavailable')
  const paused = await submitObserve(base, {
    _tag: 'PauseRun',
    expectedLeaseRevision: started.control.revision,
    expectedRunRevision: started.observe.revision,
    idempotencyKey: 'canonical-restart-pause',
  })
  assert.equal(paused.response.status, 202)
  await listener.close()
  service.close()
  const recovered = createFixtureService(databasePath)
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const recoveredBase = `http://127.0.0.1:${recoveredListener.port}`
  const persisted = await bootstrapSnapshot(`${recoveredBase}/api/snapshot`)
  assert.equal(persisted.observe?.phase, 'paused')
  if (persisted.observe === undefined)
    throw new Error('Paused Observe run is unavailable')
  const resumed = await submitObserve(recoveredBase, {
    _tag: 'ResumeRun',
    expectedLeaseRevision: persisted.control.revision,
    expectedRunRevision: persisted.observe.revision,
    idempotencyKey: 'canonical-restart-resume',
  })
  assert.equal(resumed.response.status, 202)
  assert.notEqual(
    (await bootstrapSnapshot(`${recoveredBase}/api/snapshot`)).observe?.phase,
    'paused',
  )
})

test('non-fixture startup projects unavailable Plan truth through canonical commands', async (t) => {
  const service = createLocalWebService(':memory:')
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const snapshot = await bootstrapSnapshot(`${base}/api/snapshot`)
  assert.equal(snapshot.plan, undefined)
  const rejected = await submitPlan(base, {
    _tag: 'StartAcceptedRun',
    planId: 'uninitialized',
    expectedPlanRevision: 0,
    expectedLeaseRevision: snapshot.control.revision,
    idempotencyKey: 'canonical-unavailable-plan',
  })
  assert.equal(rejected.response.status, 409)
  assert.equal(rejected.body._tag, 'Rejected')
  if (rejected.body._tag === 'Rejected')
    assert.equal(rejected.body.failure._tag, 'Rejected')
})

test('canonical Plan and Observe routes enforce admitted owner, viewer, and phone authority', async (t) => {
  const service = createFixtureService(':memory:', (request) =>
    request?.headers.authorization === 'Bearer owner'
      ? {
          personId: 'owner',
          clientId: 'desktop-owner',
          role: 'owner' as const,
          capability: 'controlCapable' as const,
        }
      : request?.headers.authorization === 'Bearer viewer'
        ? {
            personId: 'viewer',
            clientId: 'desktop-viewer',
            role: 'viewer' as const,
            capability: 'controlCapable' as const,
          }
        : request?.headers.authorization === 'Bearer phone'
          ? {
              personId: 'owner',
              clientId: 'phone-owner',
              role: 'owner' as const,
              capability: 'readOnly' as const,
            }
          : undefined,
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const owner = { authorization: 'Bearer owner' }
  const initial = await bootstrapSnapshot(`${base}/api/snapshot`, {
    headers: owner,
  })
  if (initial.plan === undefined) throw new Error('Fixture Plan is unavailable')
  const viewerDraft = await submitPlan(
    base,
    {
      _tag: 'SaveDraft',
      planId: initial.plan.planId,
      expectedPlanRevision: initial.plan.revision,
      idempotencyKey: 'viewer-plan-edit',
      sequences: initial.plan.sequences.map(
        ({ viability, ...sequence }) => sequence,
      ),
    },
    { authorization: 'Bearer viewer' },
  )
  assert.equal(viewerDraft.response.status, 403)
  const started = await submitPlan(
    base,
    {
      _tag: 'StartAcceptedRun',
      planId: initial.plan.planId,
      expectedPlanRevision: initial.plan.revision,
      expectedLeaseRevision: initial.control.revision,
      idempotencyKey: 'owner-plan-start',
    },
    owner,
  )
  assert.equal(started.response.status, 202)
  const active = await bootstrapSnapshot(`${base}/api/snapshot`, {
    headers: owner,
  })
  if (active.observe === undefined)
    throw new Error('Observe run is unavailable')
  for (const [headers, idempotencyKey] of [
    [{ authorization: 'Bearer viewer' }, 'viewer-pause'],
    [{ authorization: 'Bearer phone' }, 'phone-pause'],
  ] as const) {
    const denied = await submitObserve(
      base,
      {
        _tag: 'PauseRun',
        expectedLeaseRevision: active.control.revision,
        expectedRunRevision: active.observe.revision,
        idempotencyKey,
      },
      headers,
    )
    assert.equal(denied.response.status, 403)
  }
})
