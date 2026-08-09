import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Schema } from 'effect'
import { unavailableProjection } from './future-adapter'
import { ActionResult, actionAvailability, actionResult } from './presentation'
import { parseRoute, routePath, routeWithProjection } from './routes'
import { Shell } from './Shell'
import {
  formatDurationMinutes,
  formatStorage,
  formatTimeUTC,
  formatWindowRange,
  nightLabel,
  planDraftStatus,
  PlanView,
  planTimeline,
  skyArcs,
} from './workspaces/PlanView'
import type { PlanSequenceView } from './presentation'
import { ProcessView } from './workspaces/ProcessView'
import { Status } from './workspaces/shared'
import { ObserveView } from './workspaces/ObserveView'
import { BootstrapClientState } from './bootstrap-client'
import { projectBootstrapState } from './bootstrap-projection'
import {
  bootstrapFixtures,
  BootstrapSnapshot,
  ProcessSourceHandoff,
  ObserveWorkspaceProjection,
} from '@astro-console/v2-contracts'

const executionDefinition = (
  sequenceId: string,
  targetName: string,
  priority: number,
) => ({
  sequenceId,
  targetName,
  acquisitionMode: 'deepSkyPlateSolve' as const,
  rightAscensionHours: 19.9934,
  declinationDegrees: 22.7212,
  exposureSeconds: 180,
  frameCount: 1,
  binning: 1,
  minimumAltitudeDegrees: 25,
  horizonClearanceDegrees: 5,
  recenterThresholdArcsec: 30,
  maxSolveAttempts: 3,
  maxCaptureRetries: 2,
  acquireFailure: 'pause' as const,
  captureFailure: 'retry' as const,
  estimatedDurationSeconds: 180,
  estimatedStorageBytes: 50_000_000,
  priority,
})

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

const planSequence = (
  overrides: Partial<PlanSequenceView> = {},
): PlanSequenceView => ({
  id: 'seq-1',
  target: 'M27',
  capture: '24 × 180s · L',
  acquisition: 'Solve, center, focus, then start capture.',
  stopCondition: 'Stop at 24 verified frames or 01:02 local.',
  windowStart: '2026-07-25T03:18:00.000Z',
  windowEnd: '2026-07-25T05:02:00.000Z',
  usableMinutes: 104,
  estimatedMinutes: 72,
  storageForecastMb: 1800,
  peakAltitudeDeg: 62,
  horizonClearanceDeg: 28,
  horizon: 'clear',
  storage: 'available',
  viability: 'viable',
  ...overrides,
})

test('Plan formats observing-window facts for people, not machines', () => {
  assert.equal(formatTimeUTC('2026-07-25T03:18:00.000Z'), '03:18')
  assert.equal(
    formatWindowRange('2026-07-25T03:18:00.000Z', '2026-07-25T05:02:00.000Z'),
    '25 Jul · 03:18 – 05:02 UTC',
  )
  assert.equal(
    formatWindowRange('2026-07-25T21:00:00Z', '2026-07-26T01:00:00Z'),
    '25 Jul 21:00 – 26 Jul 01:00 UTC',
  )
  assert.equal(formatDurationMinutes(45), '45 m')
  assert.equal(formatDurationMinutes(72), '1 h 12 m')
  assert.equal(formatDurationMinutes(104), '1 h 44 m')
  assert.equal(formatStorage(800), '800 MB')
  assert.equal(formatStorage(1800), '1.8 GB')
})

test('Plan derives night label and timeline bounds from sequence windows', () => {
  assert.equal(nightLabel([planSequence()]), 'Plan night · 25 July 2026')
  assert.equal(
    nightLabel([
      planSequence({
        windowStart: '2026-07-25T21:00:00Z',
        windowEnd: '2026-07-26T01:00:00Z',
      }),
    ]),
    'Plan window · 25 – 26 July 2026',
  )
  const timeline = planTimeline([
    planSequence(),
    planSequence({
      id: 'seq-2',
      windowStart: '2026-07-25T04:18:00.000Z',
      windowEnd: '2026-07-25T06:02:00.000Z',
    }),
  ])
  assert.equal(timeline?.startLabel, '03:18')
  assert.equal(timeline?.endLabel, '06:02 UTC')
})

