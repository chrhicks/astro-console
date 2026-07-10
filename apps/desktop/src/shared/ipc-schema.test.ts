import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'

import { DesktopLogEntrySchema, DesktopStatusSchema } from './ipc-schema'

describe('renderer IPC schemas', () => {
  it('rejects malformed pushed log entries', () => {
    const decoded = Schema.decodeUnknownEither(DesktopLogEntrySchema)({
      ts: new Date().toISOString(),
      level: 'verbose',
      event: 'capture.started',
      component: 'capture',
    })
    assert.equal(decoded._tag, 'Left')
  })

  it('rejects a status with an unknown session phase', () => {
    const decoded = Schema.decodeUnknownEither(DesktopStatusSchema)({
      session: { phase: 'owned', discovering: false },
    })
    assert.equal(decoded._tag, 'Left')
  })
})
