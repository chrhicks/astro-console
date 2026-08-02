import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import {
  CommandGateDecision,
  CommandGateInput,
  OperationId,
  acceptedCommandTags,
  commandPolicies,
  evaluateCommandGate,
} from './index.js'

const currentRevisions = {
  plan: 3,
  run: 12,
  lease: 4,
  acquire: 7,
  processing: 9,
  asset: 5,
}

const ownerController = {
  _tag: 'Member',
  personId: 'person-owner',
  clientId: 'client-owner',
  role: 'owner',
  capability: 'controlCapable',
}

const decodeInput = Schema.decodeUnknownSync(CommandGateInput)

const m31Sequence = {
  sequenceId: 'sequence-2',
  targetName: 'M31',
  rightAscensionHours: 0.712,
  declinationDegrees: 41.269,
  exposureSeconds: 180,
  frameCount: 24,
  binning: 1,
  minimumAltitudeDegrees: 25,
  horizonClearanceDegrees: 5,
  recenterThresholdArcsec: 30,
  maxSolveAttempts: 3,
  maxCaptureRetries: 2,
  acquireFailure: 'pause',
  captureFailure: 'retry',
  estimatedDurationSeconds: 4320,
  estimatedStorageBytes: 960000000,
  priority: 0,
}

const evaluate = (command: unknown) =>
  evaluateCommandGate(
    decodeInput({
      envelope: { commandId: 'command-1', command },
      actor: ownerController,
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      leaseHolderClientId: 'client-owner',
      idempotency: { _tag: 'Fresh' },
    }),
  )

