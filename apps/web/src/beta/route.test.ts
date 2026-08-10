import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isLegacyWorkspaceLocation,
  isNightbookObserveLocation,
  isNightbookPlanLocation,
  isNightbookProcessLocation,
  isNightbookWorkspaceLocation,
  legacyHref,
  nightbookHref,
} from './route'

test('uses Nightbook for normal and beta-compatible Observe routes', () => {
  assert.equal(isNightbookObserveLocation('/observe', ''), true)
  assert.equal(isNightbookObserveLocation('/observe', '?ui=beta'), true)
  assert.equal(isNightbookObserveLocation('/observe', '?x=1&ui=beta'), true)
  assert.equal(isNightbookObserveLocation('/observe', '?ui=current'), true)
  assert.equal(isNightbookObserveLocation('/observe', '?ui=legacy'), false)
  assert.equal(isNightbookObserveLocation('/plan', ''), false)
  assert.equal(isNightbookObserveLocation('/observe/beta', ''), false)
})

test('bounds Nightbook and explicit legacy to the promoted workspace routes', () => {
  assert.equal(isNightbookWorkspaceLocation('/', ''), true)
  assert.equal(isNightbookWorkspaceLocation('/', '?ui=beta&trace=1'), true)
  assert.equal(isLegacyWorkspaceLocation('/', '?ui=legacy&trace=1'), true)
  assert.equal(isNightbookWorkspaceLocation('/library', ''), true)
  assert.equal(
    isNightbookWorkspaceLocation('/library/assets/asset-1', '?ui=beta'),
    true,
  )
  assert.equal(isLegacyWorkspaceLocation('/library', '?ui=legacy'), true)
  assert.equal(
    isLegacyWorkspaceLocation('/library/assets/asset-1', '?ui=legacy'),
    true,
  )
  assert.equal(isNightbookWorkspaceLocation('/library/compare', ''), false)
  assert.equal(
    isLegacyWorkspaceLocation('/observe/assets/asset-1', '?ui=legacy'),
    false,
  )
  assert.equal(isNightbookWorkspaceLocation('/process', ''), true)
})

test('promotes normal Process and Plan while retaining beta compatibility', () => {
  assert.equal(isNightbookProcessLocation('/process', ''), true)
  assert.equal(isNightbookProcessLocation('/process', '?ui=beta'), true)
  assert.equal(isNightbookProcessLocation('/process', '?ui=legacy'), false)
  assert.equal(isNightbookPlanLocation('/plan', ''), true)
  assert.equal(isNightbookPlanLocation('/plan', '?ui=beta'), true)
  assert.equal(isNightbookPlanLocation('/plan', '?ui=legacy'), false)
  assert.equal(isNightbookPlanLocation('/', ''), true)
  assert.equal(isNightbookPlanLocation('/', '?ui=beta&trace=1'), true)
  assert.equal(isNightbookPlanLocation('/', '?ui=legacy&trace=1'), false)
})

test('builds clean Nightbook links and explicit legacy links without losing unrelated queries', () => {
  assert.equal(
    nightbookHref('/observe', '?ui=beta&scenario=m27'),
    '/observe?scenario=m27',
  )
  assert.equal(
    nightbookHref('/process?sourceAssetId=asset-1', '?ui=beta&trace=1'),
    '/process?trace=1&sourceAssetId=asset-1',
  )
  assert.equal(
    nightbookHref('/library', '?sourceAssetId=asset-1&trace=1'),
    '/library?trace=1',
  )
  assert.equal(
    legacyHref('/process?sourceAssetId=asset-1', '?ui=beta&trace=1'),
    '/process?trace=1&sourceAssetId=asset-1&ui=legacy',
  )
})
