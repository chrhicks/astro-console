import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from 'effect'
import { ObserveWorkspaceProjection } from '@astro-console/v2-contracts'
import {
  beginObserveOperation,
  isCurrentObserveOperation,
} from './observe-operation'

const source = Schema.decodeUnknownSync(ObserveWorkspaceProjection)({
  runId: 'run-active-001',
  revision: 1,
  executor: 'fake',
  phase: 'capture',
  target: 'M27',
  currentSequence: 0,
  completedSequences: 0,
  totalSequences: 2,
  retryUsed: false,
  lifecycleFacts: ['Fake lifecycle started.'],
  attemptFacts: ['Fake lifecycle only.'],
  actions: {
    pause: { _tag: 'Eligible' },
    resume: { _tag: 'Ineligible', reason: 'pausedRunRequired' },
    stop: { _tag: 'Eligible' },
    skip: { _tag: 'Eligible' },
    retry: { _tag: 'Eligible' },
    park: { _tag: 'Eligible' },
  },
})

test('Observe operation guard prevents a pending double-click and rejects old completions', () => {
  const operation = beginObserveOperation(undefined, source, 1)
  if (operation === undefined) throw new Error('Expected an Observe operation')
  assert.equal(beginObserveOperation(operation, source, 2), undefined)
  assert.equal(isCurrentObserveOperation(operation, source, operation), true)
  assert.equal(
    isCurrentObserveOperation(
      operation,
      Schema.decodeUnknownSync(ObserveWorkspaceProjection)({
        ...source,
        revision: 2,
      }),
      operation,
    ),
    false,
  )
})
