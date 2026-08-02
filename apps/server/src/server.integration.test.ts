import assert from 'node:assert/strict'
import test from 'node:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import type { IncomingMessage } from 'node:http'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { ConfigProvider, Effect, Schema } from 'effect'
import { AcquireSnapshot, RunSnapshot } from '@astro-console/v2-contracts'
import {
  createOriginAdmission,
  createJwksKeyResolver,
  createMembershipBootstrapResolver,
  createProductionAccessAdmission,
  openMigrationDatabase,
  openProcessorDatabase,
  openPublisherDatabase,
  createLocalWebService,
} from './server.ts'
import { createRigWorkerService, runRigWorker } from './rig-worker.ts'
import { runSolarTestIntent } from './solar-test.ts'
import { createSeestarSolarAdapter } from './seestar-solar-adapter.ts'
import { createPublisherWorker } from './publisher-worker.ts'
import {
  assertSeparateFilesystems,
  createSqliteSnapshot,
  restoreDrill,
  verifySqlite,
} from './sqlite-resilience.ts'
import { createR2Provider } from './r2-provider.ts'
import { createR2DownloadGrantIssuer } from './r2-download-grant.ts'
import { createDownloadGrantIssuer } from './download-grant-config.ts'
import { createDownloadGrantService } from './download-grant-service.ts'
import { isSqliteBusy } from './publisher-service.ts'
import { createProcessorService, runProcessor } from './processor-service.ts'
import { ingestSourceAsset } from './source-ingest.ts'
import { applicationShell } from './application-shell.ts'
import {
  downloadGrantSignerConfig,
  originServerConfig,
  processorEnvironmentConfig,
  publisherEnvironmentConfig,
  rigWorkerEnvironmentConfig,
  solarCliConfig,
} from './environment-config.ts'

function createFixtureService(
  databasePath?: Parameters<typeof createLocalWebService>[0],
  identityResolver?: Parameters<typeof createLocalWebService>[1],
  brandAssetPath?: Parameters<typeof createLocalWebService>[2],
  processSaveStorage?: Parameters<typeof createLocalWebService>[3],
  downloadGrants?: Parameters<typeof createLocalWebService>[4],
) {
  return createLocalWebService(
    databasePath,
    identityResolver,
    brandAssetPath,
    processSaveStorage,
    downloadGrants,
    { fixture: 'm27' },
  )
}

test('focused executable configurations decode defaults and conditional branches', async () => {
  const read = <Value>(
    config: import('effect').Config.Config<Value>,
    values: Record<string, string>,
  ) =>
    Effect.runPromise(
      config.pipe(
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown(values)),
        ),
      ),
    )
  const r2 = {
    R2_ACCOUNT_ID: 'a'.repeat(32),
    R2_BUCKET: 'astro-console-artifacts',
    R2_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,
  }
  const development = await read(originServerConfig, {})
  assert.deepEqual(development.runtime, {
    databasePath: './.astro-local-web/state.sqlite',
    release: 'local-web-fixture',
    port: 0,
    host: '127.0.0.1',
  })
  assert.deepEqual(development.admission, {
    mode: 'development',
    client: 'owner',
  })
  const production = await read(originServerConfig, {
    ASTRO_ADMISSION_MODE: 'production',
    ASTRO_LOCAL_WEB_BIND: '0.0.0.0',
    ASTRO_LOCAL_WEB_DB: '/var/lib/astro-console/state.sqlite',
    CF_ACCESS_ISSUER: 'https://access.example',
    CF_ACCESS_AUDIENCE: 'audience',
    CF_ACCESS_JWKS_URL: 'https://access.example/certs',
    ASTRO_MEMBERSHIP_BOOTSTRAP_PATH: '/run/config/members.json',
    ASTRO_CLIENT_CONTEXT: 'desktop',
  })
  assert.equal(production.admission.mode, 'production')
  assert.equal(production.admission.cacheTtlMs, 300000)
  assert.deepEqual(
    (
      await read(originServerConfig, {
        ASTRO_DOWNLOAD_GRANT_URL:
          'http://download-grant:8791/internal/download-grants',
        ASTRO_DOWNLOAD_GRANT_SHARED_SECRET_PATH: '/run/secrets/grant',
      })
    ).downloadGrant,
    {
      url: 'http://download-grant:8791/internal/download-grants',
      secretPath: '/run/secrets/grant',
    },
  )
  assert.deepEqual(
    await read(rigWorkerEnvironmentConfig, {
      ASTRO_LOCAL_WEB_DB: '/state.sqlite',
    }),
    { mode: 'disabled', databasePath: '/state.sqlite' },
  )
  assert.deepEqual(
    await read(rigWorkerEnvironmentConfig, {
      ASTRO_LOCAL_WEB_DB: '/state.sqlite',
      ASTRO_RIG_WORKER_MODE: 'seestar',
      ASTRO_SEESTAR_HOST: '192.168.4.63',
      ASTRO_SEESTAR_PEM_PATH: '/run/secrets/seestar.pem',
    }),
    {
      mode: 'seestar',
      databasePath: '/state.sqlite',
      rigId: 'seestar-s30',
      host: '192.168.4.63',
      pemPath: '/run/secrets/seestar.pem',
    },
  )
  assert.equal((await read(processorEnvironmentConfig, {})).mode, 'disabled')
  assert.equal(
    (
      await read(processorEnvironmentConfig, {
        ASTRO_PROCESSOR_MODE: 'manifest',
        ASTRO_LOCAL_WEB_DB: '/var/lib/astro-console/state.sqlite',
        ASTRO_PROCESSOR_SOURCES_ROOT: '/var/lib/astro-console/sources',
        ASTRO_PROCESSOR_ORIGINALS_ROOT: '/var/lib/astro-console/originals',
        ASTRO_PROCESSOR_OUTPUTS_ROOT: '/var/lib/astro-console/outputs',
        ASTRO_PROCESSOR_MANIFEST_PATH: '/run/config/manifest.json',
        ASTRO_PROCESSOR_OWNER_PERSON_ID: 'owner',
      })
    ).mode,
    'manifest',
  )
  assert.equal(
    (
      await read(solarCliConfig, {
        ASTRO_SOLAR_TEST_CONFIRM: 'submit-solar-test',
        ASTRO_SOLAR_TEST_SUBJECT: 'owner',
        ASTRO_SOLAR_TEST_NAME: 'M27',
        ASTRO_SOLAR_TEST_IDEMPOTENCY_KEY: 'solar-1',
      })
    ).command.action,
    'submit',
  )
  assert.deepEqual(
    (
      await read(solarCliConfig, {
        ASTRO_SOLAR_TEST_CONFIRM: 'submit-solar-test',
        ASTRO_SOLAR_TEST_SUBJECT: 'owner',
        ASTRO_SOLAR_TEST_ACTION: 'stop',
        ASTRO_SOLAR_TEST_INTENT_ID: 'solar-1',
      })
    ).command,
    { action: 'stop', intentId: 'solar-1' },
  )
  assert.equal(
    (
      await read(downloadGrantSignerConfig, {
        ...r2,
        R2_DOWNLOAD_CREDENTIALS_PATH: '/run/secrets/r2-read',
        ASTRO_DOWNLOAD_GRANT_SHARED_SECRET_PATH: '/run/secrets/grant',
      })
    ).port,
    8791,
  )
  assert.equal(
    (
      await read(publisherEnvironmentConfig, {
        ...r2,
        R2_CREDENTIALS_PATH: '/run/secrets/r2-write',
        ASTRO_LOCAL_WEB_DB: '/var/lib/astro-console/state.sqlite',
        ASTRO_PUBLISHER_OUTPUTS_ROOT: '/var/lib/astro-console/outputs',
      })
    ).bucket,
    r2.R2_BUCKET,
  )
  await assert.rejects(
    read(originServerConfig, { ASTRO_LOCAL_WEB_PORT: 'wrong' }),
  )
  await assert.rejects(
    read(originServerConfig, {
      ASTRO_ADMISSION_MODE: 'development',
      ASTRO_LOCAL_WEB_BIND: '0.0.0.0',
    }),
  )
  await assert.rejects(
    read(rigWorkerEnvironmentConfig, {
      ASTRO_LOCAL_WEB_DB: '/state.sqlite',
      ASTRO_RIG_WORKER_MODE: 'wrong',
    }),
  )
  await assert.rejects(
    read(rigWorkerEnvironmentConfig, {
      ASTRO_LOCAL_WEB_DB: '/state.sqlite',
      ASTRO_RIG_WORKER_MODE: 'seestar',
    }),
  )
  await assert.rejects(
    read(processorEnvironmentConfig, { ASTRO_PROCESSOR_MODE: 'manifest' }),
  )
  await assert.rejects(
    read(processorEnvironmentConfig, {
      ASTRO_PROCESSOR_MODE: 'wrong',
    }),
  )
  await assert.rejects(
    read(originServerConfig, { ASTRO_ADMISSION_MODE: 'production' }),
  )
  await assert.rejects(
    read(originServerConfig, {
      ASTRO_DOWNLOAD_GRANT_URL:
        'http://download-grant:8791/internal/download-grants',
    }),
  )
  await assert.rejects(
    read(publisherEnvironmentConfig, {
      ...r2,
      R2_CREDENTIALS_PATH: '/tmp/r2',
      ASTRO_LOCAL_WEB_DB: '/var/lib/astro-console/state.sqlite',
      ASTRO_PUBLISHER_OUTPUTS_ROOT: '/var/lib/astro-console/outputs',
    }),
  )
  await assert.rejects(
    read(downloadGrantSignerConfig, {
      ...r2,
      R2_DOWNLOAD_CREDENTIALS_PATH: '/run/secrets/r2-read',
      ASTRO_DOWNLOAD_GRANT_SHARED_SECRET_PATH: '/run/secrets/grant',
      ASTRO_DOWNLOAD_GRANT_PORT: '65536',
    }),
  )
  await assert.rejects(
    read(downloadGrantSignerConfig, {
      ...r2,
      R2_DOWNLOAD_CREDENTIALS_PATH: '/tmp/r2',
      ASTRO_DOWNLOAD_GRANT_SHARED_SECRET_PATH: '/run/secrets/grant',
    }),
  )
  await assert.rejects(
    read(solarCliConfig, {
      ASTRO_SOLAR_TEST_CONFIRM: 'submit-solar-test',
      ASTRO_SOLAR_TEST_SUBJECT: 'owner',
    }),
  )
  await assert.rejects(
    read(solarCliConfig, {
      ASTRO_SOLAR_TEST_CONFIRM: 'submit-solar-test',
      ASTRO_SOLAR_TEST_SUBJECT: 'owner',
      ASTRO_SOLAR_TEST_ACTION: 'stop',
    }),
  )
})

