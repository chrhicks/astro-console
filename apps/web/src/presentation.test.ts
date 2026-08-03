import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Schema } from 'effect'
import { unavailableProjection } from './future-adapter'
import { ActionResult, actionAvailability, actionResult } from './presentation'
import { parseRoute, routePath, routeWithProjection } from './routes'
import { Shell } from './Shell'
import { planDraftStatus, PlanView } from './workspaces/PlanView'
import { ProcessView } from './workspaces/ProcessView'
import { Status } from './workspaces/shared'
import { BootstrapClientState } from './bootstrap-client'
import { projectBootstrapState } from './bootstrap-projection'
import {
  bootstrapFixtures,
  BootstrapSnapshot,
  ProcessSourceHandoff,
} from '@astro-console/v2-contracts'
test('routes parse stable IDs and build escaped URLs', () => {
  assert.deepEqual(parseRoute('/library/assets/asset%2Fone'), {
    kind: 'asset',
    assetId: 'asset/one',
  })
  assert.deepEqual(parseRoute('/process/sessions/session%20one'), {
    kind: 'not-found',
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
    routeWithProjection(processSourceRoute),
    '/process?sourceAssetId=asset%2Fone',
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
      sourceAssetId: undefined,
    }),
  )
  assert.match(
    markup,
    /<h1 tabindex="-1">Interactive processing unavailable<\/h1>/,
  )
})

test('Process source handoffs resolve only from the server without Process claims', () => {
  const markup = renderToStaticMarkup(
    createElement(ProcessView, {
      sourceAssetId: 'asset-source-1',
      sourceHandoff: Schema.decodeUnknownSync(ProcessSourceHandoff)({
        sourceAssetId: 'asset-source-1',
        revision: 1,
        role: 'original',
        format: 'fits',
        availability: 'availableLocally',
        comparisonGroupId: 'group-1',
        lineage: {
          sourceAssetIds: ['asset-raw-1'],
          runId: 'run-1',
          solveAttemptId: 'solve-1',
        },
        processing: {
          availability: 'unavailable',
          currentFixtureFacts: [
            'Interactive processing is not available in this workspace.',
          ],
        },
      }),
    }),
  )
  assert.match(markup, /asset-source-1/)
  assert.match(markup, /original · fits · availableLocally/)
  assert.match(markup, /Interactive processing is not installed\./)
  assert.doesNotMatch(
    markup,
    /Build complete|Last valid image|evidence-image|group-1|Interactive processing is not available in this workspace/,
  )
})