describe('shared command gate', () => {
  it('defines one policy for every accepted command', () => {
    assert.deepEqual(Object.keys(commandPolicies), acceptedCommandTags)
    assert.deepEqual(
      Object.entries(commandPolicies)
        .filter(([, policy]) => !policy.requiresDesktop)
        .map(([command]) => command),
      ['RequestAssetDownload'],
    )
  })

  it('rejects unauthenticated commands before policy evaluation', () => {
    const input = decodeInput({
      envelope: {
        commandId: 'command-anonymous',
        command: {
          _tag: 'RequestAssetDownload',
          assetId: 'asset-1',
          idempotencyKey: 'intent-anonymous',
        },
      },
      actor: { _tag: 'Anonymous' },
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      idempotency: { _tag: 'Fresh' },
    })
    const decision = evaluateCommandGate(input)
    assert.equal(decision._tag, 'Rejected')
    if (
      decision._tag === 'Rejected' &&
      decision.failure._tag === 'AuthenticationFailure'
    ) {
      assert.equal(decision.failure.reason, 'Unauthenticated')
    }
  })

  it('accepts a fresh controller command', () => {
    const decision = evaluate({
      _tag: 'StartRunFromPlan',
      planId: 'plan-1',
      expectedPlanRevision: 3,
      expectedLeaseRevision: 4,
      preconditionToken: 'ready-1',
      acceptedPlanLimitationIds: [],
      idempotencyKey: 'intent-1',
    })
    assert.equal(CommandGateDecision.$is('Accepted')(decision), true)
  })

  it('allows owner preview without the control lease', () => {
    const input = decodeInput({
      envelope: {
        commandId: 'command-2',
        command: {
          _tag: 'PreviewRunMutation',
          runId: 'run-1',
          expectedRunRevision: 12,
          proposedChange: {
            _tag: 'AppendFutureSequence',
            sequence: m31Sequence,
          },
        },
      },
      actor: ownerController,
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      leaseHolderClientId: 'client-friend',
      idempotency: { _tag: 'Fresh' },
    })
    assert.equal(
      CommandGateDecision.$is('Accepted')(evaluateCommandGate(input)),
      true,
    )
  })

  it('rejects an old controller command after takeover before domain action', () => {
    const input = decodeInput({
      envelope: {
        commandId: 'command-3',
        command: {
          _tag: 'SkipAcquireTarget',
          runId: 'run-1',
          expectedRunRevision: 12,
          expectedLeaseRevision: 4,
          expectedAcquireRevision: 7,
          idempotencyKey: 'intent-3',
        },
      },
      actor: { ...ownerController, clientId: 'client-old' },
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      leaseHolderClientId: 'client-owner',
      idempotency: { _tag: 'Fresh' },
    })
    const decision = evaluateCommandGate(input)
    assert.equal(decision._tag, 'Rejected')
    if (decision._tag === 'Rejected') {
      assert.equal(decision.failure._tag, 'AuthorizationFailure')
      if (decision.failure._tag === 'AuthorizationFailure')
        assert.equal(decision.failure.reason, 'ControlLeaseLost')
    }
  })

  it('rejects a stale run mutation with current-snapshot guidance', () => {
    const decision = evaluate({
      _tag: 'ApplyRunMutation',
      runId: 'run-1',
      expectedRunRevision: 11,
      expectedLeaseRevision: 4,
      previewId: 'preview-1',
      idempotencyKey: 'intent-4',
    })
    assert.equal(decision._tag, 'Rejected')
    if (decision._tag === 'Rejected') {
      assert.equal(decision.failure._tag, 'FreshnessConflict')
      if (decision.failure._tag === 'FreshnessConflict') {
        assert.equal(decision.failure.reason, 'RunRevisionConflict')
        assert.equal(decision.failure.refreshFromSnapshot, true)
      }
    }
  })

  it('rejects a phone mutation even for the owner', () => {
    const input = decodeInput({
      envelope: {
        commandId: 'command-5',
        command: {
          _tag: 'UndoProcessingStep',
          sessionId: 'process-1',
          expectedProcessingRevision: 9,
          idempotencyKey: 'intent-5',
        },
      },
      actor: { ...ownerController, capability: 'readOnly' },
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      leaseHolderClientId: 'client-owner',
      idempotency: { _tag: 'Fresh' },
    })
    const decision = evaluateCommandGate(input)
    assert.equal(decision._tag, 'Rejected')
    if (
      decision._tag === 'Rejected' &&
      decision.failure._tag === 'AuthorizationFailure'
    ) {
      assert.equal(decision.failure.reason, 'ClientReadOnly')
    }
  })

  it('allows an authorized read-only viewer to request a download', () => {
    const input = decodeInput({
      envelope: {
        commandId: 'command-6',
        command: {
          _tag: 'RequestAssetDownload',
          assetId: 'asset-1',
          idempotencyKey: 'intent-6',
        },
      },
      actor: {
        ...ownerController,
        personId: 'person-viewer',
        clientId: 'client-phone',
        role: 'viewer',
        capability: 'readOnly',
      },
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      idempotency: { _tag: 'Fresh' },
    })
    assert.equal(
      CommandGateDecision.$is('Accepted')(evaluateCommandGate(input)),
      true,
    )
  })

  it('does not let viewer membership perform owner Process work', () => {
    const input = decodeInput({
      envelope: {
        commandId: 'command-viewer',
        command: {
          _tag: 'ResumeProcessingSession',
          sessionId: 'process-1',
          expectedProcessingRevision: 9,
        },
      },
      actor: {
        ...ownerController,
        personId: 'person-viewer',
        clientId: 'client-viewer',
        role: 'viewer',
      },
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      idempotency: { _tag: 'Fresh' },
    })
    const decision = evaluateCommandGate(input)
    assert.equal(decision._tag, 'Rejected')
    if (
      decision._tag === 'Rejected' &&
      decision.failure._tag === 'AuthorizationFailure'
    ) {
      assert.equal(decision.failure.reason, 'OwnerRequired')
    }
  })

  it('returns a recorded result without repeating accepted work', () => {
    const input = decodeInput({
      envelope: {
        commandId: 'command-7',
        command: {
          _tag: 'ApplyRunMutation',
          runId: 'run-1',
          expectedRunRevision: 11,
          expectedLeaseRevision: 3,
          previewId: 'preview-1',
          idempotencyKey: 'intent-7',
        },
      },
      actor: ownerController,
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      leaseHolderClientId: 'client-friend',
      idempotency: { _tag: 'RecordedMatch' },
    })
    assert.equal(
      CommandGateDecision.$is('ReplayRecorded')(evaluateCommandGate(input)),
      true,
    )
  })

  it('returns an existing pending operation without accepting duplicate work', () => {
    const input = decodeInput({
      envelope: {
        commandId: 'command-pending',
        command: {
          _tag: 'ApplyProcessingPreview',
          sessionId: 'process-1',
          expectedProcessingRevision: 8,
          previewId: 'preview-1',
          idempotencyKey: 'intent-pending',
        },
      },
      actor: ownerController,
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      idempotency: { _tag: 'PendingMatch', operationId: 'operation-1' },
    })
    const decision = evaluateCommandGate(input)
    assert.deepEqual(
      decision,
      CommandGateDecision.ReplayPending({
        operationId: Schema.decodeUnknownSync(OperationId)('operation-1'),
      }),
    )
  })

  it('rejects idempotency-key reuse with different input', () => {
    const input = decodeInput({
      envelope: {
        commandId: 'command-8',
        command: {
          _tag: 'DiscardProcessingSession',
          sessionId: 'process-1',
          expectedProcessingRevision: 9,
          confirmationId: 'discard-1',
          idempotencyKey: 'intent-used',
        },
      },
      actor: ownerController,
      connected: true,
      snapshotVersion: 20,
      currentRevisions,
      idempotency: { _tag: 'Conflict' },
    })
    const decision = evaluateCommandGate(input)
    assert.equal(decision._tag, 'Rejected')
    if (decision._tag === 'Rejected')
      assert.equal(decision.failure._tag, 'IdempotencyConflict')
  })
})