function assertNoM27Fixture(database: DatabaseSync) {
  assert.equal(
    (
      database
        .prepare("SELECT count(*) AS count FROM state WHERE value LIKE '%m27%'")
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (
      database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE '%m27%'",
        )
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (
      database
        .prepare(
          "SELECT count(*) AS count FROM workspace_projections WHERE value LIKE '%m27%'",
        )
        .get() as { count: number }
    ).count,
    0,
  )
}

function publisherFixture(idempotencyKey: string) {
  const root = mkdtempSync(join(tmpdir(), 'astro-publisher-'))
  const sources = join(root, 'sources')
  const outputs = join(root, 'outputs')
  mkdirSync(sources)
  writeFileSync(join(sources, 'final.tiff'), 'publication-bytes')
  const service = createFixtureService(
    join(root, 'state.sqlite'),
    undefined,
    undefined,
    {
      sourcesRoot: sources,
      outputsRoot: outputs,
      sources: { final: 'final.tiff' },
    },
  )
  const saved = service.saveProcess({
    sessionId: 'process-m27-001',
    expectedRevision: 4,
    idempotencyKey,
    outputs: [{ sourceId: 'final', representation: 'final' }],
  })
  if (saved.outcome !== 'accepted')
    throw new Error('publisher fixture save did not accept')
  return { root, outputs, service, saved }
}

test('manifest processor is disabled by default and only saves bounded configured source outputs', () => {
  const disabledPath = join(
    mkdtempSync(join(tmpdir(), 'astro-processor-disabled-')),
    'state.sqlite',
  )
  assert.deepEqual(runProcessor({ mode: 'disabled' }), { outcome: 'disabled' })
  assert.equal(existsSync(disabledPath), false)
  const root = mkdtempSync(join(tmpdir(), 'astro-processor-'))
  const sources = join(root, 'sources')
  const originals = join(root, 'originals')
  const outputs = join(root, 'outputs')
  const databasePath = join(root, 'state.sqlite')
  const manifestPath = join(root, 'manifest.json')
  mkdirSync(sources)
  writeFileSync(join(sources, 'original.tiff'), 'original-bytes')
  writeFileSync(join(sources, 'final.tiff'), 'final-bytes')
  const config = {
    mode: 'manifest' as const,
    databasePath,
    sourcesRoot: sources,
    originalsRoot: originals,
    outputsRoot: outputs,
    manifestPath,
    ownerPersonId: 'owner',
  }
  const manifest = {
    sessionId: 'solar-process-001',
    expectedRevision: 1,
    idempotencyKey: 'processor-save',
    outputs: [{ sourceId: 'final', representation: 'final' }],
    sources: { original: 'original.tiff', final: 'final.tiff' },
    metadata: {
      comparisonGroupId: 'solar-001',
      sourceAssetIds: ['asset-source-solar-001'],
      runId: 'solar-run-001',
      solveAttemptId: 'solar-solve-001',
    },
    sourceIngest: {
      assetId: 'asset-source-solar-001',
      sourceId: 'original',
      format: 'tiff',
      capturedAt: '2026-07-28T00:00:00.000Z',
      comparisonGroupId: 'solar-001',
      lineage: { runId: 'solar-run-001', solveAttemptId: 'solar-solve-001' },
      idempotencyKey: 'source-ingest-001',
    },
  }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const openTestDatabase = (path: string) =>
    openMigrationDatabase(path, `${root}/`)
  const missing = createProcessorService(
    { ...config, manifestPath: join(root, 'missing.json') },
    { databaseOpener: openTestDatabase },
  )
  assert.deepEqual(missing.runOnce(), {
    outcome: 'rejected',
    reason: 'ManifestUnavailable',
  })
  missing.close()
  const unavailable = createProcessorService(config, {
    databaseOpener: openTestDatabase,
  })
  assert.deepEqual(unavailable.runOnce(), {
    outcome: 'rejected',
    reason: 'OwnerUnavailable',
  })
  unavailable.close()
  const seeded = openTestDatabase(databasePath)
  seeded
    .prepare('INSERT INTO memberships VALUES (?,?,?)')
    .run('processor-owner-subject', 'owner', 'owner')
  seeded.close()
  const processor = createProcessorService(config, {
    databaseOpener: openTestDatabase,
  })
  const accepted = processor.runOnce()
  assert.equal(accepted.outcome, 'accepted')
  if (accepted.outcome !== 'accepted')
    throw new Error('processor save did not accept')
  assert.equal(accepted.assetIds.length, 1)
  assert.deepEqual(processor.runOnce(), accepted)
  processor.close()
  const inspected = createLocalWebService(databasePath)
  assert.equal(
    (
      inspected.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(
    (
      inspected.database
        .prepare(
          "SELECT count(*) AS count FROM source_ingest_events WHERE asset_id='asset-source-solar-001'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(existsSync(join(originals, 'asset-source-solar-001.tiff')), true)
  const savedDetail = JSON.parse(
    (
      inspected.database
        .prepare(
          "SELECT detail FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get() as { detail: string }
    ).detail,
  )
  assert.deepEqual(savedDetail.lineage, {
    sourceAssetIds: ['asset-source-solar-001'],
    runId: 'solar-run-001',
    solveAttemptId: 'solar-solve-001',
  })
  const before = (
    inspected.database
      .prepare(
        "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
      )
      .get() as { count: number }
  ).count
  inspected.close()
  writeFileSync(
    manifestPath,
    JSON.stringify({
      ...manifest,
      idempotencyKey: 'processor-metadata-mismatch',
      sourceIngest: undefined,
      metadata: {
        ...manifest.metadata,
        solveAttemptId: 'solar-solve-mismatch',
      },
    }),
  )
  const mismatched = createProcessorService(config, {
    databaseOpener: openTestDatabase,
  })
  assert.deepEqual(mismatched.runOnce(), {
    outcome: 'rejected',
    reason: 'InvalidInput',
  })
  mismatched.close()
  const mismatchInspection = createLocalWebService(databasePath)
  assert.equal(
    (
      mismatchInspection.database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get() as { count: number }
    ).count,
    before,
  )
  assert.equal(
    (
      mismatchInspection.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  mismatchInspection.close()
  writeFileSync(manifestPath, 'not json')
  const malformed = createProcessorService(config, {
    databaseOpener: openTestDatabase,
  })
  assert.deepEqual(malformed.runOnce(), {
    outcome: 'rejected',
    reason: 'InvalidManifest',
  })
  malformed.close()
  writeFileSync(
    manifestPath,
    JSON.stringify({
      ...manifest,
      idempotencyKey: 'processor-escape',
      sources: { final: '../outside.tiff' },
    }),
  )
  const escaped = createProcessorService(config, {
    databaseOpener: openTestDatabase,
  })
  assert.deepEqual(escaped.runOnce(), {
    outcome: 'rejected',
    reason: 'InvalidManifest',
  })
  escaped.close()
  writeFileSync(join(root, 'outside.tiff'), 'outside')
  symlinkSync(join(root, 'outside.tiff'), join(sources, 'link.tiff'))
  writeFileSync(
    manifestPath,
    JSON.stringify({
      ...manifest,
      idempotencyKey: 'processor-link',
      sources: { final: 'link.tiff' },
    }),
  )
  const linked = createProcessorService(config, {
    databaseOpener: openTestDatabase,
  })
  assert.equal(linked.runOnce().outcome, 'rejected')
  linked.close()
  const final = createLocalWebService(databasePath)
  assert.equal(
    (
      final.database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get() as { count: number }
    ).count,
    before,
  )
  assert.equal(
    (
      final.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  final.close()
})

test('source ingest records transaction-failure originals as checksum-backed orphans', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-source-orphan-'))
  const sources = join(root, 'sources')
  const originals = join(root, 'originals')
  mkdirSync(sources)
  writeFileSync(join(sources, 'original.fits'), 'original-bytes')
  const database = openMigrationDatabase(join(root, 'state.sqlite'), `${root}/`)
  database.exec(
    "CREATE TRIGGER reject_source_event BEFORE INSERT ON source_ingest_events BEGIN SELECT RAISE(ABORT, 'forced source ingest failure'); END;",
  )
  const result = ingestSourceAsset(
    database,
    {
      sourcesRoot: sources,
      originalsRoot: originals,
      sources: { original: 'original.fits' },
    },
    {
      assetId: 'asset-source-orphan-001',
      sourceId: 'original',
      format: 'fits',
      capturedAt: '2026-07-28T00:00:00.000Z',
      comparisonGroupId: 'solar-orphan-001',
      lineage: { runId: 'solar-run-001', solveAttemptId: 'solar-solve-001' },
      idempotencyKey: 'source-orphan-001',
    },
    { personId: 'owner', role: 'owner', capability: 'controlCapable' },
  )
  assert.deepEqual(result, {
    outcome: 'rejected',
    reason: 'MaterializationFailed',
  })
  const orphan = database
    .prepare('SELECT path,checksum FROM source_ingest_orphans')
    .get() as { path: string; checksum: string }
  assert.equal(existsSync(orphan.path), true)
  assert.match(orphan.checksum, /^[0-9a-f]{64}$/)
  assert.equal(
    (
      database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id='asset-source-orphan-001'",
        )
        .get() as { count: number }
    ).count,
    0,
  )
  database.close()
})

test('R2 publisher configuration and signed fake transport fail closed without network', async () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-r2-'))
  const credentialsPath = join(root, 'credentials.json')
  writeFileSync(
    credentialsPath,
    JSON.stringify({ accessKeyId: 'key', secretAccessKey: 'secret' }),
  )
  const config = {
    accountId: '503286fc7e5e8545c172105f991efef1',
    bucket: 'astro-console-artifacts',
    endpoint:
      'https://503286fc7e5e8545c172105f991efef1.r2.cloudflarestorage.com',
    credentialsPath: '/run/secrets/r2-credentials.json',
    databasePath: '/var/lib/astro-console/state.sqlite',
    outputsRoot: '/var/lib/astro-console/outputs',
  }
  const artifactPath = join(root, 'asset.tiff')
  const artifactBytes = Buffer.alloc(3 * 64 * 1024, 7)
  writeFileSync(artifactPath, artifactBytes)
  const artifact = {
    path: artifactPath,
    bytes: artifactBytes.byteLength,
    checksum: createHash('sha256').update(artifactBytes).digest('hex'),
  }
  const requests: Array<{ readonly url: string; readonly init: RequestInit }> =
    []
  const provider = createR2Provider(
    { ...config, credentialsPath },
    async (url, init) => {
      requests.push({ url, init })
      return init.method === 'HEAD'
        ? new Response(undefined, {
            status: 200,
            headers: { 'x-amz-meta-checksum': 'abc', 'content-length': '3' },
          })
        : new Response(undefined, { status: 200 })
    },
  )
  await provider.put('published/run/finals/asset.tiff', artifact, {
    assetId: 'asset',
    checksum: artifact.checksum,
  })
  assert.deepEqual(await provider.head('published/run/finals/asset.tiff'), {
    checksum: 'abc',
    bytes: 3,
  })
  const putHeaders = requests[0]?.init.headers as Record<string, string>
  assert.match(String(putHeaders.authorization), /^AWS4-HMAC-SHA256 /)
  assert.equal(putHeaders['x-amz-content-sha256'], artifact.checksum)
  assert.equal(putHeaders['x-amz-meta-asset-id'], 'asset')
  assert.equal(putHeaders['x-amz-meta-checksum'], artifact.checksum)
  assert.equal(putHeaders['content-length'], String(artifact.bytes))
  assert.equal(
    putHeaders['content-disposition'],
    'attachment; filename="asset.tiff"',
  )
  assert.equal(
    String(requests[0]?.url).includes(
      'astro-console-artifacts/published/run/finals/asset.tiff',
    ),
    true,
  )
  const body = requests[0]?.init.body
  assert.equal(body instanceof ReadableStream, true)
  if (!(body instanceof ReadableStream))
    throw new Error('R2 PUT body was not streamed')
  const reader = body.getReader()
  let maximumChunk = 0
  let streamedBytes = 0
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    maximumChunk = Math.max(maximumChunk, next.value.byteLength)
    streamedBytes += next.value.byteLength
  }
  assert.equal(streamedBytes, artifact.bytes)
  assert.ok(maximumChunk <= 64 * 1024)
  await assert.rejects(
    () =>
      provider.put('outside/key', artifact, {
        assetId: 'asset',
        checksum: artifact.checksum,
      }),
    /publisher prefix/,
  )
  const denied = createR2Provider(
    { ...config, credentialsPath },
    async () => new Response(undefined, { status: 403 }),
  )
  await assert.rejects(
    () =>
      denied.put('published/run/finals/asset.tiff', artifact, {
        assetId: 'asset',
        checksum: artifact.checksum,
      }),
    /R2 PUT failed/,
  )
  const downloadIssuer = createR2DownloadGrantIssuer({
    bucket: config.bucket,
    endpoint: config.endpoint,
    credentialsPath,
    now: () => new Date('2026-07-28T12:00:00.000Z'),
  })
  const signed = new URL(
    await downloadIssuer.issue({
      objectKey: 'published/run/finals/asset.tiff',
      expiresAt: '2026-07-28T12:05:00.000Z',
    }),
  )
  assert.equal(
    signed.pathname,
    '/astro-console-artifacts/published/run/finals/asset.tiff',
  )
  assert.equal(signed.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256')
  assert.equal(signed.searchParams.get('X-Amz-Expires'), '300')
  assert.match(
    signed.searchParams.get('X-Amz-Signature') ?? '',
    /^[0-9a-f]{64}$/,
  )
  assert.equal(signed.toString().includes('secret'), false)
  writeFileSync(
    credentialsPath,
    JSON.stringify({
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      extra: 'no',
    }),
  )
  assert.throws(
    () => createR2Provider({ ...config, credentialsPath }),
    /credentials are invalid/,
  )
})

test('authorized Library downloads issue an Asset-ID grant and redirect without projecting bearer data', async (t) => {
  let now = new Date('2026-07-28T12:00:00.000Z')
  let issuerUnavailable = false
  const grants: Array<{
    readonly objectKey: string
    readonly expiresAt: string
  }> = []
  const admission = (request?: IncomingMessage) =>
    request?.headers.authorization === 'Bearer viewer'
      ? {
          personId: 'viewer',
          clientId: 'viewer-desktop',
          role: 'viewer' as const,
          capability: 'readOnly' as const,
        }
      : request?.headers.authorization === 'Bearer owner'
        ? {
            personId: 'owner',
            clientId: 'owner-desktop',
            role: 'owner' as const,
            capability: 'controlCapable' as const,
          }
        : undefined
  const service = createFixtureService(
    ':memory:',
    admission,
    undefined,
    undefined,
    {
      now: () => now,
      issuer: {
        issue: async (grant) => {
          if (issuerUnavailable) throw new Error('R2 unavailable')
          grants.push(grant)
          return `https://r2.example/${grant.objectKey}?X-Amz-Signature=bearer-${grants.length}`
        },
      },
    },
  )
  const assetId = 'asset-m27-001'
  service.database
    .prepare(
      "UPDATE library_assets SET availability='published' WHERE asset_id=?",
    )
    .run(assetId)
  service.database
    .prepare(
      'INSERT INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)',
    )
    .run(
      assetId,
      'checksum',
      'published',
      now.toISOString(),
      'published/run-m27-001/finals/asset-m27-001-checksum.fits',
    )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const request = (authorization = 'Bearer viewer') =>
    fetch(`${base}/api/library/assets/${assetId}/download`, {
      headers: { authorization },
      redirect: 'manual',
    })
  assert.equal((await request('')).status, 401)
  const first = await request()
  assert.equal(first.status, 303)
  assert.equal(first.headers.get('cache-control'), 'private, no-store')
  assert.equal(first.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(
    first.headers.get('location'),
    'https://r2.example/published/run-m27-001/finals/asset-m27-001-checksum.fits?X-Amz-Signature=bearer-1',
  )
  assert.equal(await first.text(), '')
  assert.deepEqual(grants[0], {
    objectKey: 'published/run-m27-001/finals/asset-m27-001-checksum.fits',
    expiresAt: '2026-07-28T12:05:00.000Z',
  })
  const next = await request()
  assert.equal(next.status, 303)
  assert.equal(grants.length, 2)
  assert.equal(grants[1]?.expiresAt, '2026-07-28T12:05:00.000Z')
  assert.equal(
    JSON.stringify(
      await fetch(`${base}/api/snapshot`, {
        headers: { authorization: 'Bearer viewer' },
      }).then((response) => response.json()),
    ).includes('published/run'),
    false,
  )
  assert.equal(
    JSON.stringify(
      await fetch(`${base}/api/library/assets/${assetId}`, {
        headers: { authorization: 'Bearer viewer' },
      }).then((response) => response.json()),
    ).includes('published/run'),
    false,
  )
  now = new Date('2026-07-28T12:05:01.000Z')
  assert.equal((await request()).status, 303)
  assert.equal((await request('Bearer owner')).status, 303)
  service.database
    .prepare(
      "UPDATE library_assets SET availability='published' WHERE asset_id='asset-m27-002'",
    )
    .run()
  service.database
    .prepare(
      'INSERT INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)',
    )
    .run(
      'asset-m27-002',
      'checksum',
      'published',
      now.toISOString(),
      'published/run-m27-001/finals/asset-m27-002-checksum.fits',
    )
  assert.equal(
    (
      await fetch(
        `${base}/api/library/assets/asset-m27-002/download?requestId=ignored`,
        { headers: { authorization: 'Bearer viewer' }, redirect: 'manual' },
      )
    ).status,
    303,
  )
  service.database
    .prepare(
      "UPDATE asset_publications SET state='temporarilyUnavailable' WHERE asset_id=?",
    )
    .run(assetId)
  assert.equal((await request()).status, 409)
  assert.equal(
    (
      await fetch(`${base}/api/library/assets/asset-m27-999/download`, {
        headers: { authorization: 'Bearer viewer' },
        redirect: 'manual',
      })
    ).status,
    404,
  )
  assert.equal(
    (
      await fetch(`${base}/api/library/assets/not-an-asset/download`, {
        headers: { authorization: 'Bearer viewer' },
        redirect: 'manual',
      })
    ).status,
    400,
  )
  service.database
    .prepare("UPDATE asset_publications SET state='published' WHERE asset_id=?")
    .run(assetId)
  issuerUnavailable = true
  assert.equal((await request()).status, 503)
  const credentialFree = createFixtureService()
  const credentialFreeListener = await credentialFree.listen()
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:${credentialFreeListener.port}/api/library/assets/asset-m27-001/download`,
        { redirect: 'manual' },
      )
    ).status,
    503,
  )
  await credentialFreeListener.close()
  credentialFree.close()
})

test('download signer keeps mount configuration bounded and rejects unauthenticated or invalid internal requests', async (t) => {
  const secret = 'x'.repeat(32)
  const signer = createDownloadGrantService(
    {
      bucket: 'astro-console-artifacts',
      endpoint:
        'https://503286fc7e5e8545c172105f991efef1.r2.cloudflarestorage.com',
      credentialsPath: '/run/secrets/r2-download-credentials.json',
      secretPath: '/run/secrets/download-grant-shared-secret',
    },
    {
      secret,
      issuer: {
        issue: async () =>
          'https://r2.example/published/asset?X-Amz-Signature=private',
      },
    },
  )
  await new Promise<void>((resolve) => signer.listen(0, '127.0.0.1', resolve))
  const address = signer.address()
  if (address === null || typeof address === 'string')
    throw new Error('download signer did not bind TCP')
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        signer.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const endpoint = `http://127.0.0.1:${address.port}/internal/download-grants`
  const request = (body: string, authorization?: string) =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body,
    })
  const unauthenticated = await request(
    JSON.stringify({
      objectKey: 'published/a',
      expiresAt: '2026-07-28T12:05:00.000Z',
    }),
  )
  assert.equal(unauthenticated.status, 401)
  assert.equal((await unauthenticated.text()).includes('private'), false)
  const malformed = await request('not-json', `Bearer ${secret}`)
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.text()).includes('private'), false)
  const oversized = await request('x'.repeat(16_385), `Bearer ${secret}`)
  assert.equal(oversized.status, 413)
  assert.equal((await oversized.text()).includes('private'), false)
  const issued = await request(
    JSON.stringify({
      objectKey: 'published/a',
      expiresAt: '2026-07-28T12:05:00.000Z',
    }),
    `Bearer ${secret}`,
  )
  assert.equal(issued.status, 200)
  assert.equal(issued.headers.get('cache-control'), 'no-store')
})

test('publisher classifies only SQLite busy and locked errors as transient', () => {
  assert.equal(isSqliteBusy(new Error('SQLITE_BUSY: database is locked')), true)
  assert.equal(isSqliteBusy(new Error('SQLITE_LOCKED')), true)
  assert.equal(isSqliteBusy(new Error('R2 PUT failed with 403')), false)
  assert.equal(isSqliteBusy('database is locked'), false)
})

test('SQLite resilience creates a checked snapshot and disposable restore drill while refusing one filesystem', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-sqlite-resilience-'))
  const source = join(root, 'state.sqlite')
  const target = join(root, 'ssd', 'state.sqlite')
  const drill = join(root, 'drill.sqlite')
  const database = new DatabaseSync(source)
  database.exec(
    "CREATE TABLE evidence (value TEXT NOT NULL); INSERT INTO evidence VALUES ('durable');",
  )
  database.close()
  assert.throws(
    () => assertSeparateFilesystems(source, join(root, 'ssd'), () => 7),
    /different filesystem/,
  )
  assert.doesNotThrow(() =>
    assertSeparateFilesystems(source, join(root, 'ssd'), (path) =>
      path === source ? 7 : 8,
    ),
  )
  const snapshot = createSqliteSnapshot(source, target)
  assert.equal(snapshot.integrity, 'ok')
  assert.equal(snapshot.path, 'state.sqlite')
  assert.ok(snapshot.bytes > 0)
  assert.equal(snapshot.sha256, verifySqlite(target).sha256)
  const restored = restoreDrill(target, drill)
  assert.equal(restored.source.integrity, 'ok')
  assert.equal(restored.restored.integrity, 'ok')
  assert.match(restored.restored.sha256, /^[0-9a-f]{64}$/)
  assert.equal(existsSync(drill), false)
  assert.throws(() => restoreDrill(target, target), /separate/)
})

test('Process Save materializes configured sources before one Asset, lineage, receipt, and publication outbox transaction', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-save-'))
  const sources = join(root, 'sources')
  const outputs = join(root, 'outputs')
  writeFileSync(join(root, 'outside.fits'), 'outside')
  mkdirSync(sources)
  writeFileSync(join(sources, 'linear.fits'), 'linear-bytes')
  writeFileSync(join(sources, 'final.tiff'), 'final-bytes')
  const service = createFixtureService(
    join(root, 'state.sqlite'),
    undefined,
    undefined,
    {
      sourcesRoot: sources,
      outputsRoot: outputs,
      sources: {
        linear: 'linear.fits',
        final: 'final.tiff',
        escape: '../outside.fits',
      },
    },
  )
  const command = {
    sessionId: 'process-m27-001',
    expectedRevision: 4,
    idempotencyKey: 'save-1',
    outputs: [
      { sourceId: 'linear', representation: 'linearMaster' },
      { sourceId: 'final', representation: 'final' },
    ],
  }
  const accepted = service.saveProcess(command)
  assert.equal(accepted.outcome, 'accepted')
  if (accepted.outcome !== 'accepted') throw new Error('save did not accept')
  assert.equal(accepted.assetIds.length, 2)
  assert.equal(readdirSync(outputs).length, 2)
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM process_asset_events')
        .get() as { count: number }
    ).count,
    2,
  )
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get() as { count: number }
    ).count,
    2,
  )
  const event = service.database
    .prepare('SELECT checksum FROM process_asset_events WHERE asset_id=?')
    .get(accepted.assetIds[0]) as { checksum: string }
  const savedName = readdirSync(outputs).find((name) =>
    name.startsWith(accepted.assetIds[0]),
  )
  assert.equal(
    event.checksum,
    createHash('sha256')
      .update(readFileSync(join(outputs, savedName ?? 'missing')))
      .digest('hex'),
  )
  assert.deepEqual(service.saveProcess(command), accepted)
  assert.equal(readdirSync(outputs).length, 2)
  const detail = service.database
    .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
    .get(accepted.assetIds[0]) as { detail: string }
  assert.doesNotMatch(
    detail.detail,
    new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
  assert.doesNotMatch(detail.detail, /outputs|checksum|storage/i)
  assert.equal(
    service.saveProcess({
      ...command,
      idempotencyKey: 'escape',
      outputs: [{ sourceId: '../outside.fits', representation: 'final' }],
    }).outcome,
    'rejected',
  )
  service.close()
})

