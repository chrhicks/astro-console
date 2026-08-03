import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Schema } from 'effect'
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
import { planDraftStatus, PlanView } from './workspaces/PlanView'
import { ProcessView } from './workspaces/ProcessView'
import { ActionButton, Status } from './workspaces/shared'
import { BootstrapClientState } from './bootstrap-client'
import { projectBootstrapState } from './bootstrap-projection'
import {
  bootstrapFixtures,
  BootstrapSnapshot,
  LibraryAssetDetail,
  LibraryPage,
  LibraryQuery,
  ProcessSourceHandoff,
} from '@astro-console/v2-contracts'

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

test('Plan draft status distinguishes ephemeral changes from saved revisions', () => {
  assert.equal(planDraftStatus(3, false), 'Saved draft revision 3')
  assert.equal(planDraftStatus(3, true), 'Unsaved draft changes')
})

test('Plan distinguishes saved drafts, unsaved edits, immutable definitions, and eligible actions', () => {
  const previewExpiresAt = new Date(Date.now() + 60_000).toISOString()
  const snapshot = Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.fresh,
    plan: {
      planId: 'plan-m27',
      revision: 3,
      readiness: 'ready',
      readinessSummary: 'Ready.',
      limitations: [],
      sequences: [
        {
          sequenceId: 'seq-1',
          target: 'M27',
          capture: '24 × 180s',
          acquisition: 'Solve and center',
          stopCondition: '24 frames',
          window: {
            startsAt: '2026-08-02T20:00:00Z',
            endsAt: '2026-08-02T21:00:00Z',
            usableMinutes: 60,
            peakAltitudeDeg: 60,
            horizonClearanceDeg: 20,
          },
          estimatedMinutes: 60,
          storageForecastMb: 1200,
          horizon: 'clear',
          storage: 'available',
          viability: 'viable',
        },
      ],
      acceptedRunDefinition: {
        id: 'definition-m27-r2',
        sourcePlanRevision: 2,
        acceptedAt: '2026-08-02T19:00:00Z',
        executor: 'fake',
      },
      runMutationPreview: {
        previewId: 'notice-preview',
        classification: 'notice',
        consequences: 'The second sequence will be shortened.',
        expiresAt: previewExpiresAt,
        approvalRequired: false,
      },
      actions: {
        saveDraft: { _tag: 'Eligible' },
        acceptRunDefinition: {
          _tag: 'Ineligible',
          reason: 'acceptedDefinitionRequired',
        },
        startAcceptedRun: { _tag: 'Eligible' },
        previewRunMutation: { _tag: 'Ineligible', reason: 'activeRunRequired' },
        applyRunMutation: { _tag: 'Eligible' },
        approveDisruptiveRunMutation: {
          _tag: 'Ineligible',
          reason: 'activeRunRequired',
        },
      },
    },
  })
  const planSource = snapshot.plan
  if (planSource === undefined) throw new Error('Expected Plan projection')
  const preview = planSource.runMutationPreview
  if (preview === undefined) throw new Error('Expected mutation preview')
  const current = renderToStaticMarkup(
    createElement(PlanView, {
      view: projectBootstrapState(BootstrapClientState.Current({ snapshot }))
        .plan,
    }),
  )
  const stale = renderToStaticMarkup(
    createElement(PlanView, {
      view: projectBootstrapState(
        BootstrapClientState.Stale({ snapshot, reason: 'reconnecting' }),
      ).plan,
    }),
  )
  const expired = renderToStaticMarkup(
    createElement(PlanView, {
      view: projectBootstrapState(
        BootstrapClientState.Current({
          snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
            ...snapshot,
            plan: {
              ...planSource,
              runMutationPreview: {
                ...preview,
                expiresAt: new Date(Date.now() - 60_000).toISOString(),
              },
            },
          }),
        }),
      ).plan,
    }),
  )
  const readOnly = renderToStaticMarkup(
    createElement(PlanView, {
      view: projectBootstrapState(
        BootstrapClientState.Current({
          snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
            ...snapshot,
            membership: { ...snapshot.membership, capability: 'readOnly' },
            plan: {
              ...planSource,
              actions: {
                ...planSource.actions,
                saveDraft: { _tag: 'Ineligible', reason: 'readOnlyClient' },
                applyRunMutation: {
                  _tag: 'Ineligible',
                  reason: 'readOnlyClient',
                },
              },
            },
          }),
        }),
      ).plan,
    }),
  )
  assert.match(current, /Shorten selected sequence/)
  assert.doesNotMatch(current, />Save draft</)
  assert.match(current, /Saved draft revision 3/)
  assert.match(current, /Start accepted fake run/)
  assert.match(
    current,
    /Immutable accepted fake RunDefinition definition-m27-r2 from saved Plan revision 2/,
  )
  assert.match(current, /Later Plan edits do not alter it/)
  assert.match(current, /does not start a run or observe completion/)
  assert.match(current, /The second sequence will be shortened/)
  assert.match(current, /Apply exact preview/)
  assert.match(current, /Available until/)
  assert.match(current, /aria-pressed="true"/)
  assert.doesNotMatch(current, /acceptedDefinitionRequired|activeRunRequired/)
  assert.doesNotMatch(expired, /Apply exact preview/)
  assert.match(expired, /This preview expired. Refresh the Plan/)
  assert.doesNotMatch(stale, /<button class=/)
  assert.match(stale, /reconnecting/)
  assert.doesNotMatch(readOnly, /Shorten selected sequence/)
  assert.doesNotMatch(readOnly, /<button class=/)
  assert.doesNotMatch(readOnly, /exact preview|readOnlyClient/)
  assert.match(readOnly, /This client is read-only/)
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
  assert.equal(disconnected.shell.currentRun, undefined)

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

