import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Result, Schema } from 'effect'
import {
  BootstrapHttpFailureEnvelope,
  BootstrapHttpSuccessEnvelope,
  BootstrapSnapshot,
  BootstrapSseEventEnvelope,
} from './bootstrap.js'
import { bootstrapFixtures } from './bootstrap-fixtures.js'

describe('production bootstrap wire contract', () => {
  it('decodes fresh, stale, viewer, phone, active-run, no-run, and unavailable projections', () => {
    for (const fixture of Object.values(bootstrapFixtures)) {
      const decoded = Schema.decodeUnknownResult(BootstrapSnapshot)(fixture)
      assert.equal(Result.isSuccess(decoded), true)
    }

    const activeRun = Schema.decodeUnknownSync(BootstrapSnapshot)(
      bootstrapFixtures.activeRun,
    )
    assert.equal(activeRun.activeRun._tag, 'Active')
    assert.equal(activeRun.activeRun.run.phase, 'capture')

    const phone = Schema.decodeUnknownSync(BootstrapSnapshot)(
      bootstrapFixtures.phone,
    )
    assert.equal(phone.membership.capability, 'readOnly')
    assert.equal(phone.membership.role, 'owner')
  })

  it('decodes HTTP success and failure envelopes plus an SSE projection event', () => {
    const success = Schema.decodeUnknownResult(BootstrapHttpSuccessEnvelope)({
      ok: true,
      data: bootstrapFixtures.fresh,
    })
    const failure = Schema.decodeUnknownResult(BootstrapHttpFailureEnvelope)({
      ok: false,
      failure: {
        _tag: 'AuthenticationFailure',
        reason: 'Unauthenticated',
        summary: 'A verified member identity is required.',
      },
    })
    const event = Schema.decodeUnknownResult(BootstrapSseEventEnvelope)({
      id: 42,
      event: 'ProjectionChanged',
      data: bootstrapFixtures.activeRun,
    })

    assert.equal(Result.isSuccess(success), true)
    assert.equal(Result.isSuccess(failure), true)
    assert.equal(Result.isSuccess(event), true)
  })

  it('rejects malformed bootstrap, HTTP, and SSE payloads', () => {
    const malformedSnapshot = Schema.decodeUnknownResult(BootstrapSnapshot)({
      ...bootstrapFixtures.fresh,
      membership: {
        ...bootstrapFixtures.fresh.membership,
        capability: 'owner',
      },
    })
    const malformedFailure = Schema.decodeUnknownResult(
      BootstrapHttpFailureEnvelope,
    )({
      ok: false,
      failure: {
        _tag: 'AuthenticationFailure',
        reason: 'ControlLeaseLost',
        summary: 'Not an authentication failure.',
      },
    })
    const malformedEvent = Schema.decodeUnknownResult(
      BootstrapSseEventEnvelope,
    )({
      id: 41,
      event: 'ProjectionChanged',
      data: bootstrapFixtures.activeRun,
    })

    assert.equal(Result.isFailure(malformedSnapshot), true)
    assert.equal(Result.isFailure(malformedFailure), true)
    assert.equal(Result.isFailure(malformedEvent), true)
  })
})
