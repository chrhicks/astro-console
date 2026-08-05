import assert from 'node:assert/strict'
import test from 'node:test'
import {
  existsSync,
  createReadStream,
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
import { createHash } from 'node:crypto'
import { ConfigProvider, Effect, Schema } from 'effect'
import { createLocalWebService } from '../app/origin-service.ts'
import { openAppOwnedDatabase } from '../persistence/database.ts'
import { createPublisherWorker } from '../workers/publisher-worker.ts'
import {
  assertSeparateFilesystems,
  createSqliteSnapshot,
  restoreDrill,
  verifySqlite,
} from '../persistence/sqlite-resilience.ts'
import { createR2Provider } from '../storage/r2-provider.ts'
import { createR2DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import { createDownloadGrantService } from '../workers/download-grant-service.ts'
import { isSqliteBusy } from '../workers/publisher-service.ts'
import {
  createProcessorService,
  runProcessor,
} from '../workers/processor-service.ts'
import { ingestSourceAsset } from '../services/source-ingest.ts'
import {
  downloadGrantSignerConfig,
  originServerConfig,
  processorEnvironmentConfig,
  publisherEnvironmentConfig,
} from '../config/environment-config.ts'

function createFixtureService(
  databasePath?: Parameters<typeof createLocalWebService>[0],
  identityResolver?: Parameters<typeof createLocalWebService>[1],
  processSaveStorage?: Parameters<typeof createLocalWebService>[2],
  downloadGrants?: Parameters<typeof createLocalWebService>[3],
) {
  return createLocalWebService(
    databasePath,
    identityResolver,
    processSaveStorage,
    downloadGrants,
    { fixture: 'm27' },
  )
}

function first<Value>(values: ReadonlyArray<Value>) {
  const value = values[0]
  assert.ok(value !== undefined)
  return value
}

const CountRow = Schema.Struct({ count: Schema.Int })
const EventRow = Schema.Struct({ checksum: Schema.String })
const StatusRow = Schema.Struct({ state: Schema.String })
const AssetAvailabilityRow = Schema.Struct({ availability: Schema.String })
const AssetDetailRow = Schema.Struct({ detail: Schema.String })
const PublicationRow = Schema.Struct({ object_key: Schema.String })
const SourceOrphanRow = Schema.Struct({
  path: Schema.String,
  checksum: Schema.String,
})
const ClaimedOutboxRow = Schema.Struct({
  state: Schema.String,
  claim_token: Schema.NullOr(Schema.String),
  claimed_by: Schema.NullOr(Schema.String),
  claim_until: Schema.NullOr(Schema.String),
})
const OutboxAttemptRow = Schema.Struct({
  state: Schema.String,
  attempts: Schema.Int,
})

function databaseRow<Row>(
  schema: Schema.Schema<Row> & Schema.ConstraintDecoder<unknown>,
  row: unknown,
): Row {
  return Schema.decodeUnknownSync(schema)(row)
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
    databasePath: './.astro-server/state.sqlite',
    release: 'server',
    port: 0,
    host: '127.0.0.1',
    webDistPath: '../web/dist',
    previewRoot: '/var/lib/astro-console/previews',
  })
  assert.deepEqual(development.admission, {
    mode: 'development',
    client: 'owner',
  })
  assert.equal(
    (await read(originServerConfig, { ASTRO_LOCAL_WEB_FIXTURE: 'plan-draft' }))
      .fixture,
    'plan-draft',
  )
  assert.equal(
    (await read(originServerConfig, { ASTRO_SERVER_FIXTURE: 'plan-draft' }))
      .fixture,
    'plan-draft',
  )
  const legacyOrigin = await read(originServerConfig, {
    ASTRO_LOCAL_WEB_BIND: '127.0.0.1',
    ASTRO_LOCAL_WEB_CLIENT: 'phone',
    ASTRO_LOCAL_WEB_DB: '/legacy.sqlite',
    ASTRO_LOCAL_WEB_FIXTURE: 'plan-draft',
    ASTRO_LOCAL_WEB_PORT: '4711',
  })
  assert.deepEqual(legacyOrigin.runtime, {
    databasePath: '/legacy.sqlite',
    release: 'server',
    port: 4711,
    host: '127.0.0.1',
    webDistPath: '../web/dist',
    previewRoot: '/var/lib/astro-console/previews',
  })
  assert.equal(legacyOrigin.admission.mode, 'development')
  if (legacyOrigin.admission.mode === 'development')
    assert.equal(legacyOrigin.admission.client, 'phone')
  assert.equal(legacyOrigin.fixture, 'plan-draft')
  const canonicalOrigin = await read(originServerConfig, {
    ASTRO_LOCAL_WEB_BIND: '0.0.0.0',
    ASTRO_LOCAL_WEB_CLIENT: 'phone',
    ASTRO_LOCAL_WEB_DB: '/legacy.sqlite',
    ASTRO_LOCAL_WEB_FIXTURE: 'plan-draft',
    ASTRO_LOCAL_WEB_PORT: '4711',
    ASTRO_SERVER_BIND: '127.0.0.1',
    ASTRO_SERVER_CLIENT: 'owner',
    ASTRO_SERVER_DB: '/canonical.sqlite',
    ASTRO_SERVER_FIXTURE: 'm27',
    ASTRO_SERVER_PORT: '4722',
  })
  assert.equal(canonicalOrigin.runtime.host, '127.0.0.1')
  assert.equal(canonicalOrigin.runtime.databasePath, '/canonical.sqlite')
  assert.equal(canonicalOrigin.runtime.port, 4722)
  assert.equal(canonicalOrigin.admission.mode, 'development')
  if (canonicalOrigin.admission.mode === 'development')
    assert.equal(canonicalOrigin.admission.client, 'owner')
  assert.equal(canonicalOrigin.fixture, 'm27')
  assert.equal(
    (
      await read(originServerConfig, {
        ASTRO_ADMISSION_MODE: 'production',
        ASTRO_LOCAL_WEB_BIND: '0.0.0.0',
        CF_ACCESS_ISSUER: 'https://access.example',
        CF_ACCESS_AUDIENCE: 'audience',
        CF_ACCESS_JWKS_URL: 'https://access.example/certs',
        ASTRO_MEMBERSHIP_BOOTSTRAP_PATH: '/run/config/members.json',
        ASTRO_LOCAL_OWNER_PORT: '8081',
        ASTRO_CLIENT_CONTEXT: 'desktop',
      })
    ).runtime.host,
    '0.0.0.0',
  )
  assert.equal(
    (
      await read(originServerConfig, {
        ASTRO_SERVER_FIXTURE: 'library-published',
      })
    ).fixture,
    'library-published',
  )
  const production = await read(originServerConfig, {
    ASTRO_ADMISSION_MODE: 'production',
    ASTRO_SERVER_BIND: '0.0.0.0',
    ASTRO_SERVER_DB: '/var/lib/astro-console/state.sqlite',
    CF_ACCESS_ISSUER: 'https://access.example',
    CF_ACCESS_AUDIENCE: 'audience',
    CF_ACCESS_JWKS_URL: 'https://access.example/certs',
    ASTRO_MEMBERSHIP_BOOTSTRAP_PATH: '/run/config/members.json',
    ASTRO_LOCAL_OWNER_PORT: '8081',
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
  assert.equal((await read(processorEnvironmentConfig, {})).mode, 'disabled')
  assert.equal(
    (
      await read(processorEnvironmentConfig, {
        ASTRO_PROCESSOR_MODE: 'manifest',
        ASTRO_SERVER_DB: '/var/lib/astro-console/state.sqlite',
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
        ASTRO_SERVER_DB: '/var/lib/astro-console/state.sqlite',
        ASTRO_PUBLISHER_OUTPUTS_ROOT: '/var/lib/astro-console/outputs',
      })
    ).bucket,
    r2.R2_BUCKET,
  )
  await assert.rejects(read(originServerConfig, { ASTRO_SERVER_PORT: 'wrong' }))
  await assert.rejects(
    read(originServerConfig, {
      ASTRO_ADMISSION_MODE: 'development',
      ASTRO_SERVER_BIND: '0.0.0.0',
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
      ASTRO_ADMISSION_MODE: 'production',
      ASTRO_SERVER_FIXTURE: 'plan-draft',
      CF_ACCESS_ISSUER: 'https://access.example',
      CF_ACCESS_AUDIENCE: 'audience',
      CF_ACCESS_JWKS_URL: 'https://access.example/certs',
      ASTRO_MEMBERSHIP_BOOTSTRAP_PATH: '/run/config/members.json',
      ASTRO_CLIENT_CONTEXT: 'desktop',
    }),
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
      ASTRO_SERVER_DB: '/var/lib/astro-console/state.sqlite',
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
})

function publisherFixture(idempotencyKey: string) {
  const root = mkdtempSync(join(tmpdir(), 'astro-publisher-'))
  const sources = join(root, 'sources')
  const outputs = join(root, 'outputs')
  mkdirSync(sources)
  writeFileSync(join(sources, 'final.tiff'), 'publication-bytes')
  const service = createFixtureService(join(root, 'state.sqlite'), undefined, {
    sourcesRoot: sources,
    outputsRoot: outputs,
    sources: { final: 'final.tiff' },
  })
  const saved = service.saveProcess({
    sessionId: 'process-m27-001',
    expectedRevision: 4,
    idempotencyKey,
    outputs: [{ sourceId: 'final', representation: 'final' }],
  })
  if (saved.outcome !== 'accepted' || !('assetIds' in saved))
    throw new Error('publisher fixture save did not accept')
  return { root, outputs, service, saved, assetId: first(saved.assetIds) }
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
    sessionId: 'm27-process-001',
    expectedRevision: 1,
    idempotencyKey: 'processor-save',
    outputs: [{ sourceId: 'final', representation: 'final' }],
    sources: { original: 'original.tiff', final: 'final.tiff' },
    metadata: {
      comparisonGroupId: 'm27-001',
      sourceAssetIds: ['asset-source-m27-001'],
      runId: 'm27-run-001',
      solveAttemptId: 'm27-solve-001',
    },
    sourceIngest: {
      assetId: 'asset-source-m27-001',
      sourceId: 'original',
      format: 'tiff',
      capturedAt: '2026-07-28T00:00:00.000Z',
      comparisonGroupId: 'm27-001',
      lineage: { runId: 'm27-run-001', solveAttemptId: 'm27-solve-001' },
      idempotencyKey: 'source-ingest-001',
    },
  }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const openTestDatabase = (path: string) =>
    openAppOwnedDatabase(path, `${root}/`)
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
  if (!('assetIds' in accepted))
    throw new Error('processor save did not create assets')
  assert.equal(accepted.assetIds.length, 1)
  assert.deepEqual(processor.runOnce(), accepted)
  processor.close()
  const inspected = createLocalWebService(databasePath)
  assert.equal(
    databaseRow(
      CountRow,
      inspected.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get(),
    ).count,
    1,
  )
  assert.equal(
    databaseRow(
      CountRow,
      inspected.database
        .prepare(
          "SELECT count(*) AS count FROM source_ingest_events WHERE asset_id='asset-source-m27-001'",
        )
        .get(),
    ).count,
    1,
  )
  assert.equal(existsSync(join(originals, 'asset-source-m27-001.tiff')), true)
  const savedDetail = JSON.parse(
    databaseRow(
      AssetDetailRow,
      inspected.database
        .prepare(
          "SELECT detail FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get(),
    ).detail,
  )
  assert.deepEqual(savedDetail.lineage, {
    sourceAssetIds: ['asset-source-m27-001'],
    runId: 'm27-run-001',
    solveAttemptId: 'm27-solve-001',
  })
  const before = databaseRow(
    CountRow,
    inspected.database
      .prepare(
        "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
      )
      .get(),
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
        solveAttemptId: 'm27-solve-mismatch',
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
    databaseRow(
      CountRow,
      mismatchInspection.database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get(),
    ).count,
    before,
  )
  assert.equal(
    databaseRow(
      CountRow,
      mismatchInspection.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get(),
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
    databaseRow(
      CountRow,
      final.database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get(),
    ).count,
    before,
  )
  assert.equal(
    databaseRow(
      CountRow,
      final.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get(),
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
  const database = openAppOwnedDatabase(join(root, 'state.sqlite'), `${root}/`)
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
      comparisonGroupId: 'm27-orphan-001',
      lineage: { runId: 'm27-run-001', solveAttemptId: 'm27-solve-001' },
      idempotencyKey: 'source-orphan-001',
    },
    {
      personId: 'owner',
      clientId: 'source-ingest-test',
      role: 'owner',
      capability: 'controlCapable',
    },
  )
  assert.deepEqual(result, {
    outcome: 'rejected',
    reason: 'MaterializationFailed',
  })
  const orphan = databaseRow(
    SourceOrphanRow,
    database.prepare('SELECT path,checksum FROM source_ingest_orphans').get(),
  )
  assert.equal(existsSync(orphan.path), true)
  assert.match(orphan.checksum, /^[0-9a-f]{64}$/)
  assert.equal(
    databaseRow(
      CountRow,
      database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id='asset-source-orphan-001'",
        )
        .get(),
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
  const requests: Array<{ readonly url: URL; readonly init: RequestInit }> = []
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
  const putHeaders = new Headers(requests[0]?.init.headers)
  assert.match(String(putHeaders.get('authorization')), /^AWS4-HMAC-SHA256 /)
  assert.equal(putHeaders.get('x-amz-content-sha256'), artifact.checksum)
  assert.equal(putHeaders.get('x-amz-meta-asset-id'), 'asset')
  assert.equal(putHeaders.get('x-amz-meta-checksum'), artifact.checksum)
  assert.equal(putHeaders.get('content-length'), String(artifact.bytes))
  assert.equal(
    putHeaders.get('content-disposition'),
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

test('R2 publisher cancels a paused file body without leaving its source stream open', async () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-r2-cancel-'))
  const credentialsPath = join(root, 'credentials.json')
  const artifactPath = join(root, 'asset.tiff')
  writeFileSync(
    credentialsPath,
    JSON.stringify({ accessKeyId: 'key', secretAccessKey: 'secret' }),
  )
  writeFileSync(artifactPath, Buffer.alloc(3 * 64 * 1024, 7))
  const artifact = {
    path: artifactPath,
    bytes: 3 * 64 * 1024,
    checksum: createHash('sha256')
      .update(readFileSync(artifactPath))
      .digest('hex'),
  }
  const source = createReadStream(artifactPath, { highWaterMark: 64 * 1024 })
  const closed = new Promise<void>((resolve) => source.once('close', resolve))
  let releaseFetch: (() => void) | undefined
  const released = new Promise<void>((resolve) => {
    releaseFetch = resolve
  })
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const provider = createR2Provider(
    {
      accountId: '503286fc7e5e8545c172105f991efef1',
      bucket: 'astro-console-artifacts',
      endpoint:
        'https://503286fc7e5e8545c172105f991efef1.r2.cloudflarestorage.com',
      credentialsPath,
    },
    async (_url, init) => {
      if (!(init.body instanceof ReadableStream))
        throw new Error('R2 PUT body was not streamed')
      reader = init.body.getReader()
      await released
      return new Response(undefined, { status: 200 })
    },
    { fileStream: () => source },
  )
  const put = provider.put('published/run/finals/asset.tiff', artifact, {
    assetId: 'asset',
    checksum: artifact.checksum,
  })
  while (reader === undefined) await Promise.resolve()
  const chunk = await reader.read()
  assert.equal(chunk.done, false)
  assert.equal(source.readableFlowing, false)
  await reader.cancel()
  await closed
  releaseFetch?.()
  await put
})

test('authorized Library downloads issue an Asset-ID grant and redirect without projecting bearer data', async (t) => {
  let now = new Date('2026-07-28T12:00:00.000Z')
  let issuerUnavailable = false
  const grants: Array<{
    readonly objectKey: string
    readonly expiresAt: string
  }> = []
  const admission = (request?: Pick<IncomingMessage, 'headers'>) =>
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
  const service = createFixtureService(':memory:', admission, undefined, {
    now: () => now,
    issuer: {
      issue: async (grant) => {
        if (issuerUnavailable) throw new Error('R2 unavailable')
        grants.push(grant)
        return `https://r2.example/${grant.objectKey}?X-Amz-Signature=bearer-${grants.length}`
      },
    },
  })
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
  let rejectIssuer = false
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
        issue: async () => {
          if (rejectIssuer) throw new Error('issuer unavailable')
          return 'https://r2.example/published/asset?X-Amz-Signature=private'
        },
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
  rejectIssuer = true
  const rejected = await request(
    JSON.stringify({
      objectKey: 'published/a',
      expiresAt: '2026-07-28T12:05:00.000Z',
    }),
    `Bearer ${secret}`,
  )
  assert.equal(rejected.status, 503)
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
  const service = createFixtureService(join(root, 'state.sqlite'), undefined, {
    sourcesRoot: sources,
    outputsRoot: outputs,
    sources: {
      linear: 'linear.fits',
      final: 'final.tiff',
      escape: '../outside.fits',
    },
  })
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
    databaseRow(
      CountRow,
      service.database
        .prepare('SELECT count(*) AS count FROM process_asset_events')
        .get(),
    ).count,
    2,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get(),
    ).count,
    2,
  )
  const event = databaseRow(
    EventRow,
    service.database
      .prepare('SELECT checksum FROM process_asset_events WHERE asset_id=?')
      .get(first(accepted.assetIds)),
  )
  const savedName = readdirSync(outputs).find((name) =>
    name.startsWith(first(accepted.assetIds)),
  )
  assert.equal(
    event.checksum,
    createHash('sha256')
      .update(readFileSync(join(outputs, savedName ?? 'missing')))
      .digest('hex'),
  )
  assert.deepEqual(service.saveProcess(command), accepted)
  assert.equal(readdirSync(outputs).length, 2)
  const detail = databaseRow(
    AssetDetailRow,
    service.database
      .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
      .get(first(accepted.assetIds)),
  )
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
  const service = createFixtureService(join(root, 'state.sqlite'), undefined, {
    sourcesRoot: sources,
    outputsRoot: outputs,
    sources: { source: 'source.fits', link: 'link.fits' },
  })
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
    databaseRow(
      CountRow,
      service.database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get(),
    ).count,
    0,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare('SELECT count(*) AS count FROM process_save_orphans')
        .get(),
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
  const service = createFixtureService(join(root, 'state.sqlite'), undefined, {
    sourcesRoot: sources,
    outputsRoot: outputs,
    sources: { first: 'first.fits', missing: 'missing.tiff' },
  })
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
    databaseRow(
      CountRow,
      service.database
        .prepare(
          "SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'",
        )
        .get(),
    ).count,
    0,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare('SELECT count(*) AS count FROM process_save_receipts')
        .get(),
    ).count,
    0,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'",
        )
        .get(),
    ).count,
    0,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database
        .prepare('SELECT count(*) AS count FROM process_save_orphans')
        .get(),
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
  const { root, outputs, service, assetId } = publisherFixture('publisher-save')
  const checksum = databaseRow(
    EventRow,
    service.database
      .prepare('SELECT checksum FROM process_asset_events WHERE asset_id=?')
      .get(assetId),
  ).checksum
  service.database
    .prepare(
      'INSERT INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)',
    )
    .run(
      assetId,
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
    databaseRow(
      AssetAvailabilityRow,
      service.database
        .prepare('SELECT availability FROM library_assets WHERE asset_id=?')
        .get(assetId),
    ).availability,
    'failedPublication',
  )
  mismatch = false
  assert.equal(await worker.pass(), 'published')
  assert.equal(await worker.pass(), 'none')
  assert.equal(puts, 2)
  assert.equal(objects.size, 1)
  assert.equal(
    databaseRow(
      PublicationRow,
      service.database
        .prepare('SELECT object_key FROM asset_publications WHERE asset_id=?')
        .get(assetId),
    ).object_key,
    [...objects.keys()][0],
  )
  assert.match(
    [...objects.keys()][0] ?? '',
    /^published\/run-m27-001\/finals\//,
  )
  const detail = databaseRow(
    AssetDetailRow,
    service.database
      .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
      .get(assetId),
  ).detail
  assert.match(detail, /published/)
  assert.doesNotMatch(
    detail,
    new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
  assert.doesNotMatch(detail, /published\/run|checksum|credential|key/i)
  service.close()
})

test('publisher worker fails closed on conflicting durable publication checksum', async () => {
  const { outputs, service, assetId } = publisherFixture(
    'publisher-conflict-save',
  )
  service.database
    .prepare(
      'INSERT INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)',
    )
    .run(
      assetId,
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
    databaseRow(
      StatusRow,
      service.database
        .prepare('SELECT state FROM asset_publications WHERE asset_id=?')
        .get(assetId),
    ).state,
    'failedPublication',
  )
  assert.equal(
    databaseRow(
      StatusRow,
      service.database
        .prepare("SELECT state FROM outbox WHERE kind='PublishAsset'")
        .get(),
    ).state,
    'failed',
  )
  service.close()
})

test('publisher worker durably settles malformed work, asset identities, and unreadable files', async () => {
  const malformed = publisherFixture('publisher-malformed-save')
  malformed.service.database
    .prepare("UPDATE outbox SET payload='not-json' WHERE kind='PublishAsset'")
    .run()
  let puts = 0
  const malformedWorker = createPublisherWorker(
    malformed.service.database,
    { outputsRoot: malformed.outputs },
    {
      put: async () => {
        puts += 1
      },
      head: async () => undefined,
    },
  )
  assert.equal(await malformedWorker.pass(), 'failed')
  assert.equal(puts, 0)
  assert.equal(
    databaseRow(
      StatusRow,
      malformed.service.database
        .prepare("SELECT state FROM outbox WHERE kind='PublishAsset'")
        .get(),
    ).state,
    'failed',
  )
  malformed.service.close()

  const malformedAsset = publisherFixture('publisher-malformed-asset-save')
  const malformedAssetId = 'not-an-asset'
  malformedAsset.service.database
    .prepare(
      'UPDATE library_assets SET asset_id=?,detail=replace(detail,?,?) WHERE asset_id=?',
    )
    .run(
      malformedAssetId,
      malformedAsset.assetId,
      malformedAssetId,
      malformedAsset.assetId,
    )
  malformedAsset.service.database
    .prepare("UPDATE outbox SET payload=? WHERE kind='PublishAsset'")
    .run(JSON.stringify({ assetId: malformedAssetId, checksum: 'ignored' }))
  const malformedAssetWorker = createPublisherWorker(
    malformedAsset.service.database,
    { outputsRoot: malformedAsset.outputs },
    {
      put: async () => {
        puts += 1
      },
      head: async () => undefined,
    },
  )
  assert.equal(await malformedAssetWorker.pass(), 'failed')
  assert.equal(puts, 0)
  assert.equal(
    databaseRow(
      StatusRow,
      malformedAsset.service.database
        .prepare("SELECT state FROM outbox WHERE kind='PublishAsset'")
        .get(),
    ).state,
    'failed',
  )
  malformedAsset.service.close()

  const unreadable = publisherFixture('publisher-unreadable-save')
  unlinkSync(join(unreadable.outputs, `${unreadable.assetId}.tiff`))
  const unreadableWorker = createPublisherWorker(
    unreadable.service.database,
    { outputsRoot: unreadable.outputs },
    {
      put: async () => {
        puts += 1
      },
      head: async () => undefined,
    },
  )
  assert.equal(await unreadableWorker.pass(), 'failed')
  assert.equal(puts, 0)
  assert.equal(
    databaseRow(
      StatusRow,
      unreadable.service.database
        .prepare("SELECT state FROM outbox WHERE kind='PublishAsset'")
        .get(),
    ).state,
    'failed',
  )
  unreadable.service.close()
})

test('publisher worker lease expiry and stale acknowledgements cannot project stale provider work', async () => {
  const { outputs, service, assetId } = publisherFixture('publisher-lease-save')
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
  const row = databaseRow(
    OutboxAttemptRow,
    service.database
      .prepare("SELECT state,attempts FROM outbox WHERE kind='PublishAsset'")
      .get(),
  )
  assert.equal(row.state, 'dispatched')
  assert.equal(row.attempts, 2)
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  assert.equal(
    databaseRow(
      AssetAvailabilityRow,
      service.database
        .prepare('SELECT availability FROM library_assets WHERE asset_id=?')
        .get(assetId),
    ).availability,
    'published',
  )
  service.close()
})

test('publisher worker preserves a publication persistence failure and recovers the committed claim', async () => {
  const { outputs, service } = publisherFixture('publisher-persistence-save')
  let puts = 0
  const worker = createPublisherWorker(
    service.database,
    { outputsRoot: outputs },
    {
      put: async () => {
        puts += 1
      },
      head: async () => ({
        checksum: createHash('sha256')
          .update('publication-bytes')
          .digest('hex'),
        bytes: 17,
      }),
    },
  )
  service.database.exec(`
    CREATE TRIGGER reject_publication
    BEFORE INSERT ON asset_publications
    BEGIN
      SELECT RAISE(ABORT, 'publication persistence failed');
    END
  `)
  await assert.rejects(worker.pass(), /publication persistence failed/)
  assert.equal(puts, 0)
  assert.equal(
    databaseRow(
      ClaimedOutboxRow,
      service.database
        .prepare(
          "SELECT state,claim_token,claimed_by,claim_until FROM outbox WHERE kind='PublishAsset'",
        )
        .get(),
    ).state,
    'claimed',
  )
  service.database.exec('DROP TRIGGER reject_publication')
  service.database
    .prepare("UPDATE outbox SET claim_until='2000-01-01T00:00:00.000Z'")
    .run()
  assert.equal(await worker.pass(), 'published')
  assert.equal(puts, 1)
  service.close()
})