test('shell exposes a persisted current run outside Observe without commands', () => {
  const projection = projectFixture('fresh')
  const link = (route: ReturnType<typeof parseRoute>) => {
    if (route.kind === 'not-found') assert.fail('Expected a workspace route')
    return { href: routePath(route), onClick: () => undefined }
  }
  const library = renderToStaticMarkup(
    createElement(Shell, {
      workspace: 'library',
      view: projection.shell,
      link,
      result: undefined,
    }),
  )
  const observe = renderToStaticMarkup(
    createElement(Shell, {
      workspace: 'observe',
      view: projection.shell,
      link,
      result: undefined,
    }),
  )
  assert.match(library, /Return to Observe/)
  assert.match(library, /Fixture estimate: 2h 18m remaining/)
  assert.doesNotMatch(library, /<button/)
  assert.doesNotMatch(observe, /Return to Observe/)
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

test('Process source handoffs resolve only from the server without Process claims', () => {
  const markup = renderToStaticMarkup(
    createElement(ProcessView, {
      view: projectFixture('fresh').process,
      sessionId: undefined,
      sourceAssetId: 'asset-source-1',
      sourceHandoff: Schema.decodeUnknownSync(ProcessSourceHandoff)({
        sourceAssetId: 'asset-source-1',
        role: 'original',
        availability: 'availableLocally',
        processing: {
          availability: 'unavailable',
          currentFixtureFacts: [
            'Interactive processing is not available in this workspace.',
          ],
        },
      }),
    }),
  )
  assert.match(markup, /asset-source-1 \/ stable handoff/)
  assert.match(
    markup,
    /Source role: original\. Source availability: availableLocally\./,
  )
  assert.match(markup, /Interactive processing is unavailable\./)
  assert.doesNotMatch(markup, /Build complete|Last valid image|evidence-image/)
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

test('Library renders only eligible desktop actions and keeps phone read-only', () => {
  const detail = Schema.decodeUnknownSync(LibraryAssetDetail)({
    assetId: 'asset-1',
    revision: 1,
    role: 'final',
    format: 'fits',
    availability: 'published',
    capturedAt: '2026-08-03T00:00:00.000Z',
    comparisonGroupId: 'group-1',
    lineage: {
      sourceAssetIds: ['source-1'],
      runId: 'run-1',
      solveAttemptId: 'solve-1',
    },
    representations: [{ label: 'Published FITS', state: 'published' }],
    actions: [
      { _tag: 'Eligible', action: 'download' },
      {
        _tag: 'Unavailable',
        action: 'openInProcess',
        reason: 'AssetNotAvailableLocally',
      },
    ],
  })
  const view = projectFixture('fresh').library
  const link = (route: ReturnType<typeof parseRoute>) => {
    if (route.kind === 'not-found') assert.fail('Expected a workspace route')
    return { href: routePath(route), onClick: () => undefined }
  }
  const desktop = renderToStaticMarkup(
    createElement(LibraryView, { view, assetId: 'asset-1', link, detail }),
  )
  const phone = renderToStaticMarkup(
    createElement(LibraryView, {
      view,
      assetId: 'asset-1',
      link,
      detail,
      readOnly: true,
    }),
  )
  assert.match(desktop, /Download/)
  assert.match(desktop, /AssetNotAvailableLocally/)
  assert.doesNotMatch(desktop, /Open source handoff in Process/)
  assert.doesNotMatch(phone, /href="\/api\/library\/assets\/asset-1\/download"/)
})

test('Library root selects the first loaded record without claiming its detail', () => {
  const view = projectFixture('fresh').library
  const query = Schema.decodeUnknownSync(LibraryQuery)({
    queryId: 'nightbook',
    pageSize: 40,
    sort: 'capturedAtDescending',
  })
  const page = Schema.decodeUnknownSync(LibraryPage)({
    queryId: 'nightbook',
    querySnapshotVersion: 1,
    results: [
      {
        assetId: 'asset-first',
        revision: 1,
        role: 'original',
        format: 'fits',
        availability: 'availableLocally',
        comparisonGroupId: 'm27',
      },
      {
        assetId: 'asset-second',
        revision: 1,
        role: 'final',
        format: 'fits',
        availability: 'published',
        comparisonGroupId: 'm27',
      },
    ],
    catalogChanged: false,
  })
  const link = (route: ReturnType<typeof parseRoute>) => {
    if (route.kind === 'not-found') assert.fail('Expected a workspace route')
    return { href: routePath(route), onClick: () => undefined }
  }
  const markup = renderToStaticMarkup(
    createElement(LibraryView, {
      view,
      assetId: undefined,
      link,
      page: {
        query,
        value: page,
      },
    }),
  )
  assert.match(
    markup,
    /data-selected="true"[^>]*href="\/library\/assets\/asset-first"/,
  )
  assert.match(
    markup,
    /data-selected="false"[^>]*href="\/library\/assets\/asset-second"/,
  )
  assert.match(markup, /Select an asset to open detail\./)
  assert.doesNotMatch(markup, /aria-current="page"/)
  assert.doesNotMatch(markup, /Loading asset detail\./)
})

test('Library loading state omits records from the previous page', () => {
  const view = projectFixture('fresh').library
  const query = Schema.decodeUnknownSync(LibraryQuery)({
    queryId: 'nightbook',
    pageSize: 40,
    sort: 'recentlyUpdated',
  })
  const markup = renderToStaticMarkup(
    createElement(LibraryView, {
      view,
      assetId: undefined,
      link: (route) => ({ href: routePath(route), onClick: () => undefined }),
      page: {
        query,
        message: 'Loading Library records.',
      },
    }),
  )
  assert.match(markup, /Loading Library records\./)
  assert.doesNotMatch(markup, /M31 luminance original/)
})
