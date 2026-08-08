import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isBetaObserveLocation,
  isBetaPlanLocation,
  isBetaProcessLocation,
  isBetaWorkspaceLocation,
} from './route'

test('recognizes only the explicit Observe beta URL marker', () => {
  assert.equal(isBetaObserveLocation('/observe', '?ui=beta'), true)
  assert.equal(isBetaObserveLocation('/observe', '?x=1&ui=beta'), true)
  assert.equal(isBetaObserveLocation('/observe', ''), false)
  assert.equal(isBetaObserveLocation('/observe', '?ui=current'), false)
  assert.equal(isBetaObserveLocation('/plan', '?ui=beta'), false)
  assert.equal(isBetaObserveLocation('/observe/beta', '?ui=beta'), false)
})

test('recognizes the bounded Library beta routes', () => {
  assert.equal(isBetaWorkspaceLocation('/library', '?ui=beta'), true)
  assert.equal(
    isBetaWorkspaceLocation('/library/assets/asset-1', '?ui=beta'),
    true,
  )
  assert.equal(isBetaWorkspaceLocation('/library', ''), false)
  assert.equal(isBetaWorkspaceLocation('/library/compare', '?ui=beta'), false)
  assert.equal(
    isBetaWorkspaceLocation('/observe/assets/asset-1', '?ui=beta'),
    false,
  )
  assert.equal(isBetaWorkspaceLocation('/process', '?ui=beta'), true)
})

test('recognizes the explicit Process beta URL marker', () => {
  assert.equal(isBetaProcessLocation('/process', '?ui=beta'), true)
  assert.equal(isBetaProcessLocation('/process', ''), false)
  assert.equal(isBetaProcessLocation('/library', '?ui=beta'), false)
})

test('recognizes the explicit Plan beta URL marker', () => {
  assert.equal(isBetaPlanLocation('/plan', '?ui=beta'), true)
  assert.equal(isBetaPlanLocation('/plan', ''), false)
  assert.equal(isBetaPlanLocation('/observe', '?ui=beta'), false)
})
