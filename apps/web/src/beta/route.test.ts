import assert from 'node:assert/strict'
import test from 'node:test'
import { nightbookHref } from './route'

test('builds clean Nightbook links without losing unrelated queries', () => {
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
})

test('keeps old presentation parameters compatible but omits them from generated links', () => {
  assert.equal(
    nightbookHref('/observe', '?ui=legacy&scenario=m27'),
    '/observe?scenario=m27',
  )
  assert.equal(
    nightbookHref('/process?sourceAssetId=asset-1', '?ui=legacy&trace=1'),
    '/process?trace=1&sourceAssetId=asset-1',
  )
})
