import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Result, Schema } from 'effect'

import { DesktopLogEntrySchema, DesktopStatusSchema } from './ipc-schema'

describe('renderer IPC schemas', () => {
  it('rejects malformed pushed log entries', () => {
    const decoded = Schema.decodeUnknownResult(DesktopLogEntrySchema)({
      ts: new Date().toISOString(),
      level: 'verbose',
      event: 'capture.started',
      component: 'capture',
    })
    assert.ok(Result.isFailure(decoded))
  })

  it('rejects a status with an unknown session phase', () => {
    const decoded = Schema.decodeUnknownResult(DesktopStatusSchema)({
      session: { phase: 'owned', discovering: false },
    })
    assert.ok(Result.isFailure(decoded))
  })
})