test('Process Save rejects symlinks and records transaction-failure bytes as removable orphans', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-orphan-'))
  const sources = join(root, 'sources')
  const outputs = join(root, 'outputs')
  mkdirSync(sources)
  writeFileSync(join(sources, 'source.fits'), 'bytes')
  writeFileSync(join(root, 'outside.fits'), 'outside')
  symlinkSync(join(root, 'outside.fits'), join(sources, 'link.fits'))
  const service = createFixtureService(
    join(root, 'state.sqlite'),
    undefined,
    undefined,
    {
      sourcesRoot: sources,
      outputsRoot: outputs,
      sources: { source: 'source.fits', link: 'link.fits' },
    },
  )
  assert.equal(
    service.saveProcess({
      sessionId: 'process-m27-001',
      expectedRevision: 4,
      idempotencyKey: 'symlink',
      outputs: [{ sourceId: 'link', representation: 'final' }],
    }).outcome,
    'rejected',
  )
  service.database.exec(
    "CREATE TRIGGER reject_publication BEFORE INSERT ON outbox WHEN NEW.kind='PublishAsset' BEGIN SELECT RAISE(ABORT, 'forced publication failure'); END;",
  )
  const failed = service.saveProcess({
    sessionId: 'process-m27-001',
    expectedRevision: 4,
    idempotencyKey: 'commit-failure',
    outputs: [{ sourceId: 'source', representation: 'final' }],
  })
  assert.deepEqual(failed, {
    outcome: 'rejected',
    reason: 'MaterializationFailed',
  })
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM process_save_orphans')
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(service.cleanupSavedOrphans(), 1)
  assert.equal(readdirSync(outputs).length, 0)
  service.close()
})

test('Process Save leaves no success metadata when later filesystem materialization fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-write-failure-'))
  const sources = join(root, 'sources')
  const outputs = join(root, 'outputs')
  mkdirSync(sources)
  writeFileSync(join(sources, 'first.fits'), 'first')
  const service = createFixtureService(
    join(root, 'state.sqlite'),
    undefined,
    undefined,
    {
      sourcesRoot: sources,
      outputsRoot: outputs,
      sources: { first: 'first.fits', missing: 'missing.tiff' },
    },
  )
  const result = service.saveProcess({
    sessionId: 'process-m27-001',
    expectedRevision: 4,
    idempotencyKey: 'write-failure',
    outputs: [
      { sourceId: 'first', representation: 'linearMaster' },
      { sourceId: 'missing', representation: 'final' },
    ],
  })
  assert.deepEqual(result, {
    outcome: 'rejected',
    reason: 'MaterializationFailed',
  })
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM process_save_receipts')
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM process_save_orphans')
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(
    readdirSync(outputs).some((name) => name.endsWith('.tmp')),
    false,
  )
  assert.equal(service.cleanupSavedOrphans(), 1)
  assert.equal(readdirSync(outputs).length, 0)
  service.close()
})

test('publisher worker verifies fake provider metadata, retries idempotently, and keeps Library detail safe', async () => {
  const { root, outputs, service, saved } = publisherFixture('publisher-save')
  const checksum = (
    service.database
      .prepare('SELECT checksum FROM process_asset_events WHERE asset_id=?')
      .get(saved.assetIds[0]) as { checksum: string }
  ).checksum
  service.database
    .prepare(
      'INSERT INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)',
    )
    .run(
      saved.assetIds[0],
      checksum,
      'temporarilyUnavailable',
      new Date().toISOString(),
      '',
    )
  const objects = new Map<
    string,
    { readonly bytes: number; readonly checksum: string }
  >()
  let mismatch = true
  let puts = 0
  const worker = createPublisherWorker(
    service.database,
    { outputsRoot: outputs },
    {
      put: async (key, file, metadata) => {
        puts += 1
        assert.equal(file.checksum, metadata.checksum)
        assert.equal(file.bytes, 17)
        objects.set(key, { bytes: file.bytes, checksum: metadata.checksum })
      },
      head: async (key) => {
        const object = objects.get(key)
        return object === undefined
          ? undefined
          : {
              checksum: mismatch ? 'wrong-checksum' : object.checksum,
              bytes: object.bytes,
            }
      },
    },
  )
  assert.equal(await worker.pass(), 'failed')
  assert.equal(
    service.database
      .prepare('SELECT availability FROM library_assets WHERE asset_id=?')
      .get(saved.assetIds[0]).availability,
    'failedPublication',
  )
  mismatch = false
  assert.equal(await worker.pass(), 'published')
  assert.equal(await worker.pass(), 'none')
  assert.equal(puts, 2)
  assert.equal(objects.size, 1)
  assert.equal(
    service.database
      .prepare('SELECT object_key FROM asset_publications WHERE asset_id=?')
      .get(saved.assetIds[0]).object_key,
    [...objects.keys()][0],
  )
  assert.match(
    [...objects.keys()][0] ?? '',
    /^published\/run-m27-001\/finals\//,
  )
  const detail = service.database
    .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
    .get(saved.assetIds[0]).detail as string
  assert.match(detail, /published/)
  assert.doesNotMatch(
    detail,
    new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
  assert.doesNotMatch(detail, /published\/run|checksum|credential|key/i)
  service.close()
})

test('publisher worker fails closed on conflicting durable publication checksum', async () => {
  const { outputs, service, saved } = publisherFixture(
    'publisher-conflict-save',
  )
  service.database
    .prepare(
      'INSERT INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)',
    )
    .run(
      saved.assetIds[0],
      'conflicting-checksum',
      'temporarilyUnavailable',
      new Date().toISOString(),
      'published/run-m27-001/finals/old',
    )
  let puts = 0
  const worker = createPublisherWorker(
    service.database,
    { outputsRoot: outputs },
    {
      put: async () => {
        puts += 1
      },
      head: async () => undefined,
    },
  )
  assert.equal(await worker.pass(), 'failed')
  assert.equal(puts, 0)
  assert.equal(
    service.database
      .prepare('SELECT state FROM asset_publications WHERE asset_id=?')
      .get(saved.assetIds[0]).state,
    'failedPublication',
  )
  assert.equal(
    service.database
      .prepare("SELECT state FROM outbox WHERE kind='PublishAsset'")
      .get().state,
    'failed',
  )
  service.close()
})

test('publisher worker lease expiry and stale acknowledgements cannot project stale provider work', async () => {
  const { outputs, service, saved } = publisherFixture('publisher-lease-save')
  const keys: string[] = []
  let stale = true
  const worker = createPublisherWorker(
    service.database,
    { outputsRoot: outputs },
    {
      put: async (key) => {
        keys.push(key)
        if (stale) {
          stale = false
          service.database
            .prepare(
              "UPDATE outbox SET claim_token='newer-worker',claim_until=? WHERE kind='PublishAsset'",
            )
            .run('2000-01-01T00:00:00.000Z')
        }
      },
      head: async () => ({
        checksum: createHash('sha256')
          .update('publication-bytes')
          .digest('hex'),
        bytes: 17,
      }),
    },
  )
  assert.equal(await worker.pass(), 'superseded')
  assert.equal(await worker.pass('replacement'), 'published')
  const row = service.database
    .prepare("SELECT state,attempts FROM outbox WHERE kind='PublishAsset'")
    .get() as { state: string; attempts: number }
  assert.equal(row.state, 'dispatched')
  assert.equal(row.attempts, 2)
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  assert.equal(
    service.database
      .prepare('SELECT availability FROM library_assets WHERE asset_id=?')
      .get(saved.assetIds[0]).availability,
    'published',
  )
  service.close()
})

test('SQLite acceptance atomically persists fixture run, event, and receipt without hardware work', async (t) => {
  const service = createFixtureService(
    join(mkdtempSync(join(tmpdir(), 'astro-local-')), 'state.sqlite'),
  )
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const base = `http://127.0.0.1:${listener.port}`
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  const command = {
    _tag: 'StartRunFromPlan',
    planId: 'plan-m27',
    expectedPlanRevision: snapshot.plan.revision,
    expectedLeaseRevision: snapshot.control.revision,
    idempotencyKey: 'm27-accept-1',
  }
  const accepted = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
  assert.equal(accepted.status, 202)
  assert.equal((await accepted.json()).outcome, 'accepted')
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM events')
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM receipts')
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM outbox')
        .get() as { count: number }
    ).count,
    0,
  )
  const replay = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
  assert.equal(replay.status, 200)
  await listener.close()
  service.close()
})

test('numbered SQLite migrations upgrade a legacy database and reject a newer schema', () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-migrations-')),
    'state.sqlite',
  )
  const legacy = new DatabaseSync(databasePath)
  legacy.exec(
    'CREATE TABLE state (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE events (cursor INTEGER PRIMARY KEY,type TEXT NOT NULL,snapshot TEXT NOT NULL); CREATE TABLE receipts (idempotency_key TEXT PRIMARY KEY,response TEXT NOT NULL); CREATE TABLE outbox (id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL); CREATE TABLE control_requests (client_id TEXT PRIMARY KEY,person_id TEXT NOT NULL); CREATE TABLE memberships (external_subject TEXT PRIMARY KEY,person_id TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE library_assets (asset_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,role TEXT NOT NULL,format TEXT NOT NULL,availability TEXT NOT NULL,comparison_group_id TEXT NOT NULL,captured_at TEXT NOT NULL,updated_at TEXT NOT NULL,sharpness REAL NOT NULL,detail TEXT NOT NULL);',
  )
  legacy.close()
  const service = createFixtureService(databasePath)
  assert.equal(
    (
      service.database
        .prepare('SELECT max(version) AS version FROM schema_migrations')
        .get() as { version: number }
    ).version,
    20,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM workspace_projections')
        .get() as { count: number }
    ).count,
    2,
  )
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM pragma_table_info('outbox') WHERE name='claim_token'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  service.close()
  const freshPath = join(
    mkdtempSync(join(tmpdir(), 'astro-fresh-migrations-')),
    'state.sqlite',
  )
  const fresh = createLocalWebService(freshPath)
  assert.equal(
    (
      fresh.database
        .prepare('SELECT max(version) AS version FROM schema_migrations')
        .get() as { version: number }
    ).version,
    20,
  )
  assert.equal(
    (
      fresh.database
        .prepare(
          "SELECT count(*) AS count FROM pragma_table_info('observing_plans') WHERE name='run_eligible'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  fresh.close()
  const fixturePath = join(
    mkdtempSync(join(tmpdir(), 'astro-legacy-plan-')),
    'state.sqlite',
  )
  const seeded = createFixtureService(fixturePath)
  seeded.database
    .prepare('DELETE FROM schema_migrations WHERE version>13')
    .run()
  seeded.database.exec(
    'DROP TABLE observing_plans; DROP TABLE observing_plan_receipts',
  )
  seeded.database
    .prepare("UPDATE workspace_projections SET value=? WHERE name='plan'")
    .run(
      JSON.stringify({
        planId: 'plan-m27',
        revision: 3,
        target: 'M27 · Dumbbell Nebula',
        readiness: 'ready',
        readinessSummary: 'Legacy fixture projection.',
        observingWindow: {
          startsAt: '2026-07-25T03:18:00.000Z',
          endsAt: '2026-07-25T05:02:00.000Z',
          usableMinutes: 104,
          peakAltitudeDeg: 62,
          horizonClearanceDeg: 28,
        },
        sequences: [
          {
            sequenceId: 'sequence-m27-luminance',
            target: 'M27 · Dumbbell Nebula',
            capture: '24 × 180s · L',
            acquisition: 'Solve, center, focus, then start capture.',
            stopCondition: 'Stop at 24 verified frames or 01:02 local.',
            viability: 'viable',
          },
        ],
      }),
    )
  seeded.close()
  const migratedFixture = createFixtureService(fixturePath)
  const migratedPlan = JSON.parse(
    (
      migratedFixture.database
        .prepare("SELECT value FROM workspace_projections WHERE name='plan'")
        .get() as { value: string }
    ).value,
  )
  assert.equal(migratedPlan.sequences.length, 2)
  assert.deepEqual(migratedPlan.limitations, [])
  assert.equal(migratedPlan.sequences[0].window.horizonClearanceDeg, 28)
  migratedFixture.close()
  const recorded15Path = join(
    mkdtempSync(join(tmpdir(), 'astro-recorded-15-plan-')),
    'state.sqlite',
  )
  const recorded15 = createFixtureService(recorded15Path)
  recorded15.database
    .prepare('DELETE FROM schema_migrations WHERE version>=16')
    .run()
  recorded15.database
    .prepare("UPDATE workspace_projections SET value=? WHERE name='plan'")
    .run(
      JSON.stringify({
        planId: 'plan-m27',
        revision: 3,
        target: 'M27',
        readiness: 'ready',
        readinessSummary: 'Recorded schema-15 fixture projection.',
        observingWindow: {
          startsAt: '2026-07-25T03:18:00.000Z',
          endsAt: '2026-07-25T05:02:00.000Z',
          usableMinutes: 104,
          peakAltitudeDeg: 62,
          horizonClearanceDeg: 28,
        },
        sequences: [
          {
            sequenceId: 'legacy-l',
            order: 1,
            target: 'M27',
            capture: '24 × 180s · L',
            acquisition: 'Solve and center.',
            stopCondition: 'Window end.',
            viability: 'viable',
          },
        ],
      }),
    )
  recorded15.close()
  const repaired = createFixtureService(recorded15Path)
  const repairedPlan = JSON.parse(
    (
      repaired.database
        .prepare("SELECT value FROM workspace_projections WHERE name='plan'")
        .get() as { value: string }
    ).value,
  )
  assert.equal(repairedPlan.sequences.length, 2)
  assert.deepEqual(repairedPlan.limitations, [])
  assert.equal(
    (
      repaired.database
        .prepare('SELECT max(version) AS version FROM schema_migrations')
        .get() as { version: number }
    ).version,
    20,
  )
  repaired.close()
  const newer = new DatabaseSync(databasePath)
  newer
    .prepare('INSERT INTO schema_migrations VALUES (?,?)')
    .run(99, '2026-07-24T00:00:00.000Z')
  newer.close()
  assert.throws(
    () => createFixtureService(databasePath),
    /newer than this release/,
  )
})

test('origin admission factory consumes decoded configuration', async (t) => {
  const config = await Effect.runPromise(
    originServerConfig.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ ASTRO_LOCAL_WEB_CLIENT: 'phone' }),
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

test('disabled rig worker exits without creating or mutating its database', async () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-worker-disabled-')),
    'state.sqlite',
  )
  const worker = createRigWorkerService(
    { mode: 'disabled', databasePath },
    { startM27Capture: async () => true },
  )
  assert.equal(await worker.runOnce(), 'disabled')
  assert.deepEqual(await worker.run(), {
    passes: 0,
    health: { mode: 'disabled', status: 'disabled', databasePath },
  })
  assert.deepEqual(await runRigWorker({ mode: 'disabled', databasePath }), {
    passes: 0,
    health: { mode: 'disabled', status: 'disabled', databasePath },
  })
  assert.equal(existsSync(databasePath), false)
})

test('non-fixture origin, workers, and service databases migrate without M27 Plan, Library, or Process seeds', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astro-no-fixture-'))
  const allowedRoot = `${root}/`
  const origin = createLocalWebService(join(root, 'origin.sqlite'))
  assertNoM27Fixture(origin.database)
  const listener = await origin.listen()
  t.after(async () => {
    await listener.close()
    origin.close()
  })
  const base = `http://127.0.0.1:${listener.port}`
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  const ready = await fetch(`${base}/api/health/ready`).then((response) =>
    response.json(),
  )
  assert.equal(snapshot.plan.readiness, 'unavailable')
  assert.equal(snapshot.plan.id, 'uninitialized')
  assert.equal(ready.status, 'unavailable')
  const shell = await fetch(`${base}/`).then((response) => response.text())
  assert.doesNotMatch(shell, /M27|Run plan/)
  assert.match(shell, /unavailable|No observation plan is installed/)
  const start = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'uninitialized',
      expectedPlanRevision: 0,
      expectedLeaseRevision: 0,
      idempotencyKey: 'uninitialized-start',
    }),
  })
  assert.equal(start.status, 409)
  assert.equal((await start.json()).reason, 'PlanUnavailable')
  assert.equal(
    (
      origin.database.prepare('SELECT count(*) AS count FROM events').get() as {
        count: number
      }
    ).count,
    0,
  )
  await new Promise<void>((resolve) => setTimeout(resolve, 300))
  assert.equal((await fetch(`${base}/api/snapshot`)).status, 200)
  const publisher = openPublisherDatabase(
    join(root, 'publisher.sqlite'),
    allowedRoot,
  )
  assertNoM27Fixture(publisher)
  publisher.close()
  const processor = openProcessorDatabase(
    join(root, 'processor.sqlite'),
    allowedRoot,
  )
  assertNoM27Fixture(processor)
  processor.close()

  const workerPath = join(root, 'worker.sqlite')
  const worker = createRigWorkerService(
    {
      mode: 'seestar',
      databasePath: workerPath,
      rigId: 'seestar-s30',
      host: '192.168.4.63',
      pemPath: '/run/secrets/seestar.pem',
    },
    undefined,
  )
  worker.close()
  const workerDatabase = openMigrationDatabase(workerPath, allowedRoot)
  assertNoM27Fixture(workerDatabase)
  workerDatabase.close()

  const solarPath = join(root, 'solar.sqlite')
  const solar = createLocalWebService(solarPath)
  solar.database
    .prepare('INSERT INTO memberships VALUES (?,?,?)')
    .run('solar-owner', 'owner', 'owner')
  assertNoM27Fixture(solar.database)
  solar.close()
  const solarResult = runSolarTestIntent({
    databasePath: solarPath,
    subject: 'solar-owner',
    command: {
      action: 'submit',
      name: 'Solar fixture boundary',
      idempotencyKey: 'solar-no-fixture',
    },
  })
  assert.equal(solarResult.outcome, 'accepted')
  const solarDatabase = openMigrationDatabase(solarPath, allowedRoot)
  assertNoM27Fixture(solarDatabase)
  solarDatabase.close()
})

