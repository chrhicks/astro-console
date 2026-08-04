import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import type { IncomingMessage } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
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
  RefreshPreflightResponse,
  RunSnapshot,
} from '@astro-console/v2-contracts'
import {
  createOriginAdmission,
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
import { createPublisherWorker } from './workers/publisher-worker.ts'
import { originServerConfig } from './config/environment-config.ts'

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
const PublicationRow = Schema.Struct({ object_key: Schema.String })
const ClaimedOutboxRow = Schema.Struct({
  state: Schema.String,
  claim_token: Schema.NullOr(Schema.String),
  claimed_by: Schema.NullOr(Schema.String),
  claim_until: Schema.NullOr(Schema.String),
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

test('publisher recovers a claimed PublishAsset without touching its claim owner', async () => {
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
