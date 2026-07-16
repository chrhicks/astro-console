import assert from 'node:assert/strict'
import { it } from 'node:test'
import { decideWorkAreaStatus } from './work-area-status'

const workspace = {
  state: 'primed' as const,
  stateLabel: 'Primed',
  surface: { kind: 'idle' as const, label: 'Idle' },
  capabilities: { preview: 'unsupported' as const, capture: 'external' as const, darkExposure: 'no' as const, autofocus: 'no' as const, filterWheel: 'no' as const, storage: 'no' as const },
  actions: [],
}

it('prioritizes capture failures over pointing and workspace status', () => {
  assert.equal(
    decideWorkAreaStatus(
      { phase: 'failed' },
      { phase: 'failed', target: null, lastError: 'Slew failed' },
      workspace,
      'exposure',
    ),
    'Exposure failed. Retry or start preview.',
  )
})

it('uses external copy for an actionable external workspace', () => {
  assert.equal(
    decideWorkAreaStatus(
      { phase: 'idle' },
      { phase: 'idle', target: null },
      workspace,
      'exposure',
    ),
    'Ready to preview or expose.',
  )
})