test('owner-only Solar test intent persists separate pending work and Stack-evidence boundary', () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-solar-intent-')),
    'state.sqlite',
  )
  const service = createFixtureService(databasePath)
  const input = {
    name: 'Solar filter verification',
    idempotencyKey: 'solar-test-001',
  }
  assert.deepEqual(
    service.submitSolarTestIntent(input, {
      personId: 'viewer',
      clientId: 'viewer',
      role: 'viewer',
      capability: 'controlCapable',
    }),
    { outcome: 'rejected', reason: 'OwnerRequired' },
  )
  assert.deepEqual(
    service.submitSolarTestIntent(input, {
      personId: 'owner',
      clientId: 'phone',
      role: 'owner',
      capability: 'readOnly',
    }),
    { outcome: 'rejected', reason: 'ClientReadOnly' },
  )
  assert.deepEqual(
    service.submitSolarTestIntent(
      { name: 'x', idempotencyKey: 'bad' },
      {
        personId: 'owner',
        clientId: 'desktop',
        role: 'owner',
        capability: 'controlCapable',
      },
    ),
    { outcome: 'rejected', reason: 'InvalidInput' },
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM solar_test_intents')
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM outbox')
        .get() as { count: number }
    ).count,
    0,
  )
  const accepted = service.submitSolarTestIntent(input, {
    personId: 'owner',
    clientId: 'desktop',
    role: 'owner',
    capability: 'controlCapable',
  })
  assert.equal(accepted.outcome, 'accepted')
  if (accepted.outcome !== 'accepted')
    throw new Error('Expected Solar test intent acceptance')
  assert.equal(accepted.state, 'awaitingAdapter')
  assert.equal(accepted.evidence, 'awaitingStackEvidence')
  const intent = service.database
    .prepare(
      'SELECT name,owner_person_id,owner_client_id,state FROM solar_test_intents WHERE intent_id=?',
    )
    .get(accepted.intentId) as {
    name: string
    owner_person_id: string
    owner_client_id: string
    state: string
  }
  assert.equal(intent.name, input.name)
  assert.equal(intent.owner_person_id, 'owner')
  assert.equal(intent.owner_client_id, 'desktop')
  assert.equal(intent.state, 'awaitingAdapter')
  const evidence = service.database
    .prepare('SELECT state,message FROM solar_test_evidence WHERE intent_id=?')
    .get(accepted.intentId) as { state: string; message: string }
  assert.equal(evidence.state, 'awaitingStackEvidence')
  assert.match(evidence.message, /Stack evidence/)
  const outbox = service.database
    .prepare(
      "SELECT kind,payload,state,attempts FROM outbox WHERE kind='StartSolarTestObservation'",
    )
    .get() as { kind: string; payload: string; state: string; attempts: number }
  assert.equal(outbox.kind, 'StartSolarTestObservation')
  assert.equal(outbox.state, 'pending')
  assert.equal(outbox.attempts, 0)
  assert.deepEqual(JSON.parse(outbox.payload), {
    intentId: accepted.intentId,
    name: input.name,
    target: 'Sun',
    requiredEvidence: 'Stack',
  })
  assert.deepEqual(
    service.submitSolarTestIntent(input, {
      personId: 'owner',
      clientId: 'desktop',
      role: 'owner',
      capability: 'controlCapable',
    }),
    accepted,
  )
  assert.deepEqual(
    service.submitSolarTestIntent(
      {
        name: 'Solar filter verification retry changed',
        idempotencyKey: input.idempotencyKey,
      },
      {
        personId: 'owner',
        clientId: 'desktop',
        role: 'owner',
        capability: 'controlCapable',
      },
    ),
    { outcome: 'rejected', reason: 'InvalidInput' },
  )
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='StartSolarTestObservation'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  assert.deepEqual(
    service.submitSolarTestIntent(
      { name: 'Second Solar test', idempotencyKey: 'solar-test-002' },
      {
        personId: 'owner',
        clientId: 'desktop',
        role: 'owner',
        capability: 'controlCapable',
      },
    ),
    { outcome: 'rejected', reason: 'SolarTestPending' },
  )
  service.close()
  const recovered = createFixtureService(databasePath)
  assert.deepEqual(
    recovered.submitSolarTestIntent(input, {
      personId: 'owner',
      clientId: 'desktop',
      role: 'owner',
      capability: 'controlCapable',
    }),
    accepted,
  )
  const recoveredOutbox = recovered.database
    .prepare(
      "SELECT state,attempts FROM outbox WHERE kind='StartSolarTestObservation'",
    )
    .get() as { state: string; attempts: number }
  assert.equal(recoveredOutbox.state, 'pending')
  assert.equal(recoveredOutbox.attempts, 0)
  recovered.close()
})

test('Solar test CLI runner consumes decoded configuration', () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-solar-cli-')),
    'state.sqlite',
  )
  assert.equal(existsSync(databasePath), false)
  const seeded = createFixtureService(databasePath)
  seeded.database
    .prepare('INSERT INTO memberships VALUES (?,?,?)')
    .run('solar-owner-subject', 'owner', 'owner')
  seeded.database
    .prepare('INSERT INTO memberships VALUES (?,?,?)')
    .run('solar-viewer-subject', 'viewer', 'viewer')
  seeded.close()
  const base = {
    databasePath,
    command: {
      action: 'submit' as const,
      name: 'Solar filter verification',
      idempotencyKey: 'solar-cli-001',
    },
  }
  assert.deepEqual(
    runSolarTestIntent({ ...base, subject: 'unknown-subject' }),
    { outcome: 'rejected', reason: 'OwnerRequired' },
  )
  assert.deepEqual(
    runSolarTestIntent({ ...base, subject: 'solar-viewer-subject' }),
    { outcome: 'rejected', reason: 'OwnerRequired' },
  )
  const result = runSolarTestIntent({ ...base, subject: 'solar-owner-subject' })
  assert.equal(result.outcome, 'accepted')
  if (result.outcome !== 'accepted')
    throw new Error('Expected Solar CLI acceptance')
  const stopped = runSolarTestIntent({
    databasePath,
    subject: 'solar-owner-subject',
    command: { action: 'stop', intentId: result.intentId },
  })
  assert.deepEqual(stopped, { outcome: 'accepted' })
  const inspected = createFixtureService(databasePath)
  assert.equal(
    inspected.database
      .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
      .get(result.intentId).state,
    'stopping',
  )
  assert.equal(
    inspected.database
      .prepare("SELECT state FROM outbox WHERE kind='StopSolarTestObservation'")
      .get().state,
    'pending',
  )
  inspected.close()
})

test('Solar adapter stop closes Stack before the Solar view', async () => {
  const calls: string[] = []
  const adapter = createSeestarSolarAdapter(
    {
      mode: 'seestar',
      databasePath: '/state.sqlite',
      rigId: 'seestar-s30',
      host: '192.168.4.63',
      pemPath: '/run/secrets/seestar.pem',
    },
    {
      onStack: () => undefined,
      deviceFactory: () => ({
        connectAndAuth: async () => true,
        disconnect: () => undefined,
        preflightCheck: async () => ({
          host: '192.168.4.63',
          raw: {
            deviceState: null,
            viewState: null,
            setting: null,
            diskVolume: null,
            piInfo: null,
            time: null,
          },
          warnings: [],
        }),
        startStack: async () => true,
        startView: async () => true,
        stopStack: async () => {
          calls.push('stack')
          return true
        },
        stopView: async () => {
          calls.push('view')
          return true
        },
        rawClient: { subscribeToPushEvents: () => () => undefined },
      }),
    },
  )
  assert.equal(await adapter.stopSolarTestObservation('solar-intent'), true)
  assert.deepEqual(calls, ['stack', 'view'])
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
  assert.equal(operations.release, 'local-web-fixture')
  assert.equal(operations.schemaVersion, 20)
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

test('request-context admission rejects before snapshot, stream, query, or mutation routing', async (t) => {
  const service = createFixtureService(':memory:', (request) =>
    request?.headers.authorization === 'Bearer verified-owner'
      ? {
          personId: 'owner-chicks',
          clientId: 'desktop-owner',
          capability: 'controlCapable',
          role: 'owner',
        }
      : undefined,
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  for (const path of ['/api/snapshot', '/api/events', '/api/library'])
    assert.equal((await fetch(`${base}${path}`)).status, 401)
  assert.equal(
    (
      await fetch(`${base}/api/commands/start-run`, {
        method: 'POST',
        body: JSON.stringify({
          personId: 'owner-chicks',
          capability: 'controlCapable',
        }),
      })
    ).status,
    401,
  )
  const admitted = await fetch(`${base}/api/snapshot`, {
    headers: {
      authorization: 'Bearer verified-owner',
      'x-client-capability': 'readOnly',
    },
  }).then((response) => response.json())
  assert.equal(admitted.identity.capability, 'controlCapable')
})

test('verified Access assertions map durable memberships without trusting request authority', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-access-')),
    'state.sqlite',
  )
  const seeded = createFixtureService(databasePath)
  seeded.database
    .prepare('INSERT INTO memberships VALUES (?,?,?)')
    .run('access-owner', 'owner-chicks', 'owner')
  seeded.database
    .prepare('INSERT INTO memberships VALUES (?,?,?)')
    .run('access-viewer', 'maya', 'viewer')
  seeded.close()
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const issuer = 'https://chicks.cloudflareaccess.com'
  const audience = 'access-audience'
  const claim = (subject: string, overrides: Record<string, unknown> = {}) => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid: 'fixture-key', typ: 'JWT' }),
    ).toString('base64url')
    const email =
      subject === 'access-owner'
        ? 'owner@example.com'
        : subject === 'access-viewer'
          ? 'viewer@example.com'
          : 'unknown@example.com'
    const payload = Buffer.from(
      JSON.stringify({
        sub: subject,
        email,
        iss: issuer,
        aud: audience,
        exp: Math.floor(Date.now() / 1_000) + 60,
        ...overrides,
      }),
    ).toString('base64url')
    return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`
  }
  const keyResolver = createJwksKeyResolver({
    url: 'https://chicks.cloudflareaccess.com/cdn-cgi/access/certs',
    fetcher: async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          keys: [
            {
              ...keys.publicKey.export({ format: 'jwk' }),
              kid: 'fixture-key',
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
    bootstrap: [
      { email: 'owner@example.com', personId: 'owner-chicks', role: 'owner' },
      { email: 'viewer@example.com', personId: 'maya', role: 'viewer' },
    ],
  })
  const service = createFixtureService(databasePath, admission)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const authorized = (token: string) => ({
    'cf-access-jwt-assertion': token,
    'x-client-capability': 'controlCapable',
  })
  const owner = await fetch(`${base}/api/snapshot`, {
    headers: authorized(claim('access-owner')),
  }).then((response) => response.json())
  assert.equal(owner.identity.personId, 'owner-chicks')
  assert.equal(owner.identity.capability, 'controlCapable')
  const viewer = await fetch(`${base}/api/snapshot`, {
    headers: authorized(claim('access-viewer')),
  }).then((response) => response.json())
  assert.equal(viewer.identity.capability, 'readOnly')
  assert.equal(
    (
      await fetch(`${base}/api/commands/start-run`, {
        method: 'POST',
        headers: authorized(claim('access-viewer')),
        body: JSON.stringify({
          _tag: 'StartRunFromPlan',
          planId: 'plan-m27',
          expectedPlanRevision: 3,
          expectedLeaseRevision: 1,
          idempotencyKey: 'viewer-start',
        }),
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(`${base}/api/snapshot`, {
        headers: authorized(claim('unknown-subject')),
      })
    ).status,
    401,
  )
  for (const token of [
    claim('access-owner', { exp: Math.floor(Date.now() / 1_000) - 1 }),
    claim('access-owner', { iss: 'https://forged.example' }),
    claim('access-owner', { aud: 'wrong-audience' }),
    `${claim('access-owner')}.forged`,
  ])
    assert.equal(
      (await fetch(`${base}/api/snapshot`, { headers: authorized(token) }))
        .status,
      401,
    )
})

test('production admission rechecks normalized bootstrap policy and revokes removed viewer subjects', async (t) => {
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
  }
  const admitted = createProductionAccessAdmission(config)
  const request = {
    headers: { 'cf-access-jwt-assertion': claim('viewer@example.com') },
  } as IncomingMessage
  assert.deepEqual(await admitted(request), {
    personId: 'viewer',
    clientId: 'access:viewer-subject',
    capability: 'readOnly',
    role: 'viewer',
  })
  assert.equal(
    (
      new DatabaseSync(databasePath)
        .prepare(
          "SELECT count(*) AS count FROM memberships WHERE external_subject='viewer-subject'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  const revoked = createProductionAccessAdmission({ ...config, bootstrap: [] })
  assert.equal(await revoked(request), undefined)
  assert.throws(
    () =>
      createProductionAccessAdmission({
        ...config,
        bootstrap: [
          { ...config.bootstrap[0] },
          { ...config.bootstrap[0], email: 'viewer@example.com' },
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
  } as IncomingMessage
  assert.equal((await admission(request))?.personId, 'reload-owner')
  unlinkSync(bootstrapPath)
  now += 1_000
  assert.equal(await admission(request), undefined)
})

test('a configured non-fixture owner has role-based operations and grant authority while viewers and phones remain read-only', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-role-owner-')),
    'state.sqlite',
  )
  const seeded = createFixtureService(databasePath)
  seeded.close()
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const issuer = 'https://access.example'
  const audience = 'role-audience'
  const claim = (subject: string, email: string) => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid: 'owner-key' }),
    ).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({
        sub: subject,
        email,
        iss: issuer,
        aud: audience,
        exp: Math.floor(Date.now() / 1_000) + 60,
      }),
    ).toString('base64url')
    return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`
  }
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
              kid: 'owner-key',
              use: 'sig',
            },
          ],
        }),
    }),
  })
  const config = {
    issuer,
    audience,
    keyResolver,
    databasePath,
    clientContext: 'desktop' as const,
    bootstrap: [
      {
        email: 'owner@example.com',
        personId: 'observatory-primary',
        role: 'owner' as const,
      },
      {
        email: 'viewer@example.com',
        personId: 'guest-observer',
        role: 'viewer' as const,
      },
    ],
  }
  const service = createFixtureService(
    databasePath,
    createProductionAccessAdmission(config),
  )
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const ownerHeaders = {
    'cf-access-jwt-assertion': claim('owner-subject', 'owner@example.com'),
  }
  const viewerHeaders = {
    'cf-access-jwt-assertion': claim('viewer-subject', 'viewer@example.com'),
  }
  const ownerSnapshot = await fetch(`${base}/api/snapshot`, {
    headers: ownerHeaders,
  }).then((response) => response.json())
  assert.equal(ownerSnapshot.identity.personId, 'observatory-primary')
  assert.equal(ownerSnapshot.identity.role, 'owner')
  assert.equal(ownerSnapshot.identity.capability, 'controlCapable')
  assert.equal(
    (await fetch(`${base}/api/health/operations`, { headers: ownerHeaders }))
      .status,
    200,
  )
  assert.equal(
    (await fetch(`${base}/api/health/operations`, { headers: viewerHeaders }))
      .status,
    403,
  )
  assert.equal(
    (
      await fetch(`${base}/api/commands/grant-control`, {
        method: 'POST',
        headers: viewerHeaders,
        body: JSON.stringify({
          expectedLeaseRevision: 1,
          idempotencyKey: 'viewer-may-not-grant',
        }),
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(`${base}/api/commands/request-control`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          expectedLeaseRevision: 1,
          idempotencyKey: 'owner-request',
        }),
      })
    ).status,
    202,
  )
  assert.equal(
    (
      await fetch(`${base}/api/commands/grant-control`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          expectedLeaseRevision: 1,
          idempotencyKey: 'owner-grant',
        }),
      })
    ).status,
    202,
  )
  const phoneAdmission = createProductionAccessAdmission({
    ...config,
    clientContext: 'phone',
  })
  const phoneIdentity = await phoneAdmission({
    headers: {
      'cf-access-jwt-assertion': claim(
        'owner-phone-subject',
        'owner@example.com',
      ),
    },
  } as IncomingMessage)
  assert.deepEqual(phoneIdentity, {
    personId: 'observatory-primary',
    clientId: 'access:owner-phone-subject',
    role: 'owner',
    capability: 'readOnly',
  })
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
  const request = (token: string) =>
    ({ headers: { 'cf-access-jwt-assertion': token } }) as IncomingMessage
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

