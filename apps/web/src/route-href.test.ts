import assert from 'node:assert/strict'
import test from 'node:test'
import { routeHref } from './route-href'

test('builds canonical route links from explicit route data', () => {
  assert.equal(routeHref('/observe'), '/observe')
  assert.equal(
    routeHref('/process?sourceAssetId=asset%2Fone'),
    '/process?sourceAssetId=asset%2Fone',
  )
})
