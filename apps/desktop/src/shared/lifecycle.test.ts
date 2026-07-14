import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  isCaptureInFlight,
  isExternalSequenceActive,
  isExternalSequenceRecoveryActive,
  isExternalSequenceTerminal,
} from './lifecycle'

it('classifies capture and external sequence lifecycle phases', () => {
  assert.equal(isCaptureInFlight('starting'), true)
  assert.equal(isCaptureInFlight('capturing'), true)
  assert.equal(isCaptureInFlight('idle'), false)
  assert.equal(isExternalSequenceActive('lights'), true)
  assert.equal(isExternalSequenceActive('awaiting-darks'), true)
  assert.equal(isExternalSequenceRecoveryActive('darks'), true)
  assert.equal(isExternalSequenceActive('complete'), false)
  assert.equal(isExternalSequenceTerminal('idle'), true)
  assert.equal(isExternalSequenceTerminal('failed'), true)
  assert.equal(isExternalSequenceTerminal('lights'), false)
})