test('a rig worker dispatches only a Solar test and records provider acknowledgement separately from Stack evidence', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-rig-worker-')),
    'state.sqlite',
  )
  const service = createFixtureService(databasePath)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const intent = service.submitSolarTestIntent(
    { name: 'Solar worker test', idempotencyKey: 'rig-worker-solar' },
    {
      personId: 'owner',
      clientId: 'desktop',
      role: 'owner',
      capability: 'controlCapable',
    },
  )
  if (intent.outcome !== 'accepted') throw new Error('Expected Solar intent')
  let calls = 0
  const config = {
    mode: 'seestar' as const,
    databasePath,
    rigId: 'seestar-s30' as const,
    host: '192.168.4.63',
    pemPath: '/run/secrets/seestar.pem',
  }
  const worker = createRigWorkerService(config, {
    startSolarTestObservation: async (work) => {
      calls += 1
      assert.equal(work.intentId, intent.intentId)
      return 'providerAcknowledged'
    },
    stopSolarTestObservation: async () => true,
    close: () => undefined,
  })
  assert.deepEqual(await Promise.all([worker.runOnce(), worker.runOnce()]), [
    'providerAcknowledged',
    'none',
  ])
  assert.equal(calls, 1)
  let row = service.database
    .prepare(
      "SELECT id,state,claim_token,ack_at,attempts FROM outbox WHERE kind='StartSolarTestObservation'",
    )
    .get() as {
    id: string
    state: string
    claim_token: string | null
    ack_at: string | null
    attempts: number
  }
  assert.equal(row.state, 'dispatched')
  assert.equal(row.claim_token, null)
  assert.notEqual(row.ack_at, null)
  assert.equal(row.attempts, 1)
  assert.equal(
    service.database
      .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
      .get(intent.intentId).state,
    'providerAcknowledged',
  )
  assert.equal(
    service.recordSolarStackEvidence(
      intent.intentId,
      { Event: 'Stack', stacked_frame: 1 },
      '2026-07-27T12:00:00.000Z',
    ),
    true,
  )
  assert.equal(
    service.database
      .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
      .get(intent.intentId).state,
    'stackObserved',
  )
  assert.equal(calls, 1)
  assert.equal(row.state, 'dispatched')
  assert.equal(row.claim_token, null)
  assert.notEqual(row.ack_at, null)
  assert.equal(row.attempts, 1)
  const uncertainIntent = service.submitSolarTestIntent(
    {
      name: 'Solar uncertain worker test',
      idempotencyKey: 'rig-worker-solar-uncertain',
    },
    {
      personId: 'owner',
      clientId: 'desktop',
      role: 'owner',
      capability: 'controlCapable',
    },
  )
  if (uncertainIntent.outcome !== 'accepted')
    throw new Error('Expected Solar uncertain intent')
  const uncertainWorker = createRigWorkerService(
    config,
    {
      startSolarTestObservation: async () => 'uncertain',
      stopSolarTestObservation: async () => true,
      close: () => undefined,
    },
    { workerId: 'uncertain-worker' },
  )
  assert.equal(await uncertainWorker.runOnce(), 'uncertain')
  assert.equal(
    service.database
      .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
      .get(uncertainIntent.intentId).state,
    'manualRecovery',
  )
  assert.equal(
    service.database
      .prepare(
        "SELECT state FROM outbox WHERE kind='StartSolarTestObservation' AND state='uncertain'",
      )
      .get().state,
    'uncertain',
  )
  uncertainWorker.close()
  const expiredIntent = service.submitSolarTestIntent(
    {
      name: 'Solar expired lease test',
      idempotencyKey: 'rig-worker-solar-expired',
    },
    {
      personId: 'owner',
      clientId: 'desktop',
      role: 'owner',
      capability: 'controlCapable',
    },
  )
  if (expiredIntent.outcome !== 'accepted')
    throw new Error('Expected Solar expired intent')
  service.database
    .prepare(
      "UPDATE outbox SET state='claimed',claim_token='expired',claim_until=? WHERE kind='StartSolarTestObservation' AND state='pending'",
    )
    .run('2000-01-01T00:00:00.000Z')
  assert.equal(await worker.runOnce(), 'none')
  assert.equal(
    service.database
      .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
      .get(expiredIntent.intentId).state,
    'manualRecovery',
  )
  assert.equal(
    service.database
      .prepare('SELECT state FROM solar_test_recovery WHERE intent_id=?')
      .get(expiredIntent.intentId).state,
    'manualRecovery',
  )
  worker.close()
})

test('rig outbox dispatch leaves a claimed PublishAsset for its publisher', async () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-outbox-isolation-'))
  const sources = join(root, 'sources')
  const outputs = join(root, 'outputs')
  const databasePath = join(root, 'state.sqlite')
  mkdirSync(sources)
  writeFileSync(join(sources, 'final.tiff'), 'publisher-bytes')
  const service = createFixtureService(databasePath, undefined, undefined, {
    sourcesRoot: sources,
    outputsRoot: outputs,
    sources: { final: 'final.tiff' },
  })
  const saved = service.saveProcess({
    sessionId: 'process-outbox-isolation',
    expectedRevision: 1,
    idempotencyKey: 'outbox-isolation-save',
    outputs: [{ sourceId: 'final', representation: 'final' }],
  })
  if (saved.outcome !== 'accepted') throw new Error('save did not accept')
  service.database
    .prepare(
      "UPDATE outbox SET state='claimed',claim_token='publisher-token',claimed_by='publisher-worker',claim_until=? WHERE kind='PublishAsset'",
    )
    .run('2000-01-01T00:00:00.000Z')
  const config = {
    mode: 'seestar' as const,
    databasePath,
    rigId: 'seestar-s30' as const,
    host: '192.168.4.63',
    pemPath: '/run/secrets/seestar.pem',
  }
  const rig = createRigWorkerService(config, {
    startSolarTestObservation: async () => 'providerAcknowledged',
    stopSolarTestObservation: async () => true,
    close: () => undefined,
  })
  assert.equal(await rig.runOnce(), 'none')
  const isolated = service.database
    .prepare(
      "SELECT state,claim_token,claimed_by,claim_until FROM outbox WHERE kind='PublishAsset'",
    )
    .get() as {
    state: string
    claim_token: string | null
    claimed_by: string | null
    claim_until: string | null
  }
  assert.equal(isolated.state, 'claimed')
  assert.equal(isolated.claim_token, 'publisher-token')
  assert.equal(isolated.claimed_by, 'publisher-worker')
  assert.equal(isolated.claim_until, '2000-01-01T00:00:00.000Z')
  let uploads = 0
  const publisher = createPublisherWorker(
    service.database,
    { outputsRoot: outputs },
    {
      put: async (_key, file, metadata) => {
        uploads += 1
        assert.equal(file.checksum, metadata.checksum)
      },
      head: async () => {
        const checksum = service.database
          .prepare('SELECT checksum FROM process_asset_events WHERE asset_id=?')
          .get(saved.assetIds[0]) as { checksum: string }
        return { checksum: checksum.checksum, bytes: 15 }
      },
    },
  )
  assert.equal(await publisher.pass(), 'published')
  assert.equal(uploads, 1)
  assert.equal(
    service.database
      .prepare("SELECT state FROM outbox WHERE kind='PublishAsset'")
      .get().state,
    'dispatched',
  )
  rig.close()
  service.close()
})

test('enabled worker without an adapter reports liveness without claiming fixture hardware work', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-rig-unconfigured-')),
    'state.sqlite',
  )
  const service = createFixtureService(databasePath)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'plan-m27',
      expectedPlanRevision: 3,
      expectedLeaseRevision: 1,
      idempotencyKey: 'rig-unconfigured-start',
    }),
  })
  const config = {
    mode: 'seestar' as const,
    databasePath,
    rigId: 'seestar-s30' as const,
    host: '192.168.4.63',
    pemPath: '/run/secrets/seestar.pem',
  }
  const worker = createRigWorkerService(config, undefined, {
    now: () => new Date('2026-07-25T12:00:00.000Z'),
  })
  assert.equal(await worker.runOnce(), 'unavailable')
  assert.deepEqual(worker.health(), {
    mode: 'seestar',
    status: 'alive',
    adapter: 'unconfigured',
    lastHeartbeat: '2026-07-25T12:00:00.000Z',
  })
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='StartM27Capture'",
        )
        .get() as { count: number }
    ).count,
    0,
  )
  const operations = await fetch(`${base}/api/health/operations`).then(
    (response) => response.json(),
  )
  assert.deepEqual(operations.worker, {
    status: 'alive',
    adapter: 'unconfigured',
    lastHeartbeat: '2026-07-25T12:00:00.000Z',
  })
  assert.deepEqual(await worker.run({ maxPasses: 1 }), {
    passes: 1,
    health: {
      mode: 'seestar',
      status: 'stopped',
      adapter: 'unconfigured',
      lastHeartbeat: '2026-07-25T12:00:00.000Z',
    },
  })
})

test('current controller resumes only the paused revision and replays idempotently', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'plan-m27',
      expectedPlanRevision: 3,
      expectedLeaseRevision: 1,
      idempotencyKey: 'resume-start',
    }),
  })
  const paused = await fetch(`${base}/api/commands/pause-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'PauseRun',
      expectedLeaseRevision: 1,
      expectedRunRevision: 1,
      idempotencyKey: 'resume-pause',
    }),
  }).then((response) => response.json())
  assert.equal(paused.snapshot.run.phase, 'paused')
  const command = {
    _tag: 'ResumeRun',
    expectedLeaseRevision: 1,
    expectedRunRevision: 2,
    idempotencyKey: 'resume-once',
  }
  const resumed = await fetch(`${base}/api/commands/resume-run`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
  assert.equal(resumed.status, 202)
  assert.equal((await resumed.json()).snapshot.run.phase, 'capture')
  assert.equal(
    (
      await fetch(`${base}/api/commands/resume-run`, {
        method: 'POST',
        body: JSON.stringify(command),
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await fetch(`${base}/api/commands/resume-run`, {
        method: 'POST',
        body: JSON.stringify({
          ...command,
          expectedRunRevision: 2,
          idempotencyKey: 'resume-stale',
        }),
      })
    ).status,
    409,
  )
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind IN ('StartM27Capture','StopStack','ResumeStack','StopRun')",
        )
        .get() as { count: number }
    ).count,
    0,
  )
})

test('resume preserves accepted fixture capture without hardware dispatch', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const resume = async (key: string) => {
    await fetch(`${base}/api/commands/start-run`, {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'StartRunFromPlan',
        planId: 'plan-m27',
        expectedPlanRevision: 3,
        expectedLeaseRevision: 1,
        idempotencyKey: `${key}-start`,
      }),
    })
    await fetch(`${base}/api/commands/pause-run`, {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'PauseRun',
        expectedLeaseRevision: 1,
        expectedRunRevision: 1,
        idempotencyKey: `${key}-pause`,
      }),
    })
    return fetch(`${base}/api/commands/resume-run`, {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'ResumeRun',
        expectedLeaseRevision: 1,
        expectedRunRevision: 2,
        idempotencyKey: `${key}-resume`,
      }),
    })
  }
  await resume('fixture-resume')
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  assert.equal(snapshot.run.phase, 'capture')
  assert.equal(snapshot.dispatch, 'none')
  assert.equal(snapshot.dispatchAction, 'none')
})

test('a non-RunDefinition active run cannot use the bounded pause path', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  service.database.prepare("UPDATE state SET value=? WHERE key='run'").run(
    JSON.stringify({
      id: 'legacy-run',
      revision: 4,
      phase: 'capture',
      target: 'Legacy capture',
      progress: 50,
    }),
  )
  const paused = await fetch(`${base}/api/commands/pause-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'PauseRun',
      expectedLeaseRevision: 1,
      expectedRunRevision: 4,
      idempotencyKey: 'source-less-pause',
    }),
  })
  assert.equal(paused.status, 409)
  assert.equal((await paused.json()).reason, 'RunRevisionConflict')
  assert.equal(
    (await fetch(`${base}/api/snapshot`).then((response) => response.json()))
      .run.phase,
    'capture',
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM run_intervention_receipts')
        .get() as { count: number }
    ).count,
    0,
  )
})

test('current controller terminally stops an active fixture run without hardware dispatch', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'plan-m27',
      expectedPlanRevision: 3,
      expectedLeaseRevision: 1,
      idempotencyKey: 'stop-start',
    }),
  })
  const command = {
    expectedLeaseRevision: 1,
    expectedRunRevision: 1,
    idempotencyKey: 'stop-once',
  }
  const stopped = await fetch(`${base}/api/commands/stop-run`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
  assert.equal(stopped.status, 202)
  assert.equal((await stopped.json()).eventType, 'RunStopped')
  assert.equal(
    (
      await fetch(`${base}/api/commands/stop-run`, {
        method: 'POST',
        body: JSON.stringify(command),
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await fetch(`${base}/api/commands/stop-run`, {
        method: 'POST',
        body: JSON.stringify({
          ...command,
          idempotencyKey: 'stop-terminal',
          expectedRunRevision: 2,
        }),
      })
    ).status,
    409,
  )
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind IN ('StartM27Capture','StopStack','ResumeStack','StopRun')",
        )
        .get() as { count: number }
    ).count,
    0,
  )
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  assert.equal(snapshot.run.phase, 'stopped')
  assert.equal(snapshot.dispatch, 'none')
  assert.equal(snapshot.dispatchAction, 'none')
  assert.match(
    snapshot.evidence.correction.protection,
    /accepted capture continues/,
  )
  const html = await fetch(`${base}/`).then((response) => response.text())
  assert.match(
    html,
    /Latest solve evidence is preserved\. This run is terminally stopped; no automatic correction or capture will continue\./,
  )
  assert.match(html, /s\.run\?\.phase==='paused'/)
  assert.equal(
    html.includes(
      "text(q('#correction-protection'),s.evidence.correction.protection)",
    ),
    false,
  )
})

test('startup backfills shared-control state for a legacy local database without changing accepted work', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-legacy-')),
    'state.sqlite',
  )
  const legacy = new DatabaseSync(databasePath)
  legacy.exec(
    'CREATE TABLE state (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE events (cursor INTEGER PRIMARY KEY,type TEXT NOT NULL,snapshot TEXT NOT NULL); CREATE TABLE receipts (idempotency_key TEXT PRIMARY KEY,response TEXT NOT NULL); CREATE TABLE outbox (id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL);',
  )
  const put = legacy.prepare('INSERT INTO state VALUES (?,?)')
  for (const [key, value] of Object.entries({
    snapshotVersion: 7,
    eventCursor: 11,
    planRevision: 3,
    run: {
      id: 'run-accepted-before-control',
      revision: 4,
      phase: 'capture',
      target: 'M27 · Dumbbell Nebula',
      progress: 42,
    },
  }))
    put.run(key, JSON.stringify(value))
  legacy
    .prepare('INSERT INTO events VALUES (?,?,?)')
    .run(11, 'RunStarted', '{"accepted":true}')
  legacy
    .prepare('INSERT INTO receipts VALUES (?,?)')
    .run('legacy-receipt', '{"accepted":true}')
  legacy
    .prepare('INSERT INTO outbox VALUES (?,?,?,?)')
    .run('legacy-outbox', 'StartM27Capture', '{}', 'pending')
  legacy.close()

  const service = createFixtureService(databasePath)
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const snapshot = await fetch(
    `http://127.0.0.1:${listener.port}/api/snapshot`,
  ).then((response) => response.json())
  assert.equal(snapshot.snapshotVersion, 7)
  assert.equal(snapshot.eventCursor, 11)
  assert.equal(snapshot.run.id, 'run-accepted-before-control')
  assert.equal(snapshot.control.holderClientId, 'desktop-owner')
  assert.equal(snapshot.control.revision, 1)
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM events')
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM receipts')
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(
    (
      service.database
        .prepare("SELECT state FROM outbox WHERE id='legacy-outbox'")
        .get() as { state: string }
    ).state,
    'cancelled',
  )
  await listener.close()
  service.close()
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
  assert.match(projected, /Correction budget 3 of 3 exhausted/)
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  assert.equal(snapshot.evidence.frameId, 'frame-m27-042')
  assert.equal(snapshot.evidence.correction.state, 'exhausted')
  assert.equal(
    snapshot.evidence.correction.action,
    'Review recovery in Observe before any new command.',
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM outbox')
        .get() as { count: number }
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
    (
      service.database
        .prepare('SELECT count(*) AS count FROM outbox')
        .get() as { count: number }
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

test('Seestar Stack push adapter decodes SDK events, projects availability, and fails closed', async (t) => {
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
  const accepted = service.ingestSeestarStackPush(
    { Event: 'Stack', stacked_frame: '43', percent: '62' },
    '2026-07-24T02:10:00.000Z',
  )
  assert.equal(accepted?.evidence.stack.availability, 'available')
  assert.equal(accepted?.evidence.stack.frameCount, 43)
  const projected = new TextDecoder().decode((await reader?.read()).value)
  assert.match(projected, /Stack event received/)
  const before = accepted?.evidence.frameId
  assert.equal(
    service.ingestSeestarStackPush(
      { Event: 'PlateSolve', stacked_frame: 44 },
      '2026-07-24T02:11:00.000Z',
    ),
    undefined,
  )
  const failed = service.ingestSeestarStackPush(
    {
      Event: 'Stack',
      stacked_frame: 43,
      state: 'fail',
      error: 'camera transport lost',
    },
    '2026-07-24T02:12:00.000Z',
  )
  assert.equal(failed?.evidence.frameId, before)
  assert.equal(failed?.evidence.stack.availability, 'unavailable')
  assert.match(failed?.evidence.stack.message ?? '', /camera transport lost/)
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM outbox')
        .get() as { count: number }
    ).count,
    0,
  )
  await reader?.cancel()
  await listener.close()
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
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  assert.equal(snapshot.evidence.frameId, 'frame-m27-042')
  assert.equal(snapshot.evidence.correction.action, 'none')
  assert.equal('results' in snapshot, false)
  assert.equal(JSON.stringify(snapshot).includes('asset-m27-'), false)
  const html = await fetch(`${base}/`).then((response) => response.text())
  assert.match(html, /id="library-results"/)
  assert.match(html, /id="evidence-surface"/)
  assert.match(html, /id="stack-source"/)
  assert.match(html, /id="stack-trace" role="status"/)
  assert.match(html, /Pause capture/)
  assert.match(html, /Resume capture/)
  assert.match(html, /Stop run/)
  assert.match(html, /\/api\/commands\/stop-run/)
  assert.match(html, /\/api\/commands\/resume-run/)
  assert.match(html, /expectedRunRevision:s\.run\.revision/)
  assert.match(html, /id="pause-consequence" role="status"/)
  assert.match(html, /button\[hidden\]\{display:none\}/)
  assert.match(
    html,
    /Pause preserves this deterministic managed run; it does not send hardware work./,
  )
  assert.match(
    html,
    /Resume restores the preserved deterministic phase; it does not send hardware work./,
  )
  assert.match(html, /Stop is terminal: this managed run cannot be resumed/)
  assert.match(html, /Stack observed /)
  assert.match(html, /correction-protection/)
  assert.match(
    html,
    /id="library-prev" aria-label="Previous Library results window" disabled/,
  )
  assert.match(
    html,
    /id="library-next" aria-label="Next Library results window" disabled/,
  )
  assert.match(html, /libraryNext\.onclick=/)
  assert.match(html, /start\+12/)
  assert.match(html, /\/api\/library\?queryId=library-m27&pageSize=40/)
  await listener.close()
  service.close()
})

