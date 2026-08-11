import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect, Schema } from 'effect'
import {
  BootstrapHttpSuccessEnvelope,
  BootstrapSnapshot,
  BootstrapSseEventEnvelope,
  PlanCommandRequest,
} from './index.js'

const snapshot = Schema.decodeUnknownSync(BootstrapSnapshot)({
  snapshotVersion: 1,
  eventCursor: 1,
  generatedAt: '2026-08-10T12:00:00.000Z',
  membership: {
    personId: 'owner',
    role: 'owner',
    clientId: 'desktop',
    capability: 'controlCapable',
  },
  control: { revision: 0, state: 'unheld' },
  activeRun: { _tag: 'None' },
  health: {
    service: { state: 'healthy', observedAt: '2026-08-10T12:00:00.000Z' },
    rig: { state: 'healthy', observedAt: '2026-08-10T12:00:00.000Z' },
    tunnel: { state: 'healthy', observedAt: '2026-08-10T12:00:00.000Z' },
    processing: {
      state: 'healthy',
      observedAt: '2026-08-10T12:00:00.000Z',
    },
    publication: {
      state: 'healthy',
      observedAt: '2026-08-10T12:00:00.000Z',
    },
    storage: { state: 'healthy', observedAt: '2026-08-10T12:00:00.000Z' },
  },
})

test('validates actual bootstrap HTTP and SSE envelopes', async () => {
  const http = await Effect.runPromise(
    Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope)({
      ok: true,
      data: snapshot,
    }),
  )
  assert.equal(http.data.eventCursor, 1)

  const event = await Effect.runPromise(
    Schema.decodeUnknownEffect(BootstrapSseEventEnvelope)({
      id: 1,
      event: 'ProjectionChanged',
      data: snapshot,
    }),
  )
  assert.equal(event.id, event.data.eventCursor)

  await assert.rejects(() =>
    Effect.runPromise(
      Schema.decodeUnknownEffect(BootstrapSseEventEnvelope)({
        id: 2,
        event: 'ProjectionChanged',
        data: snapshot,
      }),
    ),
  )
})

test('rejects malformed HTTP request identities and freshness values', async () => {
  await assert.rejects(() =>
    Effect.runPromise(
      Schema.decodeUnknownEffect(PlanCommandRequest)({
        intent: {
          _tag: 'AcceptRunDefinition',
          planId: '',
          expectedPlanRevision: -1,
          expectedLeaseRevision: 0,
          idempotencyKey: 'accept-run',
        },
      }),
    ),
  )
})

test('does not export server, browser, fixture, or simulation behavior', async () => {
  const protocol = await import('./index.js')
  for (const forbidden of [
    'AcquireSession',
    'CapturedFrameIntake',
    'ControlDomainEvent',
    'ProcessingProject',
    'ProcessingStageDraft',
    'ProcessingDevelopPreview',
    'ProcessingStageResult',
    'ProcessingStageState',
    'RunDefinition',
    'decideProcessingProjectAuthority',
    'decideEventCursor',
    'planSequencePresentation',
    'bootstrapFixtures',
    'makeAcquireServerSimulation',
    'evaluateCommandGate',
  ]) {
    assert.equal(forbidden in protocol, false, forbidden)
  }
})
