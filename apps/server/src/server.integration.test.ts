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
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { ConfigProvider, Effect, Schema } from 'effect'
import {
  AcquireSnapshot,
  BootstrapHttpSuccessEnvelope,
  BootstrapSseEventEnvelope,
  CommandHttpFailureEnvelope,
  CommandHttpSuccessEnvelope,
  DomainEvent,
  ObserveCommandResponse,
  PlanCommandResponse,
  ProcessSourceHandoff,
  RunSnapshot,
} from '@astro-console/v2-contracts'
import {
  createOriginAdmission,
  createJwksKeyResolver,
  createMembershipBootstrapResolver,
  createProductionAccessAdmission,
  createLocalWebService,
} from './server.ts'
import { DatabasePathNotAppOwned, openAppOwnedDatabase } from './database.ts'
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
import { createDownloadGrantService } from './download-grant-service.ts'
import { isSqliteBusy } from './publisher-service.ts'
import { createProcessorService, runProcessor } from './processor-service.ts'
import { ingestSourceAsset } from './source-ingest.ts'
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

async function bootstrapSnapshot(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const body: unknown = await response.json()
  return Schema.decodeUnknownSync(BootstrapHttpSuccessEnvelope)(body).data
}

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
        sequences: initial.plan.sequences.map(({ viability, ...sequence }) => ({
          ...sequence,
          capture: `${sequence.capture} · revised`,
        })),
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
        sequences: initial.plan.sequences.map((sequence) => ({
          ...sequence,
          capture: `${sequence.capture} · revised`,
        })),
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
const EventRow = Schema.Struct({ checksum: Schema.String })
const StatusRow = Schema.Struct({ state: Schema.String })
const ProjectionRow = Schema.Struct({ value: Schema.String })
const RunDefinitionEvidenceRow = Schema.Struct({ definition: Schema.String })
const AssetAvailabilityRow = Schema.Struct({ availability: Schema.String })
const AssetDetailRow = Schema.Struct({ detail: Schema.String })
const PublicationRow = Schema.Struct({ object_key: Schema.String })
const SourceOrphanRow = Schema.Struct({
  path: Schema.String,
  checksum: Schema.String,
})
const SolarIntentRow = Schema.Struct({
  name: Schema.String,
  owner_person_id: Schema.String,
  owner_client_id: Schema.String,
  state: Schema.String,
})
const SolarEvidenceRow = Schema.Struct({
  state: Schema.String,
  message: Schema.String,
})
const OutboxRow = Schema.Struct({
  kind: Schema.String,
  payload: Schema.String,
  state: Schema.String,
  attempts: Schema.Int,
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

const DispatchedOutboxRow = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  claim_token: Schema.NullOr(Schema.String),
  ack_at: Schema.NullOr(Schema.String),
  attempts: Schema.Int,
})

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
      ASTRO_SERVER_DB: '/state.sqlite',
    }),
    { mode: 'disabled', databasePath: '/state.sqlite' },
  )
  assert.deepEqual(
    await read(rigWorkerEnvironmentConfig, {
      ASTRO_SERVER_DB: '/state.sqlite',
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
    read(rigWorkerEnvironmentConfig, {
      ASTRO_SERVER_DB: '/state.sqlite',
      ASTRO_RIG_WORKER_MODE: 'wrong',
    }),
  )
  await assert.rejects(
    read(rigWorkerEnvironmentConfig, {
      ASTRO_SERVER_DB: '/state.sqlite',
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
          "SELECT count(*) AS count FROM source_ingest_events WHERE asset_id='asset-source-solar-001'",
        )
        .get(),
    ).count,
    1,
  )
  assert.equal(existsSync(join(originals, 'asset-source-solar-001.tiff')), true)
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
    sourceAssetIds: ['asset-source-solar-001'],
    runId: 'solar-run-001',
    solveAttemptId: 'solar-solve-001',
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
      comparisonGroupId: 'solar-orphan-001',
      lineage: { runId: 'solar-run-001', solveAttemptId: 'solar-solve-001' },
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

test('disabled rig worker exits without creating or mutating its database', async () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-worker-disabled-')),
    'state.sqlite',
  )
  const worker = createRigWorkerService(
    { mode: 'disabled', databasePath },
    undefined,
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
    databaseRow(
      CountRow,
      service.database
        .prepare('SELECT count(*) AS count FROM solar_test_intents')
        .get(),
    ).count,
    0,
  )
  assert.equal(
    databaseRow(
      CountRow,
      service.database.prepare('SELECT count(*) AS count FROM outbox').get(),
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
  const intent = databaseRow(
    SolarIntentRow,
    service.database
      .prepare(
        'SELECT name,owner_person_id,owner_client_id,state FROM solar_test_intents WHERE intent_id=?',
      )
      .get(accepted.intentId),
  )
  assert.equal(intent.name, input.name)
  assert.equal(intent.owner_person_id, 'owner')
  assert.equal(intent.owner_client_id, 'desktop')
  assert.equal(intent.state, 'awaitingAdapter')
  const evidence = databaseRow(
    SolarEvidenceRow,
    service.database
      .prepare(
        'SELECT state,message FROM solar_test_evidence WHERE intent_id=?',
      )
      .get(accepted.intentId),
  )
  assert.equal(evidence.state, 'awaitingStackEvidence')
  assert.match(evidence.message, /Stack evidence/)
  const outbox = databaseRow(
    OutboxRow,
    service.database
      .prepare(
        "SELECT kind,payload,state,attempts FROM outbox WHERE kind='StartSolarTestObservation'",
      )
      .get(),
  )
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
    databaseRow(
      CountRow,
      service.database
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE kind='StartSolarTestObservation'",
        )
        .get(),
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
  const recoveredOutbox = databaseRow(
    OutboxAttemptRow,
    recovered.database
      .prepare(
        "SELECT state,attempts FROM outbox WHERE kind='StartSolarTestObservation'",
      )
      .get(),
  )
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
  if (result.outcome !== 'accepted' || !('intentId' in result))
    throw new Error('Expected Solar CLI acceptance')
  const stopped = runSolarTestIntent({
    databasePath,
    subject: 'solar-owner-subject',
    command: { action: 'stop', intentId: result.intentId },
  })
  assert.deepEqual(stopped, { outcome: 'accepted' })
  const inspected = createFixtureService(databasePath)
  assert.equal(
    databaseRow(
      StatusRow,
      inspected.database
        .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
        .get(result.intentId),
    ).state,
    'stopping',
  )
  assert.equal(
    databaseRow(
      StatusRow,
      inspected.database
        .prepare(
          "SELECT state FROM outbox WHERE kind='StopSolarTestObservation'",
        )
        .get(),
    ).state,
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

test('a rig worker dispatches only a Solar test and records provider acknowledgement separately from Stack evidence', async (t) => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-rig-worker-')),
    'state.sqlite',
  )
  const service = createFixtureService(databasePath)
  const listener = await service.listen()
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
  const row = databaseRow(
    DispatchedOutboxRow,
    service.database
      .prepare(
        "SELECT id,state,claim_token,ack_at,attempts FROM outbox WHERE kind='StartSolarTestObservation'",
      )
      .get(),
  )
  assert.equal(row.state, 'dispatched')
  assert.equal(row.claim_token, null)
  assert.notEqual(row.ack_at, null)
  assert.equal(row.attempts, 1)
  assert.equal(
    databaseRow(
      StatusRow,
      service.database
        .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
        .get(intent.intentId),
    ).state,
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
    databaseRow(
      StatusRow,
      service.database
        .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
        .get(intent.intentId),
    ).state,
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
    databaseRow(
      StatusRow,
      service.database
        .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
        .get(uncertainIntent.intentId),
    ).state,
    'manualRecovery',
  )
  assert.equal(
    databaseRow(
      StatusRow,
      service.database
        .prepare(
          "SELECT state FROM outbox WHERE kind='StartSolarTestObservation' AND state='uncertain'",
        )
        .get(),
    ).state,
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
    databaseRow(
      StatusRow,
      service.database
        .prepare('SELECT state FROM solar_test_intents WHERE intent_id=?')
        .get(expiredIntent.intentId),
    ).state,
    'manualRecovery',
  )
  assert.equal(
    databaseRow(
      StatusRow,
      service.database
        .prepare('SELECT state FROM solar_test_recovery WHERE intent_id=?')
        .get(expiredIntent.intentId),
    ).state,
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
  const service = createFixtureService(databasePath, undefined, {
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
  if (saved.outcome !== 'accepted' || !('assetIds' in saved))
    throw new Error('save did not accept')
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
  const isolated = databaseRow(
    ClaimedOutboxRow,
    service.database
      .prepare(
        "SELECT state,claim_token,claimed_by,claim_until FROM outbox WHERE kind='PublishAsset'",
      )
      .get(),
  )
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
        const checksum = databaseRow(
          EventRow,
          service.database
            .prepare(
              'SELECT checksum FROM process_asset_events WHERE asset_id=?',
            )
            .get(first(saved.assetIds)),
        )
        return { checksum: checksum.checksum, bytes: 15 }
      },
    },
  )
  assert.equal(await publisher.pass(), 'published')
  assert.equal(uploads, 1)
  assert.equal(
    databaseRow(
      StatusRow,
      service.database
        .prepare("SELECT state FROM outbox WHERE kind='PublishAsset'")
        .get(),
    ).state,
    'dispatched',
  )
  rig.close()
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
  assert.equal(accepted?.evidence.stack?.availability, 'available')
  assert.equal(accepted?.evidence.stack?.frameCount, 43)
  const projected = await nextEvent(reader)
  assert.match(projected, /event: ProjectionChanged/)
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
  assert.equal(failed?.evidence.stack?.availability, 'unavailable')
  assert.match(failed?.evidence.stack.message ?? '', /camera transport lost/)
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
    {
      _tag: 'Unavailable',
      action: 'download',
      reason: 'PublicationUnavailable',
    },
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
    `${base}/api/workspaces/process?sourceAssetId=${assetId}`,
  )
  assert.equal(processResponse.status, 200)
  const process = Schema.decodeUnknownSync(ProcessSourceHandoff)(
    await processResponse.json(),
  )
  assert.deepEqual(process, {
    sourceAssetId: assetId,
    revision: 1,
    role: 'preview',
    format: 'fits',
    availability: 'availableLocally',
    comparisonGroupId: 'm27-stack-1',
    lineage: {
      sourceAssetIds: ['asset-m27-001'],
      runId: 'run-m27-001',
      solveAttemptId: 'solve-m27-001',
    },
    processing: {
      availability: 'unavailable',
      currentFixtureFacts: [
        'Interactive processing is not available in this workspace.',
      ],
    },
  })
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
    `${base}/api/workspaces/process?sourceAssetId=${assetId}`,
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
  service.database
    .prepare("UPDATE library_assets SET detail='{}' WHERE asset_id=?")
    .run(assetId)
  assert.equal(
    (await fetch(`${base}/api/workspaces/process?sourceAssetId=${assetId}`))
      .status,
    503,
  )
  assert.equal((await fetch(`${base}/api/workspaces/process`)).status, 400)
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
  assert.deepEqual(recoveredDetail.actions[0], {
    _tag: 'Eligible',
    action: 'download',
  })
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
        sequences: initial.plan.sequences.map(({ viability, ...sequence }) => ({
          ...sequence,
          capture: `${sequence.capture} · saved`,
        })),
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
  assert.equal(definition.executor, 'fake')
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
  assert.equal(
    databaseRow(
      CountRow,
      recovered.database
        .prepare('SELECT count(*) AS count FROM solar_test_intents')
        .get(),
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
    '/api/workspaces/process',
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
  writeFileSync(join(webDistPath, 'alignment-aperture-light.svg'), '<svg/>')
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
  const symbol = await fetch(`${base}/alignment-aperture-light.svg`)
  assert.equal(symbol.headers.get('content-type'), 'image/svg+xml')
  assert.equal(symbol.headers.get('cache-control'), 'no-store')
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
  const saved = await submitPlan(base, {
    _tag: 'SaveDraft',
    planId: initial.plan.planId,
    expectedPlanRevision: initial.plan.revision,
    idempotencyKey: 'canonical-plan-save',
    sequences: sequences.map((sequence, index) =>
      index === 1
        ? { ...sequence, capture: `${sequence.capture} · shortened` }
        : sequence,
    ),
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
  const draft = saved.body.snapshot.plan
  if (draft === undefined) throw new Error('Saved Plan is unavailable')
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
    sequences: sequences.map((sequence) => ({
      ...sequence,
      capture: '48 × 180s · L',
    })),
  })
  assert.equal(later.response.status, 202)
  const definition = databaseRow(
    RunDefinitionEvidenceRow,
    service.database.prepare('SELECT definition FROM run_definitions').get(),
  )
  assert.notEqual(
    JSON.parse(definition.definition).plan.sequences[0].capture,
    '48 × 180s · L',
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
  assert.match(await nextEvent(reconnectReader), /"eventCursor":2/)
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