test('fixture run acceptance does not depend on unserviceable hardware outbox work', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  service.database.exec(
    "CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'forced outbox failure'); END;",
  )
  const accepted = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'plan-m27',
      expectedPlanRevision: 3,
      expectedLeaseRevision: 1,
      idempotencyKey: 'fixture-run',
    }),
  })
  assert.equal(accepted.status, 202)
  const after = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  assert.equal(after.run.phase, 'capture')
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM events')
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM receipts')
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM outbox')
        .get() as { count: number }
    ).count,
    0,
  )
  await listener.close()
  service.close()
})

test('HTTP boundary rejects stale and server-configured phone intents without state change', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const stale = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'plan-m27',
      expectedPlanRevision: 0,
      expectedLeaseRevision: 1,
      idempotencyKey: 'stale',
    }),
  })
  assert.equal(stale.status, 409)
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
  const phone = await fetch(
    `http://127.0.0.1:${phoneListener.port}/api/commands/start-run`,
    {
      method: 'POST',
      headers: { 'x-client-capability': 'controlCapable' },
      body: JSON.stringify({
        _tag: 'StartRunFromPlan',
        planId: 'plan-m27',
        expectedPlanRevision: 3,
        expectedLeaseRevision: 1,
        idempotencyKey: 'phone',
      }),
    },
  )
  assert.equal(phone.status, 403)
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM events')
        .get() as { count: number }
    ).count,
    0,
  )
  await listener.close()
  service.close()
  await phoneListener.close()
  phoneService.close()
})

test('authenticated workspace projections preserve future intent, bounded Library evidence, and a stable Process handoff', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
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
  const process = await fetch(
    `${base}/api/workspaces/process?sourceAssetId=${assetId}`,
  ).then((response) => response.json())
  assert.equal(process.sourceAssetId, assetId)
  assert.equal(process.preview.state, 'synchronized')
  assert.equal(process.history.at(-1).state, 'current')
  assert.match(process.protection, /Apply, Save/)
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  assert.equal(snapshot.run, null)
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM events')
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (await fetch(`${base}/api/workspaces/process?sourceAssetId=asset-other`))
      .status,
    404,
  )
  const unavailable = await fetch(
    `${base}/api/workspaces/process?sourceAssetId=asset-m27-013`,
  )
  assert.equal(unavailable.status, 409)
  assert.deepEqual(await unavailable.json(), {
    outcome: 'rejected',
    reason: 'AssetUnavailable',
    message:
      'This asset is temporarily unavailable and cannot open in Process.',
  })
})

test('SQLite-backed plan drafts persist deterministic verdicts, revision guards, idempotency, and SSE projection', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-plan-draft-')),
    'state.sqlite',
  )
  const service = createFixtureService(databasePath)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const initial = await fetch(`${base}/api/workspaces/plan`).then((response) =>
    response.json(),
  )
  const sequences = initial.sequences.map(
    ({ viability, ...sequence }: { readonly viability: string }) => sequence,
  )
  const command = {
    planId: initial.planId,
    expectedPlanRevision: initial.revision,
    idempotencyKey: 'plan-ready-001',
    sequences,
  }
  const duplicate = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify({
      ...command,
      idempotencyKey: 'plan-duplicate-001',
      sequences: [sequences[0], sequences[0]],
    }),
  })
  assert.equal(duplicate.status, 400)
  const ready = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
  assert.equal(ready.status, 202)
  assert.equal((await ready.json()).plan.readiness, 'ready')
  const savedSnapshot = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  assert.equal(savedSnapshot.plan.runEligible, false)
  const startSavedDraft = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: initial.planId,
      expectedPlanRevision: initial.revision + 1,
      expectedLeaseRevision: savedSnapshot.control.revision,
      idempotencyKey: 'saved-draft-start',
    }),
  })
  assert.equal(startSavedDraft.status, 409)
  assert.equal((await startSavedDraft.json()).reason, 'PlanUnavailable')
  const event = new TextDecoder().decode((await reader?.read()).value)
  assert.match(event, /event: PlanDraftSaved/)
  assert.match(event, /data: \{"snapshotVersion"/)
  const replay = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
  assert.equal(replay.status, 200)
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM events WHERE type='PlanDraftSaved'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  const limited = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify({
      ...command,
      expectedPlanRevision: initial.revision + 1,
      idempotencyKey: 'plan-limited-001',
      sequences: sequences.map(
        (sequence: { readonly horizon: string }, index: number) =>
          index === 0 ? { ...sequence, horizon: 'limited' } : sequence,
      ),
    }),
  })
  assert.equal(limited.status, 202)
  assert.equal((await limited.json()).plan.readiness, 'readyWithLimitations')
  const blocked = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify({
      ...command,
      expectedPlanRevision: initial.revision + 2,
      idempotencyKey: 'plan-blocked-001',
      sequences: sequences.map(
        (sequence: { readonly storage: string }, index: number) =>
          index === 1 ? { ...sequence, storage: 'missing' } : sequence,
      ),
    }),
  })
  assert.equal(blocked.status, 202)
  assert.equal((await blocked.json()).plan.readiness, 'blocked')
  const stale = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify({
      ...command,
      expectedPlanRevision: initial.revision + 2,
      idempotencyKey: 'plan-stale-001',
    }),
  })
  assert.equal(stale.status, 409)
  await reader?.cancel()
  await listener.close()
  service.close()
  const recovered = createFixtureService(databasePath)
  const recoveredListener = await recovered.listen()
  const recoveredPlan = await fetch(
    `http://127.0.0.1:${recoveredListener.port}/api/workspaces/plan`,
  ).then((response) => response.json())
  assert.equal(recoveredPlan.readiness, 'blocked')
  assert.equal(recoveredPlan.revision, initial.revision + 3)
  const phone = createFixtureService(databasePath, () => ({
    personId: 'owner-chicks',
    clientId: 'phone-monitor',
    capability: 'readOnly',
    role: 'owner',
  }))
  const phoneListener = await phone.listen()
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:${phoneListener.port}/api/commands/save-plan-draft`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...command,
            expectedPlanRevision: recoveredPlan.revision,
            idempotencyKey: 'plan-phone-001',
          }),
        },
      )
    ).status,
    403,
  )
  await recoveredListener.close()
  recovered.close()
  await phoneListener.close()
  phone.close()
})

test('SQLite accepts one immutable RunDefinition from a ready persisted plan and emits no device work', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-run-definition-')),
    'state.sqlite',
  )
  const service = createFixtureService(databasePath)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const initial = await fetch(`${base}/api/workspaces/plan`).then((response) =>
    response.json(),
  )
  const sequences = initial.sequences.map(
    ({ viability, ...sequence }: { readonly viability: string }) => sequence,
  )
  const saved = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify({
      planId: initial.planId,
      expectedPlanRevision: initial.revision,
      idempotencyKey: 'run-definition-draft-001',
      sequences,
    }),
  })
  assert.equal(saved.status, 202)
  const draft = await saved.json()
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const command = {
    _tag: 'AcceptRunDefinition',
    planId: draft.plan.planId,
    expectedPlanRevision: draft.plan.revision,
    expectedLeaseRevision: draft.snapshot.control.revision,
    idempotencyKey: 'run-definition-001',
  }
  const malformed = await fetch(`${base}/api/commands/accept-run-definition`, {
    method: 'POST',
    body: JSON.stringify({ _tag: 'AcceptRunDefinition' }),
  })
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).reason, 'InvalidInput')
  const staleLease = await fetch(`${base}/api/commands/accept-run-definition`, {
    method: 'POST',
    body: JSON.stringify({
      ...command,
      expectedLeaseRevision: command.expectedLeaseRevision + 1,
      idempotencyKey: 'run-definition-stale-lease',
    }),
  })
  assert.equal(staleLease.status, 409)
  assert.equal((await staleLease.json()).reason, 'FreshnessConflict')
  const phone = createFixtureService(databasePath, () => ({
    personId: 'owner-chicks',
    clientId: 'phone-monitor',
    capability: 'readOnly',
    role: 'owner',
  }))
  const phoneListener = await phone.listen()
  const phoneResult = await fetch(
    `http://127.0.0.1:${phoneListener.port}/api/commands/accept-run-definition`,
    { method: 'POST', body: JSON.stringify(command) },
  )
  assert.equal(phoneResult.status, 403)
  assert.equal((await phoneResult.json()).reason, 'ClientReadOnly')
  await phoneListener.close()
  phone.close()
  const unavailable = createLocalWebService(':memory:')
  const unavailableListener = await unavailable.listen()
  const unavailableResult = await fetch(
    `http://127.0.0.1:${unavailableListener.port}/api/commands/accept-run-definition`,
    {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'AcceptRunDefinition',
        planId: 'uninitialized',
        expectedPlanRevision: 0,
        expectedLeaseRevision: 0,
        idempotencyKey: 'run-definition-unavailable',
      }),
    },
  )
  assert.equal(unavailableResult.status, 409)
  assert.equal((await unavailableResult.json()).reason, 'PlanUnavailable')
  await unavailableListener.close()
  unavailable.close()
  const limitedPath = join(
    mkdtempSync(join(tmpdir(), 'astro-run-definition-limited-')),
    'state.sqlite',
  )
  const limitedService = createFixtureService(limitedPath)
  const limitedListener = await limitedService.listen()
  const limitedBase = `http://127.0.0.1:${limitedListener.port}`
  const limitedInitial = await fetch(`${limitedBase}/api/workspaces/plan`).then(
    (response) => response.json(),
  )
  const limitedSequences = limitedInitial.sequences.map(
    (
      { viability, ...sequence }: { readonly viability: string },
      index: number,
    ) => (index === 0 ? { ...sequence, horizon: 'limited' } : sequence),
  )
  const limitedDraft = await fetch(
    `${limitedBase}/api/commands/save-plan-draft`,
    {
      method: 'POST',
      body: JSON.stringify({
        planId: limitedInitial.planId,
        expectedPlanRevision: limitedInitial.revision,
        idempotencyKey: 'run-definition-limited-draft',
        sequences: limitedSequences,
      }),
    },
  ).then((response) => response.json())
  const limitedResult = await fetch(
    `${limitedBase}/api/commands/accept-run-definition`,
    {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'AcceptRunDefinition',
        planId: limitedDraft.plan.planId,
        expectedPlanRevision: limitedDraft.plan.revision,
        expectedLeaseRevision: limitedDraft.snapshot.control.revision,
        idempotencyKey: 'run-definition-limited',
      }),
    },
  )
  assert.equal(limitedResult.status, 409)
  assert.equal((await limitedResult.json()).reason, 'PlanNotReady')
  await limitedListener.close()
  limitedService.close()
  const activePath = join(
    mkdtempSync(join(tmpdir(), 'astro-run-definition-active-')),
    'state.sqlite',
  )
  const activeService = createFixtureService(activePath)
  const activeListener = await activeService.listen()
  const activeBase = `http://127.0.0.1:${activeListener.port}`
  const activeInitial = await fetch(`${activeBase}/api/workspaces/plan`).then(
    (response) => response.json(),
  )
  const activeSequences = activeInitial.sequences.map(
    ({ viability, ...sequence }: { readonly viability: string }) => sequence,
  )
  const activeDraft = await fetch(
    `${activeBase}/api/commands/save-plan-draft`,
    {
      method: 'POST',
      body: JSON.stringify({
        planId: activeInitial.planId,
        expectedPlanRevision: activeInitial.revision,
        idempotencyKey: 'run-definition-active-draft',
        sequences: activeSequences,
      }),
    },
  ).then((response) => response.json())
  const activeCommand = {
    _tag: 'AcceptRunDefinition',
    planId: activeDraft.plan.planId,
    expectedPlanRevision: activeDraft.plan.revision,
    expectedLeaseRevision: activeDraft.snapshot.control.revision,
    idempotencyKey: 'run-definition-active-accept',
  }
  assert.equal(
    (
      await fetch(`${activeBase}/api/commands/accept-run-definition`, {
        method: 'POST',
        body: JSON.stringify(activeCommand),
      })
    ).status,
    202,
  )
  assert.equal(
    (
      await fetch(`${activeBase}/api/commands/start-run`, {
        method: 'POST',
        body: JSON.stringify({
          _tag: 'StartRunFromPlan',
          planId: activeCommand.planId,
          expectedPlanRevision: activeCommand.expectedPlanRevision,
          expectedLeaseRevision: activeCommand.expectedLeaseRevision,
          idempotencyKey: 'run-definition-active-run',
        }),
      })
    ).status,
    202,
  )
  const activeResult = await fetch(
    `${activeBase}/api/commands/accept-run-definition`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...activeCommand,
        idempotencyKey: 'run-definition-active',
      }),
    },
  )
  assert.equal(activeResult.status, 409)
  assert.equal((await activeResult.json()).reason, 'ActiveRunConflict')
  await activeListener.close()
  activeService.close()
  const accepted = await fetch(`${base}/api/commands/accept-run-definition`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
  assert.equal(accepted.status, 202)
  const result = await accepted.json()
  assert.equal(result.runDefinition.executor, 'fake')
  assert.equal(result.runDefinition.sourcePlanRevision, draft.plan.revision)
  assert.equal(result.snapshot.plan.runEligible, true)
  const event = new TextDecoder().decode((await reader?.read()).value)
  assert.match(event, /event: RunDefinitionAccepted/)
  const replay = await fetch(`${base}/api/commands/accept-run-definition`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).runDefinition.id, result.runDefinition.id)
  const changedReplay = await fetch(
    `${base}/api/commands/accept-run-definition`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...command,
        expectedLeaseRevision: command.expectedLeaseRevision + 1,
      }),
    },
  )
  assert.equal(changedReplay.status, 400)
  assert.equal((await changedReplay.json()).reason, 'InvalidInput')
  const second = await fetch(`${base}/api/commands/accept-run-definition`, {
    method: 'POST',
    body: JSON.stringify({ ...command, idempotencyKey: 'run-definition-002' }),
  })
  assert.equal(second.status, 409)
  assert.equal((await second.json()).reason, 'RunDefinitionAlreadyAccepted')
  const stale = await fetch(`${base}/api/commands/accept-run-definition`, {
    method: 'POST',
    body: JSON.stringify({
      ...command,
      expectedPlanRevision: draft.plan.revision - 1,
      idempotencyKey: 'run-definition-stale',
    }),
  })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).reason, 'FreshnessConflict')
  const next = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify({
      planId: draft.plan.planId,
      expectedPlanRevision: draft.plan.revision,
      idempotencyKey: 'run-definition-next-draft',
      sequences: sequences.map(
        (sequence: { readonly capture: string }, index: number) =>
          index === 0 ? { ...sequence, capture: '48 × 180s · L' } : sequence,
      ),
    }),
  })
  assert.equal(next.status, 202)
  const nextPlan = (await next.json()).plan
  const blocked = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify({
      planId: nextPlan.planId,
      expectedPlanRevision: nextPlan.revision,
      idempotencyKey: 'run-definition-blocked-draft',
      sequences: sequences.map(
        (sequence: { readonly storage: string }, index: number) =>
          index === 0 ? { ...sequence, storage: 'missing' } : sequence,
      ),
    }),
  })
  const blockedPlan = (await blocked.json()).plan
  const notReady = await fetch(`${base}/api/commands/accept-run-definition`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'AcceptRunDefinition',
      planId: blockedPlan.planId,
      expectedPlanRevision: blockedPlan.revision,
      expectedLeaseRevision: draft.snapshot.control.revision,
      idempotencyKey: 'run-definition-blocked',
    }),
  })
  assert.equal(notReady.status, 409)
  assert.equal((await notReady.json()).reason, 'PlanNotReady')
  const definition = JSON.parse(
    (
      service.database
        .prepare(
          'SELECT definition FROM run_definitions WHERE run_definition_id=?',
        )
        .get(result.runDefinition.id) as { definition: string }
    ).definition,
  )
  assert.equal(definition.plan.sequences[0].capture, sequences[0].capture)
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM events WHERE type='RunDefinitionAccepted'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  assert.equal(
    (
      service.database
        .prepare('SELECT count(*) AS count FROM outbox')
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (await fetch(`${base}/api/snapshot`).then((response) => response.json()))
      .run,
    null,
  )
  await reader?.cancel()
  await listener.close()
  service.close()
  const recovered = createFixtureService(databasePath)
  const recoveredDefinition = recovered.database
    .prepare(
      'SELECT source_plan_revision,definition FROM run_definitions WHERE run_definition_id=?',
    )
    .get(result.runDefinition.id) as {
    source_plan_revision: number
    definition: string
  }
  assert.equal(recoveredDefinition.source_plan_revision, draft.plan.revision)
  assert.equal(
    JSON.parse(recoveredDefinition.definition).id,
    result.runDefinition.id,
  )
  recovered.close()
})