test('Plan sky arcs follow distinct targets and their peak altitude', () => {
  const arcs = skyArcs([
    planSequence(),
    planSequence({ id: 'seq-2', peakAltitudeDeg: 41 }),
    planSequence({ id: 'seq-3', target: 'M31', peakAltitudeDeg: 90 }),
  ])
  assert.equal(arcs.length, 2)
  assert.equal(arcs[0]?.target, 'M27')
  assert.equal(arcs[0]?.peakAltitudeDeg, 62)
  assert.ok(arcs[1]!.height > arcs[0]!.height)
  const flat = skyArcs([planSequence({ peakAltitudeDeg: 0 })])
  const overhead = skyArcs([planSequence({ peakAltitudeDeg: 90 })])
  assert.equal(flat[0]?.height, 15)
  assert.equal(overhead[0]?.height, 65)
})

test('Plan presents formatted sequence evidence instead of raw projection strings', () => {
  const snapshot = Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.fresh,
    plan: {
      planId: 'plan-m27',
      revision: 3,
      readiness: 'readyWithLimitations',
      readinessSummary: 'The plan is usable with the named limitations.',
      limitations: ['seq-2: horizon clearance is limited.'],
      sequences: [
        {
          sequenceId: 'seq-1',
          target: 'M27',
          capture: '24 × 180s · L',
          acquisition: 'Solve, center, focus, then start capture.',
          stopCondition: 'Stop at 24 verified frames or 01:02 local.',
          window: {
            startsAt: '2026-07-25T03:18:00.000Z',
            endsAt: '2026-07-25T05:02:00.000Z',
            usableMinutes: 104,
            peakAltitudeDeg: 62,
            horizonClearanceDeg: 28,
          },
          estimatedMinutes: 72,
          storageForecastMb: 1800,
          horizon: 'clear',
          storage: 'available',
          viability: 'viable',
          definition: executionDefinition('seq-1', 'M27', 0),
        },
        {
          sequenceId: 'seq-2',
          target: 'M31',
          capture: '18 × 180s · RGB',
          acquisition: 'Continue after luminance with the same solved center.',
          stopCondition: 'Stop at 18 verified frames or window end.',
          window: {
            startsAt: '2026-07-25T04:18:00.000Z',
            endsAt: '2026-07-25T06:02:00.000Z',
            usableMinutes: 104,
            peakAltitudeDeg: 41,
            horizonClearanceDeg: 12,
          },
          estimatedMinutes: 54,
          storageForecastMb: 1350,
          horizon: 'limited',
          storage: 'available',
          viability: 'limited',
          definition: executionDefinition('seq-2', 'M31', 1),
        },
      ],
    },
  })
  const markup = renderToStaticMarkup(
    createElement(PlanView, {
      view: projectBootstrapState(BootstrapClientState.Current({ snapshot }))
        .plan,
    }),
  )
  assert.match(markup, /Plan night · 25 July 2026/)
  assert.doesNotMatch(markup, /T0[3456]:(18|02):00\.000Z/)
  assert.match(markup, /25 Jul · 03:18 – 05:02 UTC/)
  assert.match(markup, /1 h 44 m/)
  assert.match(markup, /1 h 12 m/)
  assert.match(markup, /1\.8 GB/)
  assert.match(markup, /Clear<\/span> · 28° clearance/)
  assert.match(markup, />Viable</)
  assert.match(markup, /Solve, center, focus, then start capture\./)
  assert.match(markup, /Stop at 24 verified frames or 01:02 local\./)
  assert.match(markup, /peaks 62°/)
  assert.match(markup, />03:18</)
  assert.match(markup, />06:02 UTC</)
  assert.match(markup, /18 × 180s · RGB/)
  assert.match(
    markup,
    /· <span class="fact-tone fact-tone--attention">Limited<\/span>/,
  )
  assert.equal(markup.match(/class="arc"/g)?.length, 2)
  assert.match(
    markup,
    /data-tone="attention" role="status">Ready with limitations/,
  )
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
          definition: executionDefinition('seq-1', 'M27', 0),
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

