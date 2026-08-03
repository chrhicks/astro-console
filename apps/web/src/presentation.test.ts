import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  fixtureScenarios,
  parseFixtureScenario,
  projectFixture,
} from './fixture-adapter'
import { unavailableProjection } from './future-adapter'
import { ActionResult, actionAvailability, actionResult } from './presentation'
import { parseRoute, routePath, routeWithProjection } from './routes'
import { Shell } from './Shell'
import { LibraryView } from './workspaces/LibraryView'
import { ObserveView } from './workspaces/ObserveView'
import { PlanView } from './workspaces/PlanView'
import { ProcessView } from './workspaces/ProcessView'
import { ActionButton, Status } from './workspaces/shared'

test('routes parse stable IDs and build escaped URLs', () => {
  assert.deepEqual(parseRoute('/library/assets/asset%2Fone'), {
    kind: 'asset',
    assetId: 'asset/one',
  })
  assert.deepEqual(parseRoute('/process/sessions/session%20one'), {
    kind: 'session',
    sessionId: 'session one',
  })
  assert.deepEqual(parseRoute('/process', '?sourceAssetId=asset%2Fone'), {
    kind: 'process-source',
    sourceAssetId: 'asset/one',
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
    routeWithProjection(processSourceRoute, '?fixture=process-failure'),
    '/process?sourceAssetId=asset%2Fone&fixture=process-failure',
  )
})

test('unknown and malformed routes remain bounded', () => {
  assert.deepEqual(parseRoute('/library/assets/%'), { kind: 'not-found' })
  assert.deepEqual(parseRoute('/not-a-workspace'), { kind: 'not-found' })
})

test('production projection fails closed for every consequential action', () => {
  assert.equal(unavailableProjection.shell.readOnly, true)
  assert.equal(
    unavailableProjection.shell.capability,
    'Capability unknown / mutations unavailable',
  )
  assert.equal('action' in unavailableProjection.plan, false)
  assert.equal('action' in unavailableProjection.library, false)
  assert.equal('action' in unavailableProjection.process, false)
})

test('unavailable Plan projection does not claim a draft or revision', () => {
  const markup = renderToStaticMarkup(
    createElement(PlanView, { view: unavailableProjection.plan }),
  )
  assert.match(markup, /Plan draft and revision detail are unavailable/)
  assert.doesNotMatch(markup, /Draft revision is visible/)
  assert.doesNotMatch(markup, /Tonight|25 July|21:00|Dawn 04:32|motion arcs/)
  assert.match(markup, /Sky and observing-window evidence are unavailable/)
  assert.match(markup, /Schedule detail is unavailable/)
})

test('freshness protects actions without viewport-derived authority', () => {
  assert.equal(actionAvailability({ fresh: false }), 'protected')
  assert.equal(actionAvailability({ fresh: true }), 'unavailable')
})

test('typed unavailable results retain the visible protection reason', () => {
  const result = actionResult({
    label: 'Run plan',
    availability: 'unavailable',
    consequence: 'No service intent was submitted.',
    reason: 'The production service snapshot seam is not installed.',
    freshness: 'No authoritative snapshot',
    controller: 'No controller information',
    capability: 'No mutation capability',
    protection: 'Protected: no command can be sent or replayed.',
  })
  ActionResult.$match(result, {
    Pending: () => assert.fail('Expected an unavailable result'),
    Rejected: () => assert.fail('Expected an unavailable result'),
    Unavailable: ({ message }) => {
      assert.match(message, /production service snapshot seam/)
      assert.match(message, /no command can be sent or replayed/)
    },
  })
})

test('future action results distinguish pending and rejected outcomes', () => {
  const action = projectFixture('fresh').plan.action
  if (!action) assert.fail('Expected fixture action')
  assert.equal(
    ActionResult.$is('Pending')(
      actionResult({
        ...action,
        availability: 'available',
      }),
    ),
    true,
  )
  assert.equal(
    ActionResult.$is('Rejected')(
      actionResult({
        ...action,
        availability: 'protected',
      }),
    ),
    true,
  )
})

test('fixture scenarios parse deterministically and remain read-only', () => {
  assert.equal(parseFixtureScenario('unknown'), 'fresh')
  assert.deepEqual(
    fixtureScenarios.map((scenario) => parseFixtureScenario(scenario)),
    fixtureScenarios,
  )
  const projections = fixtureScenarios.map(projectFixture)
  assert.equal(
    new Set(projections.map((projection) => projection.shell.service)).size,
    fixtureScenarios.length,
  )
  for (const projection of projections)
    for (const action of [
      projection.plan.action,
      projection.observe.action,
      projection.library.action,
      projection.process.action,
    ])
      assert.notEqual(action?.availability, 'available')
})

test('fixture Observe lifecycle projections state fixture evidence coherently', () => {
  const lifecycle = [
    ['observe-preflight', 'Preflight'],
    ['observe-acquire', 'Acquire'],
    ['observe-verify', 'Verify'],
    ['observe-complete', 'Complete'],
    ['observe-recovery', 'Recover'],
  ] as const
  for (const [scenario, phase] of lifecycle) {
    const observe = projectFixture(scenario).observe
    assert.equal(observe.phase, phase)
    assert.match(observe.status, /Fixture|fixture/)
    assert.match(observe.evidence, /fixture/i)
    assert.equal(observe.lifecycle.includes(phase), true)
    assert.equal(observe.annotation, observe.evidence)
    assert.ok(observe.trace.length > 0)
  }
})

test('fixture projections distinguish disconnected, rejected, process, and delivery states', () => {
  const disconnected = projectFixture('disconnected')
  assert.match(disconnected.shell.service, /disconnected/i)
  assert.match(disconnected.shell.freshness, /current authoritative truth/i)
  assert.doesNotMatch(disconnected.shell.service, /stale|reconnecting/i)
  assert.match(disconnected.observe.status, /current run truth is unavailable/i)
  assert.equal(disconnected.shell.progressValue, 0)
  assert.equal(disconnected.shell.progressMax, 1)
  assert.match(disconnected.shell.sequenceProgress, /unavailable/i)

  const rejected = projectFixture('rejected')
  assert.match(rejected.observe.status, /simulated action rejection/i)
  assert.match(rejected.observe.action?.reason ?? '', /simulated rejection/i)

  assert.match(
    projectFixture('process-failure').process.failure ?? '',
    /Fixture Stretch failed/,
  )
  assert.match(
    projectFixture('delivery-ready').library.assets[0]?.download ?? '',
    /Fixture representation ready to download/,
  )
})

test('read-only action boundaries expose facts without a button', () => {
  const action = projectFixture('fresh').plan.action
  if (!action) assert.fail('Expected fixture action')
  const markup = renderToStaticMarkup(
    createElement(ActionButton, {
      action,
      renderActions: false,
      submit: () => undefined,
    }),
  )
  assert.doesNotMatch(markup, /<button/)
  assert.match(markup, /Development fixture has no command service/)
})

test('status and shell environment preserve semantic and projected facts', () => {
  const status = renderToStaticMarkup(
    createElement(Status, { tone: 'attention', children: 'Awaiting service' }),
  )
  const shell = renderToStaticMarkup(
    createElement(
      Shell,
      {
        workspace: 'plan',
        view: unavailableProjection.shell,
        link: (route) => ({ href: routePath(route), onClick: () => undefined }),
        result: ActionResult.Unavailable({
          message: 'Static result output remains visible.',
        }),
      },
      createElement('p', null, 'Workspace'),
    ),
  )
  assert.match(status, /role="status"/)
  assert.match(shell, /Authoritative projection/)
  assert.match(shell, /Capability unknown \/ mutations unavailable/)
  assert.match(shell, /Commands cannot be sent or replayed/)
  assert.match(shell, /Service availability unknown without a snapshot/)
  assert.match(shell, /Static result output remains visible/)
})

test('process has a focusable screen heading', () => {
  const markup = renderToStaticMarkup(
    createElement(ProcessView, {
      view: unavailableProjection.process,
      sessionId: undefined,
      sourceAssetId: undefined,
    }),
  )
  assert.match(markup, /<h1 tabindex="-1">No processing session<\/h1>/)
})

test('room projections render their required landmarks', () => {
  const projection = projectFixture('fresh')
  const link = (route: ReturnType<typeof parseRoute>) => {
    if (route.kind === 'not-found') assert.fail('Expected a workspace route')
    return { href: routePath(route), onClick: () => undefined }
  }
  const plan = renderToStaticMarkup(
    createElement(PlanView, { view: projection.plan }),
  )
  const observe = renderToStaticMarkup(
    createElement(ObserveView, { view: projection.observe }),
  )
  const library = renderToStaticMarkup(
    createElement(LibraryView, {
      view: projection.library,
      assetId: undefined,
      link,
    }),
  )
  const process = renderToStaticMarkup(
    createElement(ProcessView, {
      view: projection.process,
      sessionId: undefined,
      sourceAssetId: undefined,
    }),
  )
  assert.match(plan, /sequence-list/)
  assert.match(plan, /sky-field/)
  assert.match(plan, /plan-timeline/)
  assert.match(observe, /observe-image/)
  assert.match(observe, /observe-decision/)
  assert.match(observe, /lifecycle/)
  assert.match(library, /library-lineage/)
  assert.match(library, /library-inspector/)
  assert.match(library, /frame-grid/)
  assert.match(process, /process-steps/)
  assert.match(process, /process-canvas/)
  assert.match(process, /process-rail/)
  assert.match(observe, /evidence-image/)
  assert.match(process, /evidence-image/)
})