test('an accepted fake RunDefinition advances two immutable sequences through durable service-owned phases', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-fake-run-')),
    'state.sqlite',
  )
  const service = createFixtureService(databasePath)
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const initial = await fetch(`${base}/api/workspaces/plan`).then((response) =>
    response.json(),
  )
  const sequences = initial.sequences.map(
    ({ viability, ...sequence }: { readonly viability: string }) => sequence,
  )
  const draft = await fetch(`${base}/api/commands/save-plan-draft`, {
    method: 'POST',
    body: JSON.stringify({
      planId: initial.planId,
      expectedPlanRevision: initial.revision,
      idempotencyKey: 'fake-run-draft',
      sequences,
    }),
  }).then((response) => response.json())
  const accepted = await fetch(`${base}/api/commands/accept-run-definition`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'AcceptRunDefinition',
      planId: draft.plan.planId,
      expectedPlanRevision: draft.plan.revision,
      expectedLeaseRevision: draft.snapshot.control.revision,
      idempotencyKey: 'fake-run-definition',
    }),
  }).then((response) => response.json())
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  const start = {
    _tag: 'StartRunFromPlan',
    planId: draft.plan.planId,
    expectedPlanRevision: draft.plan.revision,
    expectedLeaseRevision: draft.snapshot.control.revision,
    idempotencyKey: 'fake-run-start',
  }
  const nonHolder = createFixtureService(databasePath, () => ({
    personId: 'friend-ada',
    clientId: 'desktop-ada',
    role: 'viewer',
    capability: 'controlCapable',
  }))
  const nonHolderListener = await nonHolder.listen()
  const nonHolderStart = await fetch(
    `http://127.0.0.1:${nonHolderListener.port}/api/commands/start-run`,
    {
      method: 'POST',
      body: JSON.stringify({ ...start, idempotencyKey: 'fake-run-non-holder' }),
    },
  )
  assert.equal(nonHolderStart.status, 403)
  assert.equal((await nonHolderStart.json()).reason, 'ControlLeaseLost')
  assert.equal(
    (
      service.database
        .prepare("SELECT count(*) AS count FROM events WHERE type='RunStarted'")
        .get() as { count: number }
    ).count,
    0,
  )
  await nonHolderListener.close()
  nonHolder.close()
  const started = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify(start),
  })
  assert.equal(started.status, 202)
  const startedRun = (await started.json()).run
  assert.equal(startedRun.phase, 'preflight')
  assert.equal(startedRun.sourceDefinitionId, accepted.runDefinition.id)
  assert.equal(
    startedRun.target,
    accepted.runDefinition.plan.sequences[0].target,
  )
  assert.match(
    new TextDecoder().decode((await reader?.read()).value),
    /event: RunStarted/,
  )
  assert.equal(
    (
      await fetch(`${base}/api/commands/start-run`, {
        method: 'POST',
        body: JSON.stringify(start),
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await fetch(`${base}/api/commands/start-run`, {
        method: 'POST',
        body: JSON.stringify({ ...start, idempotencyKey: 'fake-run-conflict' }),
      })
    ).status,
    409,
  )
  assert.equal(service.advanceFakeRun()?.run.phase, 'acquire')
  assert.match(
    new TextDecoder().decode((await reader?.read()).value),
    /event: RunPreflightCompleted/,
  )
  assert.equal(service.advanceFakeRun()?.run.phase, 'capture')
  assert.match(
    new TextDecoder().decode((await reader?.read()).value),
    /event: RunAcquireCompleted/,
  )
  const beforePause = await fetch(`${base}/api/snapshot`).then((response) =>
    response.json(),
  )
  const pause = {
    _tag: 'PauseRun',
    expectedLeaseRevision: beforePause.control.revision,
    expectedRunRevision: beforePause.run.revision,
    idempotencyKey: 'fake-run-pause',
  }
  const paused = await fetch(`${base}/api/commands/pause-run`, {
    method: 'POST',
    body: JSON.stringify(pause),
  })
  assert.equal(paused.status, 202)
  const pausedBody = await paused.json()
  assert.equal(pausedBody.snapshot.run.phase, 'paused')
  assert.equal(pausedBody.snapshot.run.resumablePhase, 'capture')
  assert.match(
    new TextDecoder().decode((await reader?.read()).value),
    /event: RunPaused/,
  )
  assert.equal(
    (
      await fetch(`${base}/api/commands/pause-run`, {
        method: 'POST',
        body: JSON.stringify(pause),
      })
    ).status,
    200,
  )
  const idempotencyConflict = await fetch(`${base}/api/commands/resume-run`, {
    method: 'POST',
    body: JSON.stringify({ ...pause, _tag: 'ResumeRun' }),
  })
  assert.equal(idempotencyConflict.status, 409)
  assert.equal((await idempotencyConflict.json()).reason, 'IdempotencyConflict')
  assert.equal(service.advanceFakeRun(), undefined)
  assert.equal(
    (
      service.database
        .prepare("SELECT count(*) AS count FROM events WHERE type='RunPaused'")
        .get() as { count: number }
    ).count,
    1,
  )
  await reader?.cancel()
  await listener.close()
  service.close()
  const recovered = createFixtureService(databasePath)
  const recoveredListener = await recovered.listen()
  const recoveredBase = `http://127.0.0.1:${recoveredListener.port}`
  const recoveredStream = await fetch(`${recoveredBase}/api/events`)
  const recoveredReader = recoveredStream.body?.getReader()
  await recoveredReader?.read()
  const afterRestart = await fetch(`${recoveredBase}/api/snapshot`).then(
    (response) => response.json(),
  )
  assert.equal(afterRestart.run.phase, 'paused')
  assert.equal(afterRestart.run.resumablePhase, 'capture')
  assert.equal(afterRestart.run.activeSequenceIndex, 0)
  assert.equal(afterRestart.run.completedSequenceCount, 0)
  assert.equal(afterRestart.run.sourceDefinitionId, accepted.runDefinition.id)
  assert.equal(recovered.advanceFakeRun(), undefined)
  const notPaused = await fetch(`${recoveredBase}/api/commands/resume-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'ResumeRun',
      expectedLeaseRevision: afterRestart.control.revision,
      expectedRunRevision: afterRestart.run.revision - 1,
      idempotencyKey: 'fake-run-stale-resume',
    }),
  })
  assert.equal(notPaused.status, 409)
  assert.equal((await notPaused.json()).reason, 'RunRevisionConflict')
  const resumed = await fetch(`${recoveredBase}/api/commands/resume-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'ResumeRun',
      expectedLeaseRevision: afterRestart.control.revision,
      expectedRunRevision: afterRestart.run.revision,
      idempotencyKey: 'fake-run-resume',
    }),
  })
  assert.equal(resumed.status, 202)
  assert.equal((await resumed.json()).snapshot.run.phase, 'capture')
  assert.equal(recovered.advanceFakeRun()?.run.phase, 'verify')
  assert.equal(recovered.advanceFakeRun()?.run.phase, 'preflight')
  const secondSequence = await fetch(`${recoveredBase}/api/snapshot`).then(
    (response) => response.json(),
  )
  assert.equal(secondSequence.run.activeSequenceIndex, 1)
  assert.equal(secondSequence.run.completedSequenceCount, 1)
  assert.equal(recovered.advanceFakeRun()?.run.phase, 'acquire')
  assert.equal(recovered.advanceFakeRun()?.run.phase, 'capture')
  assert.equal(recovered.advanceFakeRun()?.run.phase, 'verify')
  assert.equal(recovered.advanceFakeRun()?.run.phase, 'completed')
  assert.match(
    new TextDecoder().decode((await recoveredReader?.read()).value),
    /event: RunResumed|event: RunCaptureCompleted/,
  )
  const completed = await fetch(`${recoveredBase}/api/snapshot`).then(
    (response) => response.json(),
  )
  assert.equal(completed.run.phase, 'completed')
  assert.equal(completed.run.completedSequenceCount, 2)
  assert.equal(completed.run.revision, 11)
  assert.equal(recovered.advanceFakeRun(), undefined)
  assert.equal(
    (
      recovered.database
        .prepare('SELECT count(*) AS count FROM outbox')
        .get() as { count: number }
    ).count,
    0,
  )
  assert.equal(
    (
      recovered.database
        .prepare(
          "SELECT count(*) AS count FROM events WHERE type='RunCompleted'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  await recoveredReader?.cancel()
  await recoveredListener.close()
  recovered.close()
})

test('fixture installation restores only a missing M27 plan record and keeps a saved draft visible after restart', async (t) => {
  const missingPath = join(
    mkdtempSync(join(tmpdir(), 'astro-missing-fixture-plan-')),
    'state.sqlite',
  )
  const fixture = createFixtureService(missingPath)
  fixture.database
    .prepare("DELETE FROM observing_plans WHERE plan_id='plan-m27'")
    .run()
  fixture.close()
  const restored = createFixtureService(missingPath)
  const restoredListener = await restored.listen()
  const restoredBase = `http://127.0.0.1:${restoredListener.port}`
  assert.equal(
    (
      await fetch(`${restoredBase}/api/snapshot`).then((response) =>
        response.json(),
      )
    ).plan.id,
    'plan-m27',
  )
  const restoredShell = await fetch(`${restoredBase}/`).then((response) =>
    response.text(),
  )
  assert.match(restoredShell, /data-room="Plan"/)
  assert.match(restoredShell, /Save deterministic two-sequence draft/)
  await restoredListener.close()
  restored.close()

  const savedPath = join(
    mkdtempSync(join(tmpdir(), 'astro-saved-draft-restart-')),
    'state.sqlite',
  )
  const saved = createFixtureService(savedPath)
  const savedListener = await saved.listen()
  const savedBase = `http://127.0.0.1:${savedListener.port}`
  const initial = await fetch(`${savedBase}/api/workspaces/plan`).then(
    (response) => response.json(),
  )
  const sequences = initial.sequences.map(
    ({ viability, ...sequence }: { readonly viability: string }) => sequence,
  )
  assert.equal(
    (
      await fetch(`${savedBase}/api/commands/save-plan-draft`, {
        method: 'POST',
        body: JSON.stringify({
          planId: initial.planId,
          expectedPlanRevision: initial.revision,
          idempotencyKey: 'saved-restart-001',
          sequences,
        }),
      })
    ).status,
    202,
  )
  await savedListener.close()
  saved.close()
  const recovered = createFixtureService(savedPath)
  const recoveredListener = await recovered.listen()
  const recoveredBase = `http://127.0.0.1:${recoveredListener.port}`
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const snapshot = await fetch(`${recoveredBase}/api/snapshot`).then(
    (response) => response.json(),
  )
  assert.equal(snapshot.plan.readiness, 'ready')
  assert.equal(snapshot.plan.runEligible, false)
  const shell = await fetch(`${recoveredBase}/`).then((response) =>
    response.text(),
  )
  assert.match(shell, /data-room="Plan"/)
  assert.doesNotMatch(shell, /No observation plan is installed/)
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
    '/api/workspaces/process',
    '/api/library?queryId=workspace-coverage&sort=capturedAtDescending',
  ])
    assert.equal((await fetch(`${base}${path}`)).status, 401)
})

test('a request query cannot select phone or controller capability', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  const queried = await fetch(`${base}/api/snapshot?mode=phone`, {
    headers: { 'x-client-capability': 'readOnly' },
  }).then((response) => response.json())
  assert.equal(queried.identity.capability, 'controlCapable')
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
  const trustedPhone = await fetch(
    `http://127.0.0.1:${phoneListener.port}/api/snapshot?mode=desktop`,
  ).then((response) => response.json())
  assert.equal(trustedPhone.identity.capability, 'readOnly')
  const html = await fetch(`http://127.0.0.1:${phoneListener.port}/`).then(
    (response) => response.text(),
  )
  assert.match(html, /s\.identity\.capability==='readOnly'/)
  assert.match(html, /v\.message/)
  assert.match(html, /data-room="Plan"/)
  assert.match(html, /data-room="Observe"/)
  assert.match(html, /data-room="Library"/)
  assert.match(html, /data-room="Process"/)
  assert.match(html, /if\(s\.identity\.capability==='readOnly'\)return/)
  assert.match(html, /Save deterministic two-sequence draft/)
  assert.match(html, /\/api\/commands\/save-plan-draft/)
  assert.match(html, /deterministicTwoSequenceDraft/)
  assert.match(
    html,
    /if\(label==='Run plan'\)return document\.createComment\('Run plan deferred'\)/,
  )
  assert.match(
    html,
    /function eventProjection\(event\)\{const payload=JSON\.parse\(event\.data\);return payload\.snapshot\|\|payload\}/,
  )
  assert.match(html, /if\(innerWidth<=600\)return/)
  assert.match(
    html,
    /addEventListener\('resize',\(\)=>\{if\(projection\)\{render\(projection\);renderPlanActions\(\)\}\}\)/,
  )
  assert.match(
    html,
    /addEventListener\('orientationchange',\(\)=>\{if\(projection\)\{render\(projection\);renderPlanActions\(\)\}\}\)/,
  )
  assert.match(html, /detail\.availability==='availableLocally'/)
  assert.match(html, /temporarily unavailable and cannot open in Process/)
  assert.match(html, /select\('Observe'\)/)
  assert.match(html, /SERVICE TRUTH<button id="return" hidden/)
  assert.match(html, /q\('#return'\)\.hidden=!s\.run/)
  assert.equal(html.includes('MutationObserver'), false)
  for (const raw of ['ControlGranted', 'ControlRequested', 'ControlLeaseLost'])
    assert.equal(html.includes(raw), false)
  await listener.close()
  service.close()
  await phoneListener.close()
  phoneService.close()
})

test('malformed and oversized bodies become bounded InvalidInput rejections', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const malformed = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: '{',
  })
  assert.deepEqual(await malformed.json(), {
    outcome: 'rejected',
    reason: 'InvalidInput',
    message: 'The service could not read that action.',
  })
  const oversized = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: 'x'.repeat(16_385),
  })
  assert.equal(oversized.status, 413)
  assert.deepEqual(await oversized.json(), {
    outcome: 'rejected',
    reason: 'InvalidInput',
    message: 'The service could not read that action.',
  })
  await listener.close()
  service.close()
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
  const asset = await fetch(`${base}/assets/brand/alignment-aperture-light.svg`)
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=3600')
  assert.equal(
    asset.headers.get('content-security-policy'),
    response.headers.get('content-security-policy'),
  )
})

test('SSE sends a snapshot before durable cursor catch-up and never replays a command', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  assert.notEqual(reader, undefined)
  const first = new TextDecoder().decode((await reader?.read()).value)
  assert.match(first, /event: snapshot/)
  const started = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'plan-m27',
      expectedPlanRevision: 3,
      expectedLeaseRevision: 1,
      idempotencyKey: 'sse-run',
    }),
  })
  assert.equal(started.status, 202)
  const next = new TextDecoder().decode((await reader?.read()).value)
  assert.match(next, /event: RunStarted/)
  await reader?.cancel()
  await listener.close()
  service.close()
})

test('browser reconnect installs a current snapshot and its stale shell offers no mutation replay', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const firstStream = await fetch(`${base}/api/events`)
  const firstReader = firstStream.body?.getReader()
  await firstReader?.read()
  await firstReader?.cancel()
  const started = await fetch(`${base}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'plan-m27',
      expectedPlanRevision: 3,
      expectedLeaseRevision: 1,
      idempotencyKey: 'reconnect-start',
    }),
  })
  assert.equal(started.status, 202)
  const reconnectStream = await fetch(`${base}/api/events`)
  const reconnectReader = reconnectStream.body?.getReader()
  const reconnect = new TextDecoder().decode(
    (await reconnectReader?.read()).value,
  )
  assert.match(reconnect, /event: snapshot/)
  assert.match(reconnect, /"phase":"capture"/)
  assert.equal(
    (
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='StartM27Capture'",
        )
        .get() as { count: number }
    ).count,
    0,
  )
  const shell = await fetch(`${base}/`).then((response) => response.text())
  assert.match(shell, /connection lost · last confirmed/)
  assert.match(shell, /no action will be replayed/)
  assert.match(shell, /s\.connection==='stale'/)
  await reconnectReader?.cancel()
  await listener.close()
  service.close()
})

test('expired reconnect grace survives restart, releases control to nobody, and preserves accepted work', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-lease-recovery-')),
    'state.sqlite',
  )
  const owner = createFixtureService(databasePath, () => ({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
    role: 'owner',
  }))
  const friend = createFixtureService(databasePath, () => ({
    personId: 'friend-ada',
    clientId: 'desktop-ada',
    capability: 'controlCapable',
  }))
  const ownerListener = await owner.listen()
  const friendListener = await friend.listen()
  const ownerBase = `http://127.0.0.1:${ownerListener.port}`
  const friendBase = `http://127.0.0.1:${friendListener.port}`
  await fetch(`${ownerBase}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'plan-m27',
      expectedPlanRevision: 3,
      expectedLeaseRevision: 1,
      idempotencyKey: 'lease-recovery-run',
    }),
  })
  const impostor = await fetch(
    `${friendBase}/api/commands/controller-disconnected`,
    {
      method: 'POST',
      body: JSON.stringify({
        expectedLeaseRevision: 1,
        idempotencyKey: 'impostor-disconnect',
      }),
    },
  ).then((response) => response.json())
  assert.equal(impostor.reason, 'ControlLeaseLost')
  await fetch(`${friendBase}/api/commands/request-control`, {
    method: 'POST',
    body: JSON.stringify({
      expectedLeaseRevision: 1,
      idempotencyKey: 'lease-recovery-request',
    }),
  })
  await fetch(`${ownerBase}/api/commands/grant-control`, {
    method: 'POST',
    body: JSON.stringify({
      expectedLeaseRevision: 1,
      idempotencyKey: 'lease-recovery-grant',
    }),
  })
  const disconnected = await fetch(
    `${friendBase}/api/commands/controller-disconnected`,
    {
      method: 'POST',
      body: JSON.stringify({
        expectedLeaseRevision: 2,
        idempotencyKey: 'lease-recovery-disconnect',
      }),
    },
  ).then((response) => response.json())
  assert.equal(disconnected.eventType, 'ControlReconnectGraceStarted')
  await ownerListener.close()
  await friendListener.close()
  owner.close()
  friend.close()
  const persisted = new DatabaseSync(databasePath)
  persisted
    .prepare("UPDATE state SET value=? WHERE key='reconnectGraceUntil'")
    .run(JSON.stringify('2000-01-01T00:00:00.000Z'))
  persisted.close()
  const recovered = createFixtureService(databasePath, () => ({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
    role: 'owner',
  }))
  const recoveredListener = await recovered.listen()
  t.after(async () => {
    await recoveredListener.close()
    recovered.close()
  })
  const snapshot = await fetch(
    `http://127.0.0.1:${recoveredListener.port}/api/snapshot`,
  ).then((response) => response.json())
  assert.equal(snapshot.control.holderClientId, null)
  assert.equal(snapshot.control.state, 'unheld')
  assert.equal(snapshot.control.revision, 4)
  assert.equal(snapshot.run.phase, 'capture')
  assert.equal(
    (
      recovered.database
        .prepare('SELECT type FROM events ORDER BY cursor DESC LIMIT 1')
        .get() as { type: string }
    ).type,
    'ControlGraceExpired',
  )
  await recoveredListener.close()
  recovered.close()
})