test('Observe presents bounded recovery facts and withholds recovery actions on read-only phone', () => {
  const source = Schema.decodeUnknownSync(ObserveWorkspaceProjection)({
    runId: 'run-recovery',
    revision: 1,
    executor: 'fixture',
    phase: 'acquire',
    target: 'M27 Dumbbell Nebula',
    currentSequence: 0,
    completedSequences: 0,
    totalSequences: 1,
    retryUsed: false,
    acquire: {
      revision: 2,
      mode: 'pointing',
      acquisitionMethod: 'deepSkyPlateSolve',
      phase: 'paused',
      recoverySeries: 0,
      attemptCount: 2,
      correctionAttemptsRemaining: 2,
      recovery: {
        remainingAttempts: 0,
        remainingRecoverySeries: 1,
        priorVerifiedState: 'unverified',
        reconciliation:
          'No verified pointing result is available; rejected or unverified work stays separate.',
      },
      actions: [
        { _tag: 'Available', action: 'RetryPlateSolveWithParameters' },
        { _tag: 'Available', action: 'SkipAcquireTarget' },
        { _tag: 'Available', action: 'AbortAcquire' },
      ],
    },
    lifecycleFacts: ['Fixture recovery is paused.'],
    attemptFacts: ['No physical capture is claimed.'],
    actions: {
      pause: { _tag: 'Ineligible', reason: 'policyUnavailable' },
      resume: { _tag: 'Ineligible', reason: 'policyUnavailable' },
      stop: { _tag: 'Eligible' },
      skip: { _tag: 'Ineligible', reason: 'policyUnavailable' },
      retry: { _tag: 'Ineligible', reason: 'policyUnavailable' },
      park: { _tag: 'Eligible' },
    },
  })
  const view = {
    detailAvailable: true,
    target: 'M27 Dumbbell Nebula',
    phase: 'acquire',
    status: 'Acquire paused',
    tone: 'attention' as const,
    evidence: 'Two failed solves are retained.',
    annotation: 'Recovery needs an explicit choice.',
    heading: 'Recovery is ready',
    trace: ['No movement is requested.'],
    facts: ['Failed evidence is retained.'],
    lifecycle: ['acquire'],
    source,
  }
  const desktop = renderToStaticMarkup(
    createElement(ObserveView, {
      view,
      acquireRecoveryCommand: async () => undefined,
    }),
  )
  const phone = renderToStaticMarkup(createElement(ObserveView, { view }))
  assert.match(desktop, /Bounded recovery is ready/)
  assert.match(desktop, /Retry at 15 s exposure/)
  assert.match(desktop, /Skip target/)
  assert.match(desktop, /Abort acquisition/)
  assert.match(desktop, /rejected or unverified work stays separate/)
  assert.doesNotMatch(
    phone,
    /Retry at 15 s exposure|Skip target|Abort acquisition/,
  )
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
  assert.match(shell, /Open current run status details/)
  assert.match(shell, /Full status and service detail/)
  assert.match(shell, /Remote viewing unavailable from this client/)
  assert.match(
    shell,
    /Authority unavailable without an admitted service snapshot/,
  )
  assert.match(shell, /Capability unknown \/ mutations unavailable/)
  assert.match(shell, /Commands cannot be sent or replayed/)
  assert.match(shell, /Service availability unknown without a snapshot/)
  assert.match(shell, /Static result output remains visible/)
})

test('desktop shared-control surface exposes request resolution and takeover only from current service truth', () => {
  const owner = Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.fresh,
    control: {
      revision: 8,
      state: 'held',
      holderClientId: 'desktop-friend',
      pendingRequests: [
        {
          requestId: 'request-friend',
          personId: 'friend-ada',
          clientId: 'desktop-friend',
          expiresAt: '2026-08-02T20:10:00Z',
        },
      ],
    },
  })
  const ownerView = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: owner }),
  ).shell
  const ownerMarkup = renderToStaticMarkup(
    createElement(
      Shell,
      {
        workspace: 'observe',
        view: ownerView,
        link: (route) => ({ href: routePath(route), onClick: () => undefined }),
        result: undefined,
      },
      createElement('p', null, 'Workspace'),
    ),
  )
  assert.match(ownerMarkup, /Lease revision 8/)
  assert.match(ownerMarkup, /Desktop desktop-friend requested control/)
  assert.match(ownerMarkup, />Grant desktop-friend</)
  assert.match(ownerMarkup, />Decline desktop-friend</)
  assert.match(ownerMarkup, />Take control</)

  const phone = projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
        bootstrapFixtures.phone,
      ),
    }),
  ).shell
  const phoneMarkup = renderToStaticMarkup(
    createElement(
      Shell,
      {
        workspace: 'observe',
        view: phone,
        link: (route) => ({ href: routePath(route), onClick: () => undefined }),
        result: undefined,
      },
      createElement('p', null, 'Workspace'),
    ),
  )
  assert.match(
    phoneMarkup,
    /This client is read-only; control actions are unavailable/,
  )
  assert.doesNotMatch(
    phoneMarkup,
    /Request control|Take control|Release control/,
  )
})

test('process has a focusable screen heading', () => {
  const markup = renderToStaticMarkup(
    createElement(ProcessView, {
      sourceAssetId: undefined,
    }),
  )
  assert.match(markup, /<h1 tabindex="-1">Open a Library source<\/h1>/)
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
  assert.match(markup, /Open in Process/)
  assert.doesNotMatch(
    markup,
    /Build complete|Last valid image|evidence-image|group-1|Interactive processing is not available in this workspace/,
  )
})
