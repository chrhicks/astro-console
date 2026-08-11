import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRoute, routePath, routeWithProjection } from './routes'

test('routes parse stable IDs and build escaped URLs', () => {
  assert.deepEqual(parseRoute('/library/assets/asset%2Fone'), {
    kind: 'asset',
    assetId: 'asset/one',
  })
  assert.deepEqual(parseRoute('/process/sessions/session%20one'), {
    kind: 'not-found',
  })
  assert.deepEqual(parseRoute('/process/projects/project%20one'), {
    kind: 'process-project',
    projectId: 'project one',
  })
  assert.deepEqual(parseRoute('/process', '?sourceAssetId=asset%2Fone'), {
    kind: 'process-source',
    sourceAssetId: 'asset/one',
  })
  assert.deepEqual(parseRoute('/process', '?ui=beta'), {
    kind: 'workspace',
    workspace: 'process',
  })
  assert.deepEqual(parseRoute('/process', '?ui=legacy'), {
    kind: 'workspace',
    workspace: 'process',
  })

  const assetRoute = parseRoute('/library/assets/asset%2Fone')
  if (assetRoute.kind !== 'asset') assert.fail('Expected an asset route')
  assert.equal(routePath(assetRoute), '/library/assets/asset%2Fone')

  const processSourceRoute = parseRoute(
    '/process',
    '?sourceAssetId=asset%2Fone',
  )
  if (processSourceRoute.kind !== 'process-source')
    assert.fail('Expected a process-source route')
  assert.equal(
    routeWithProjection(processSourceRoute),
    '/process?sourceAssetId=asset%2Fone',
  )

  const processProjectRoute = parseRoute('/process/projects/project%2Fone')
  if (processProjectRoute.kind !== 'process-project')
    assert.fail('Expected a process-project route')
  assert.equal(
    routeWithProjection(processProjectRoute),
    '/process/projects/project%2Fone',
  )
})

test('unknown and malformed routes remain bounded', () => {
  assert.deepEqual(parseRoute('/library/assets/%'), { kind: 'not-found' })
  assert.deepEqual(parseRoute('/not-a-workspace'), { kind: 'not-found' })
})