test('two server-configured desktops transfer control without stopping the accepted run', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-control-')),
    'state.sqlite',
  )
  const owner = createFixtureService(databasePath, () => ({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
    role: 'owner',
  }))
  const friend = createFixtureService(databasePath, () => ({
    personId: 'friend-ada',
    clientId: 'desktop-ada',
    capability: 'controlCapable',
  }))
  const ownerListener = await owner.listen()
  const friendListener = await friend.listen()
  t.after(async () => {
    await ownerListener.close()
    await friendListener.close()
    owner.close()
    friend.close()
  })
  const ownerBase = `http://127.0.0.1:${ownerListener.port}`
  const friendBase = `http://127.0.0.1:${friendListener.port}`
  const initial = await fetch(`${ownerBase}/api/snapshot`).then((response) =>
    response.json(),
  )
  await fetch(`${ownerBase}/api/commands/start-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'StartRunFromPlan',
      planId: 'plan-m27',
      expectedPlanRevision: 3,
      expectedLeaseRevision: initial.control.revision,
      idempotencyKey: 'run-before-takeover',
    }),
  })
  await fetch(`${friendBase}/api/commands/request-control`, {
    method: 'POST',
    body: JSON.stringify({
      expectedLeaseRevision: 1,
      idempotencyKey: 'ada-request',
    }),
  })
  const granted = await fetch(`${ownerBase}/api/commands/grant-control`, {
    method: 'POST',
    body: JSON.stringify({
      expectedLeaseRevision: 1,
      idempotencyKey: 'owner-grant',
    }),
  })
  assert.equal(granted.status, 202)
  const oldController = await fetch(`${ownerBase}/api/commands/pause-run`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'PauseRun',
      expectedLeaseRevision: 2,
      expectedRunRevision: 1,
      idempotencyKey: 'old-pause',
    }),
  })
  const oldResult = await oldController.json()
  assert.equal(oldResult.reason, 'ControlLeaseLost')
  assert.equal(
    oldResult.message,
    'Control changed hands. Your command was not sent to the observatory; the accepted run continues.',
  )
  const after = await fetch(`${friendBase}/api/snapshot`).then((response) =>
    response.json(),
  )
  assert.equal(after.control.holderClientId, 'desktop-ada')
  assert.equal(after.run.phase, 'capture')
  assert.equal(
    (
      owner.database.prepare('SELECT count(*) AS count FROM outbox').get() as {
        count: number
      }
    ).count,
    0,
  )
  await ownerListener.close()
  await friendListener.close()
  owner.close()
  friend.close()
})

test('an owner SSE projection advances when a friend writes the shared SQLite database', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-projection-')),
    'state.sqlite',
  )
  const owner = createFixtureService(databasePath, () => ({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
    role: 'owner',
  }))
  const friend = createFixtureService(databasePath, () => ({
    personId: 'friend-ada',
    clientId: 'desktop-ada',
    capability: 'controlCapable',
  }))
  const ownerListener = await owner.listen()
  const friendListener = await friend.listen()
  t.after(async () => {
    await ownerListener.close()
    await friendListener.close()
    owner.close()
    friend.close()
  })
  const ownerBase = `http://127.0.0.1:${ownerListener.port}`
  const friendBase = `http://127.0.0.1:${friendListener.port}`
  const stream = await fetch(`${ownerBase}/api/events`)
  const reader = stream.body?.getReader()
  await reader?.read()
  await fetch(`${friendBase}/api/commands/request-control`, {
    method: 'POST',
    body: JSON.stringify({
      expectedLeaseRevision: 1,
      idempotencyKey: 'projection-request',
    }),
  })
  const changed = await Promise.race([
    reader?.read(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(new Error('owner did not receive cross-process projection')),
        2_000,
      ),
    ),
  ])
  const text = new TextDecoder().decode(changed?.value)
  assert.match(text, /event: ProjectionChanged/)
  assert.match(text, /desktop-ada/)
  await reader?.cancel()
  await ownerListener.close()
  await friendListener.close()
  owner.close()
  friend.close()
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

test('serves the accepted V1 light symbol from the local application origin', async (t) => {
  const service = createFixtureService()
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const response = await fetch(
    `http://127.0.0.1:${listener.port}/assets/brand/alignment-aperture-light.svg`,
  )
  assert.equal(response.headers.get('content-type'), 'image/svg+xml')
  assert.match(await response.text(), /Astro Console V1 symbol/)
  await listener.close()
  service.close()
})

test('a missing packaged brand asset is a bounded 404 rather than a server failure', async (t) => {
  const service = createFixtureService(
    ':memory:',
    undefined,
    new URL('file:///tmp/astro-console-missing-brand.svg'),
  )
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const response = await fetch(
    `http://127.0.0.1:${listener.port}/assets/brand/alignment-aperture-light.svg`,
  )
  assert.equal(response.status, 404)
  assert.equal(await response.text(), 'Brand asset unavailable')
})

test('generated fixture shell has executable browser JavaScript', () => {
  const script = applicationShell({ fixture: true }).match(
    /<script>([\s\S]*)<\/script>/,
  )?.[1]
  assert.notEqual(script, undefined)
  new Function(script)
  assert.match(script, /Preflight · fake run is preparing/)
  assert.match(script, /Acquire · fake run is centering/)
  assert.match(script, /Verify · fake run is checking/)
  assert.doesNotMatch(script, /Capture · M27 is continuing/)
})

test('fake run resolution and consequence-aware edits persist only durable fake state', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-final-phase-two-')),
    'state.sqlite',
  )
  const start = async (key: string, path = databasePath) => {
    const service = createFixtureService(path)
    const listener = await service.listen()
    const base = `http://127.0.0.1:${listener.port}`
    const plan = await fetch(`${base}/api/workspaces/plan`).then((response) =>
      response.json(),
    )
    const sequences = plan.sequences.map(
      ({ viability, ...sequence }: { readonly viability: string }) => sequence,
    )
    const draft = await fetch(`${base}/api/commands/save-plan-draft`, {
      method: 'POST',
      body: JSON.stringify({
        planId: plan.planId,
        expectedPlanRevision: plan.revision,
        idempotencyKey: `${key}-draft`,
        sequences,
      }),
    }).then((response) => response.json())
    await fetch(`${base}/api/commands/accept-run-definition`, {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'AcceptRunDefinition',
        planId: draft.plan.planId,
        expectedPlanRevision: draft.plan.revision,
        expectedLeaseRevision: draft.snapshot.control.revision,
        idempotencyKey: `${key}-definition`,
      }),
    })
    await fetch(`${base}/api/commands/start-run`, {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'StartRunFromPlan',
        planId: draft.plan.planId,
        expectedPlanRevision: draft.plan.revision,
        expectedLeaseRevision: draft.snapshot.control.revision,
        idempotencyKey: `${key}-start`,
      }),
    })
    return { service, listener, base }
  }
  const first = await start('final-edit')
  t.after(async () => {
    await first.listener.close()
    first.service.close()
  })
  const snapshot = await fetch(`${first.base}/api/snapshot`).then((response) =>
    response.json(),
  )
  const previewResponse = await fetch(
    `${first.base}/api/commands/preview-run-mutation`,
    {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'PreviewRunMutation',
        mutation: 'reprioritizeSecond',
        expectedLeaseRevision: snapshot.control.revision,
        expectedRunRevision: snapshot.run.revision,
        idempotencyKey: 'final-preview',
      }),
    },
  )
  assert.equal(previewResponse.status, 202)
  const preview = await previewResponse.json()
  assert.equal(preview.preview.classification, 'nonDisruptive')
  const expired = await fetch(
    `${first.base}/api/commands/preview-run-mutation`,
    {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'PreviewRunMutation',
        mutation: 'shortenSecond',
        expectedLeaseRevision: snapshot.control.revision,
        expectedRunRevision: snapshot.run.revision,
        idempotencyKey: 'final-expired-preview',
      }),
    },
  ).then((response) => response.json())
  first.service.database
    .prepare('UPDATE run_mutation_previews SET expires_at=? WHERE preview_id=?')
    .run('2000-01-01T00:00:00.000Z', expired.preview.previewId)
  const expiredApply = await fetch(
    `${first.base}/api/commands/apply-run-mutation`,
    {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'ApplyRunMutation',
        previewId: expired.preview.previewId,
        expectedLeaseRevision: snapshot.control.revision,
        expectedRunRevision: snapshot.run.revision,
        idempotencyKey: 'final-expired-apply',
      }),
    },
  )
  assert.equal(expiredApply.status, 409)
  assert.equal((await expiredApply.json()).reason, 'PreviewExpired')
  const applied = await fetch(`${first.base}/api/commands/apply-run-mutation`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'ApplyRunMutation',
      previewId: preview.preview.previewId,
      expectedLeaseRevision: snapshot.control.revision,
      expectedRunRevision: snapshot.run.revision,
      idempotencyKey: 'final-apply',
    }),
  })
  assert.equal(applied.status, 202)
  const afterApplied = await applied.json()
  assert.equal(afterApplied.snapshot.run.activeSequenceIndex, 0)
  assert.equal(afterApplied.snapshot.run.appliedMutations.length, 1)
  const disruptive = await fetch(
    `${first.base}/api/commands/preview-run-mutation`,
    {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'PreviewRunMutation',
        mutation: 'discardCurrent',
        expectedLeaseRevision: afterApplied.snapshot.control.revision,
        expectedRunRevision: afterApplied.snapshot.run.revision,
        idempotencyKey: 'final-disruptive-preview',
      }),
    },
  ).then((response) => response.json())
  const denied = await fetch(`${first.base}/api/commands/apply-run-mutation`, {
    method: 'POST',
    body: JSON.stringify({
      _tag: 'ApplyRunMutation',
      previewId: disruptive.preview.previewId,
      expectedLeaseRevision: afterApplied.snapshot.control.revision,
      expectedRunRevision: afterApplied.snapshot.run.revision,
      idempotencyKey: 'final-disruptive-denied',
    }),
  })
  assert.equal(denied.status, 403)
  const mismatchedApproval = await fetch(
    `${first.base}/api/commands/approve-disruptive-run-mutation`,
    {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'ApproveDisruptiveRunMutation',
        previewId: disruptive.preview.previewId,
        approvalToken: 'wrong-token',
        expectedLeaseRevision: afterApplied.snapshot.control.revision,
        expectedRunRevision: afterApplied.snapshot.run.revision,
        idempotencyKey: 'final-disruptive-mismatch',
      }),
    },
  )
  assert.equal(mismatchedApproval.status, 403)
  assert.equal((await mismatchedApproval.json()).reason, 'ApprovalMismatch')
  const approved = await fetch(
    `${first.base}/api/commands/approve-disruptive-run-mutation`,
    {
      method: 'POST',
      body: JSON.stringify({
        _tag: 'ApproveDisruptiveRunMutation',
        previewId: disruptive.preview.previewId,
        approvalToken: disruptive.approvalToken,
        expectedLeaseRevision: afterApplied.snapshot.control.revision,
        expectedRunRevision: afterApplied.snapshot.run.revision,
        idempotencyKey: 'final-disruptive-approved',
      }),
    },
  ).then((response) => response.json())
  assert.equal(approved.snapshot.run.activeSequenceIndex, 1)
  assert.equal(approved.snapshot.run.phase, 'preflight')
  assert.equal(
    (
      first.service.database
        .prepare('SELECT count(*) AS count FROM outbox')
        .get() as { count: number }
    ).count,
    0,
  )
  const retry = await fetch(`${first.base}/api/commands/retry-fake-phase`, {
    method: 'POST',
    body: JSON.stringify({
      expectedLeaseRevision: approved.snapshot.control.revision,
      expectedRunRevision: approved.snapshot.run.revision,
      idempotencyKey: 'final-retry',
    }),
  }).then((response) => response.json())
  assert.equal(retry.snapshot.run.retryPhase, 'preflight')
  const retryAgain = await fetch(
    `${first.base}/api/commands/retry-fake-phase`,
    {
      method: 'POST',
      body: JSON.stringify({
        expectedLeaseRevision: retry.snapshot.control.revision,
        expectedRunRevision: retry.snapshot.run.revision,
        idempotencyKey: 'final-retry-again',
      }),
    },
  )
  assert.equal(retryAgain.status, 409)
  const parked = await fetch(`${first.base}/api/commands/request-fake-park`, {
    method: 'POST',
    body: JSON.stringify({
      expectedLeaseRevision: retry.snapshot.control.revision,
      expectedRunRevision: retry.snapshot.run.revision,
      idempotencyKey: 'final-park',
    }),
  }).then((response) => response.json())
  assert.equal(parked.snapshot.run.phase, 'parkRequested')
  await first.listener.close()
  first.service.close()
  const recovered = createFixtureService(databasePath)
  const recoveredSnapshot = (await recovered.database
    .prepare("SELECT value FROM state WHERE key='run'")
    .get()) as { value: string }
  assert.equal(JSON.parse(recoveredSnapshot.value).phase, 'parkRequested')
  recovered.close()
  const skip = await start(
    'final-skip',
    join(mkdtempSync(join(tmpdir(), 'astro-final-skip-')), 'state.sqlite'),
  )
  t.after(async () => {
    await skip.listener.close()
    skip.service.close()
  })
  const skipSnapshot = await fetch(`${skip.base}/api/snapshot`).then(
    (response) => response.json(),
  )
  const skipped = await fetch(`${skip.base}/api/commands/skip-fake-sequence`, {
    method: 'POST',
    body: JSON.stringify({
      expectedLeaseRevision: skipSnapshot.control.revision,
      expectedRunRevision: skipSnapshot.run.revision,
      idempotencyKey: 'final-skip-once',
    }),
  }).then((response) => response.json())
  assert.equal(skipped.snapshot.run.activeSequenceIndex, 1)
  assert.equal(skipped.snapshot.run.revision, skipSnapshot.run.revision + 1)
  assert.equal(
    (
      skip.service.database
        .prepare(
          "SELECT count(*) AS count FROM events WHERE type='FakeSequenceSkipped'",
        )
        .get() as { count: number }
    ).count,
    1,
  )
  const stopped = await start(
    'final-stop',
    join(mkdtempSync(join(tmpdir(), 'astro-final-stop-')), 'state.sqlite'),
  )
  t.after(async () => {
    await stopped.listener.close()
    stopped.service.close()
  })
  const stopSnapshot = await fetch(`${stopped.base}/api/snapshot`).then(
    (response) => response.json(),
  )
  const stop = await fetch(`${stopped.base}/api/commands/stop-run`, {
    method: 'POST',
    body: JSON.stringify({
      expectedLeaseRevision: stopSnapshot.control.revision,
      expectedRunRevision: stopSnapshot.run.revision,
      idempotencyKey: 'final-stop-once',
    }),
  }).then((response) => response.json())
  assert.equal(stop.snapshot.run.phase, 'stopped')
  assert.equal(stop.snapshot.run.revision, stopSnapshot.run.revision + 1)
  assert.equal(
    (
      stopped.service.database
        .prepare("SELECT count(*) AS count FROM events WHERE type='RunStopped'")
        .get() as { count: number }
    ).count,
    1,
  )
  const blockedPolicy = await fetch(
    `${stopped.base}/api/commands/request-fake-park`,
    {
      method: 'POST',
      body: JSON.stringify({
        expectedLeaseRevision: stop.snapshot.control.revision,
        expectedRunRevision: stop.snapshot.run.revision,
        idempotencyKey: 'final-stop-policy',
      }),
    },
  )
  assert.equal(blockedPolicy.status, 409)
})
