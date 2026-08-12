import assert from 'node:assert/strict'
import test from 'node:test'
import { nightbookHref } from './route-href'

test('builds canonical Nightbook links from explicit route data', () => {
  assert.equal(nightbookHref('/observe'), '/observe')
  assert.equal(
    nightbookHref('/process?sourceAssetId=asset%2Fone'),
    '/process?sourceAssetId=asset%2Fone',
  )
})
