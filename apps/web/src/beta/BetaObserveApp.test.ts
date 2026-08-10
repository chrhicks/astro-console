import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import {
  BootstrapSnapshot,
  bootstrapFixtures,
} from '@astro-console/v2-contracts'
import { Schema } from 'effect'
import { renderToStaticMarkup } from 'react-dom/server'
import { BootstrapClientState } from '../bootstrap-client'
import { projectBootstrapState } from '../bootstrap-projection'
import { unavailableProjection } from '../future-adapter'
import { PreflightRefreshSubmission } from '../preflight-refresh-client'
import {
  BetaObserveApp,
  BetaObservePhone,
  projectedTakeControlAction,
} from './BetaObserveApp'

const preflightProjection = () =>
  projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
        ...bootstrapFixtures.activeRun,
        observe: {
          runId: 'run-beta-preflight',
          revision: 4,
          executor: 'fixture',
          phase: 'preflight',
          target: 'M27',
          currentSequence: 0,
          completedSequences: 0,
          totalSequences: 2,
          retryUsed: false,
          lifecycleFacts: ['Fixture preflight lifecycle started.'],
          attemptFacts: ['No provider facts read yet.'],
          actions: {
            refreshPreflight: { _tag: 'Eligible' },
            pause: { _tag: 'Eligible' },
            resume: { _tag: 'Ineligible', reason: 'pausedRunRequired' },
            stop: { _tag: 'Eligible' },
            skip: { _tag: 'Eligible' },
            retry: { _tag: 'Eligible' },
            park: { _tag: 'Eligible' },
          },
        },
      }),
    }),
  )

test('uses only the service-projected Take control action in owner view mode', () => {
  const ownerView = projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
        bootstrapFixtures.noRun,
      ),
    }),
  )
  const phoneView = projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
        bootstrapFixtures.phone,
      ),
    }),
  )
  assert.equal(ownerView.shell.readOnly, true)
  assert.deepEqual(projectedTakeControlAction(ownerView.shell), {
    kind: 'take',
    label: 'Take control',
  })
  assert.equal(projectedTakeControlAction(phoneView.shell), undefined)
  assert.equal(
    projectedTakeControlAction(unavailableProjection.shell),
    undefined,
  )
})

const targetSnapshot = (
  acquire: unknown,
  phase: 'acquire' | 'capture' = 'acquire',
) =>
  Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.activeRun,
    observe: {
      runId: 'run-beta-target',
      revision: 7,
      executor: 'fixture',
      phase,
      target: 'M27 Dumbbell Nebula',
      currentSequence: 0,
      completedSequences: 0,
      totalSequences: 1,
      retryUsed: false,
      acquire,
      lifecycleFacts: ['Target acquisition is current.'],
      attemptFacts: ['Typed Acquire evidence is current.'],
      actions: {
        pause: { _tag: 'Ineligible', reason: 'policyUnavailable' },
        resume: { _tag: 'Ineligible', reason: 'policyUnavailable' },
        stop: { _tag: 'Eligible' },
        skip: { _tag: 'Ineligible', reason: 'policyUnavailable' },
        retry: { _tag: 'Ineligible', reason: 'policyUnavailable' },
        park: { _tag: 'Eligible' },
      },
    },
  })

const targetProjection = (
  acquire: unknown,
  phase: 'acquire' | 'capture' = 'acquire',
) =>
  projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: targetSnapshot(acquire, phase),
    }),
  )

const solvingAcquire = {
  revision: 1,
  mode: 'pointing',
  acquisitionMethod: 'deepSkyPlateSolve',
  phase: 'solving',
  recoverySeries: 0,
  attemptCount: 0,
  correctionAttemptsRemaining: 3,
  activeAttemptId: 'target-solve-1',
  attention: 'Capture and plate-solve a fresh target frame.',
  actions: [{ _tag: 'Available', action: 'CaptureTargetAcquisitionEvidence' }],
}

const recoveryAcquire = {
  revision: 4,
  mode: 'pointing',
  acquisitionMethod: 'deepSkyPlateSolve',
  phase: 'paused',
  recoverySeries: 0,
  attemptCount: 2,
  correctionAttemptsRemaining: 2,
  latestEvidence: {
    _tag: 'NoSolution',
    attemptId: 'target-solve-2',
    sourceFrameAssetId: 'target-frame-2',
    category: 'stars-insufficient',
    diagnosticRef: 'target-diagnostic-2',
  },
  recovery: {
    remainingAttempts: 0,
    remainingRecoverySeries: 1,
    priorVerifiedState: 'unverified',
    reconciliation:
      'No verified pointing result is available; rejected or unverified work stays separate.',
  },
  attention:
    'Acquire is paused after bounded work. Choose one recovery action.',
  actions: [
    { _tag: 'Available', action: 'RetryPlateSolveWithParameters' },
    { _tag: 'Available', action: 'SkipAcquireTarget' },
    { _tag: 'Available', action: 'AbortAcquire' },
  ],
}

test('renders truthful loading and unavailable evidence without inert content', () => {
  const loading = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection: unavailableProjection,
      loading: true,
    }),
  )
  assert.match(loading, /Loading projection/)
  assert.match(loading, /aria-busy="true"/)

  const unavailable = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection: unavailableProjection,
      loading: false,
    }),
  )
  assert.match(unavailable, /No authoritative run evidence/)
  assert.match(unavailable, /Reconnect to load a complete service snapshot/)
  assert.match(unavailable, /Observe evidence details/)
  assert.match(unavailable, /Backyard observatory · beta/)
  assert.match(unavailable, /OBSERVE \/ AUTHORITATIVE LIFECYCLE/i)
  assert.match(unavailable, /Session acquire/i)
  assert.match(unavailable, /Target acquire/i)
  assert.match(unavailable, /Control · view/)
  assert.match(unavailable, /service truth unavailable/)
  assert.equal((unavailable.match(/class="beta-health-item"/g) ?? []).length, 5)
  assert.match(
    unavailable,
    /Rig: unknown\. Rig health is unknown without an authoritative projection\./,
  )
  assert.match(
    unavailable,
    /Storage: unknown\. Storage health is unknown without an authoritative projection\./,
  )
  assert.doesNotMatch(unavailable, /\sinert(?:=|\s|>)/)
  assert.doesNotMatch(unavailable, /\sstyle=/)
})

test('keeps reconnecting Observe readable and removes mutation controls', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Reconnecting({
      snapshot: targetSnapshot(recoveryAcquire, 'capture'),
      reason: 'The event stream disconnected.',
    }),
  )
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection,
      loading: false,
      targetAcquisitionCommand: async () => undefined,
      acquireRecoveryCommand: async () => undefined,
      approvePointingCorrection: async () => undefined,
    }),
  )
  assert.match(markup, /Last-confirmed/)
  assert.match(markup, /service truth unavailable/)
  assert.doesNotMatch(
    markup,
    /Retry at 15 s exposure|Skip target|Abort acquisition|Approve pointing correction/,
  )
  assert.doesNotMatch(markup, /\sinert(?:=|\s|>)/)
})

test('enables only the supplied safe preflight refresh seam', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection: preflightProjection(),
      loading: false,
      refreshPreflight: async () =>
        PreflightRefreshSubmission.Refreshed({ message: 'Refreshed.' }),
    }),
  )
  assert.match(markup, /Refresh preflight/)
  assert.match(markup, /Read-only provider refresh; no device command/)
  assert.match(markup, /Run plan · rev 4/i)
  assert.match(markup, /Verdict first · facts behind/)
  assert.doesNotMatch(markup, /<button[^>]*disabled[^>]*>Refresh preflight/)
  assert.doesNotMatch(markup, /\sstyle=/)
})

test('keeps preflight refresh disabled without current control', () => {
  const projection = preflightProjection()
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection: {
        ...projection,
        shell: { ...projection.shell, readOnly: true },
      },
      loading: false,
    }),
  )
  assert.match(markup, /Refresh preflight/)
  assert.match(markup, /Current control is required/)
  assert.match(markup, /<button[^>]*disabled[^>]*>Refresh preflight/)
  assert.doesNotMatch(markup, /\sinert(?:=|\s|>)/)
})

test('keeps pending frame retrieval in Capture without a Library handoff', () => {
  const base = preflightProjection()
  const source = base.observe.source
  assert.ok(source)
  const projection = {
    ...base,
    observe: {
      ...base.observe,
      phase: 'Capture' as const,
      source: {
        ...source,
        executor: 'real' as const,
        phase: 'capture' as const,
        lifecycleFacts: [
          'Camera completion was observed; retained intake is pending.',
        ] as const,
        attemptFacts: ['No Library asset is retained yet.'] as const,
        executorWork: [
          {
            workId: 'work-retrieve-frame-1',
            kind: 'RetrieveFrame' as const,
            state: 'pending' as const,
          },
        ],
      },
    },
  }
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, { projection, loading: false }),
  )
  assert.match(markup, /<h1>Capture<\/h1>/)
  assert.match(markup, /Retrieve Frame/)
  assert.doesNotMatch(markup, /Review captured frame in Library/)
  assert.doesNotMatch(markup, /href="\/library\/assets\//)
})

test('keeps Verify inside Capture while leading with durable executor evidence', () => {
  const base = preflightProjection()
  const source = base.observe.source
  assert.ok(source)
  const projection = {
    ...base,
    observe: {
      ...base.observe,
      phase: 'Verify' as const,
      source: {
        ...source,
        executor: 'real' as const,
        phase: 'verify' as const,
        lifecycleFacts: [
          'Camera was later observed idle after the provisional acknowledgement.',
        ] as const,
        attemptFacts: ['Captured bytes are not yet retained.'] as const,
        executorWork: [
          {
            workId: 'work-start-exposure-1',
            kind: 'StartExposure' as const,
            state: 'completed' as const,
          },
          {
            workId: 'work-retrieve-frame-1',
            kind: 'RetrieveFrame' as const,
            state: 'completed' as const,
          },
        ],
        latestCapturedAssetId: 'asset-capture-run-frame-1',
      },
    },
  }
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, { projection, loading: false }),
  )
  assert.match(markup, /<h1>Verify<\/h1>/)
  assert.match(markup, /Capture/)
  assert.doesNotMatch(markup, /<h1>Complete<\/h1>/)
  assert.ok(
    markup.indexOf('Durable executor work') < markup.indexOf('Fact 1'),
    'durable executor work should precede supporting evidence facts',
  )
  assert.match(markup, /Review captured frame in Library/)
  assert.match(
    markup,
    /href="\/library\/assets\/asset-capture-run-frame-1\?ui=beta"/,
  )
  assert.match(markup, /Retrieve Frame/)
  const phoneMarkup = renderToStaticMarkup(
    createElement(BetaObservePhone, { projection, loading: false }),
  )
  assert.match(phoneMarkup, /Review captured frame in Library/)
  assert.match(
    phoneMarkup,
    /href="\/library\/assets\/asset-capture-run-frame-1\?ui=beta"/,
  )
  assert.doesNotMatch(phoneMarkup, /<button/)
})

test('renders the real target-acquisition projection with only its advertised capture action', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection: targetProjection(solvingAcquire),
      loading: false,
      targetAcquisitionCommand: async () => undefined,
    }),
  )
  assert.match(markup, /Target-acquisition context/)
  assert.match(markup, /Current target-acquisition evidence/)
  assert.match(markup, /Acquisition attempts/)
  assert.match(markup, /Attempt 1/)
  assert.match(markup, /Capture and plate solve/)
  assert.doesNotMatch(markup, /Revise pointing correction/)
  assert.doesNotMatch(markup, /Retry at 15 s exposure/)
})

test('keeps an active Acquire retry in Target acquire when the outer run remains capture', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection: targetProjection(solvingAcquire, 'capture'),
      loading: false,
      targetAcquisitionCommand: async () => undefined,
    }),
  )
  assert.match(markup, /<h1>Target acquire<\/h1>/)
  assert.match(markup, />Target acquire<\/span><strong>50%<\/strong>/)
})

test('renders exact solved correction evidence and approval without inventing revise eligibility', () => {
  const awaitingAcquire: Record<string, unknown> = { ...solvingAcquire }
  delete awaitingAcquire.activeAttemptId
  const projection = targetProjection({
    ...awaitingAcquire,
    revision: 2,
    phase: 'awaitingApproval',
    attemptCount: 1,
    latestEvidence: {
      _tag: 'Solved',
      attemptId: 'target-solve-1',
      sourceFrameAssetId: 'target-frame-1',
      correction: {
        rightAscensionArcsec: 90,
        declinationArcsec: -12,
        convention: 'mountRaDec',
      },
      magnitudeArcsec: 90.8,
      uncertaintyArcsec: 4,
    },
    pendingProposal: {
      proposalId: 'target-proposal-1',
      correction: {
        rightAscensionArcsec: 90,
        declinationArcsec: -12,
        convention: 'mountRaDec',
      },
      expiresAtEpochMs: 1_722_729_660_000,
    },
    attention:
      'Review and approve the exact pointing correction before it is sent.',
    actions: [{ _tag: 'Available', action: 'ApprovePointingCorrection' }],
  })
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection,
      loading: false,
      approvePointingCorrection: async () => undefined,
    }),
  )
  assert.match(markup, /Acquisition metrics/)
  assert.match(markup, /90\.8″/)
  assert.match(markup, /Approve pointing correction/)
  assert.match(markup, /exact RA 90\.0″, Dec -12\.0″ correction/)
  assert.doesNotMatch(markup, /Revise pointing correction/)
})

test('renders bounded recovery evidence and only advertised safe recovery actions', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection: targetProjection(recoveryAcquire),
      loading: false,
      acquireRecoveryCommand: async () => undefined,
    }),
  )
  assert.match(markup, /Recovery evidence/)
  assert.match(markup, /<h1>Recover<\/h1>/)
  assert.match(markup, />Recover<\/span><strong>83%<\/strong>/)
  assert.match(markup, /Recovery attempts/)
  assert.match(markup, /No Solution/)
  assert.match(markup, /Bounded recovery is ready/)
  assert.match(markup, /Retry at 15 s exposure/)
  assert.match(markup, /Skip target/)
  assert.match(markup, /Abort acquisition/)
  assert.match(markup, /rejected or unverified work stays separate/)
  assert.doesNotMatch(markup, /Capture and plate solve/)
})

test('keeps aborted acquisition evidence visible as a protected Recover outcome', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection: targetProjection(
        {
          ...recoveryAcquire,
          revision: 5,
          phase: 'aborted',
          attention:
            'Acquire was aborted; no unverified target result was accepted.',
          actions: [],
        },
        'capture',
      ),
      loading: false,
    }),
  )
  assert.match(markup, /<h1>Recover<\/h1>/)
  assert.match(markup, /Acquisition aborted/)
  assert.match(markup, /no unverified target result was accepted/i)
  assert.doesNotMatch(markup, /Abort acquisition<\/button>/)
})

test('renders observed target completion without a browser completion claim', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaObserveApp, {
      projection: targetProjection({
        ...solvingAcquire,
        revision: 2,
        phase: 'completed',
        attemptCount: 1,
        latestEvidence: {
          _tag: 'Solved',
          attemptId: 'target-solve-1',
          sourceFrameAssetId: 'target-frame-1',
          correction: {
            rightAscensionArcsec: 0,
            declinationArcsec: 0,
            convention: 'mountRaDec',
          },
          magnitudeArcsec: 0,
          uncertaintyArcsec: 4,
        },
        attention:
          'Fresh solved image evidence is within the configured tolerance.',
        actions: [],
      }),
      loading: false,
    }),
  )
  assert.match(markup, /Target acquisition complete/)
  assert.match(markup, /Fresh solved image evidence/)
  assert.doesNotMatch(
    markup,
    /Approve pointing correction|Capture and plate solve/,
  )
})

test('phone is an explicit read-only evidence projection with no mutation controls', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaObservePhone, {
      projection: preflightProjection(),
      loading: false,
    }),
  )
  assert.match(markup, /Read-only phone/)
  assert.match(markup, /Current Observe evidence/)
  assert.match(
    markup,
    /Desktop workflow controls are intentionally unavailable/,
  )
  assert.doesNotMatch(markup, /<button/)
  assert.doesNotMatch(markup, /\sinert(?:=|\s|>)/)
})

test('target-acquisition phone projection keeps evidence and protection with zero mutation controls', () => {
  const projection = targetProjection(recoveryAcquire)
  const markup = renderToStaticMarkup(
    createElement(BetaObservePhone, {
      projection,
      loading: false,
    }),
  )
  assert.match(markup, /Read-only phone/)
  assert.match(markup, /Target evidence/)
  assert.match(markup, /Current target-acquisition evidence/)
  assert.match(markup, /Acquire revision/)
  assert.match(markup, /Freshness/)
  assert.match(markup, /Controller/)
  assert.doesNotMatch(markup, /<button/)
  assert.doesNotMatch(
    markup,
    /Retry at 15 s exposure|Skip target|Abort acquisition|Capture and plate solve/,
  )
})

test('pins every health control to one fixed square dimension', () => {
  const styles = readFileSync(
    new URL('./beta-observe.css', import.meta.url),
    'utf8',
  )
  const rule = styles.match(/\.beta-health-item > button\s*\{([^}]*)\}/s)?.[1]
  assert.ok(rule)
  assert.match(rule, /inline-size:\s*var\(--beta-health-control-size\)/)
  assert.match(rule, /block-size:\s*var\(--beta-health-control-size\)/)
  assert.match(rule, /min-inline-size:\s*var\(--beta-health-control-size\)/)
  assert.match(rule, /min-block-size:\s*var\(--beta-health-control-size\)/)
})

test('defines the approved target-acquire and recovery responsive geometry', () => {
  const styles = readFileSync(
    new URL('./beta-observe.css', import.meta.url),
    'utf8',
  )
  assert.match(
    styles,
    /\.beta-target-stage\[data-mode='acquire'\][^{]*\{[^}]*grid-template-columns:\s*240px minmax\(420px, 1fr\) 280px/s,
  )
  assert.match(
    styles,
    /@media \(min-width: 601px\) and \(max-width: 1120px\)[\s\S]*?\.beta-target-stage\[data-mode='acquire'\][^{]*\{[^}]*grid-template-columns:\s*240px minmax\(0, 1fr\)/,
  )
  assert.match(
    styles,
    /@media \(min-width: 601px\) and \(max-width: 780px\)[\s\S]*?\.beta-target-stage\[data-mode='acquire'\],[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  )
  assert.match(
    styles,
    /@media \(min-width: 601px\) and \(max-width: 780px\)[\s\S]*?\.beta-observe-stage\s*\{[^}]*height:\s*max-content[\s\S]*?\.beta-context-rail,\s*\.beta-evidence-panel\s*\{[^}]*height:\s*auto/,
  )
  assert.match(
    styles,
    /\.beta-target-stage\[data-mode='recover'\][^{]*\{[^}]*grid-template-columns:\s*minmax\(520px, 1fr\) 280px/s,
  )
  assert.match(
    styles,
    /@media \(min-width: 601px\) and \(max-width: 1120px\)[\s\S]*?\.beta-target-stage\[data-mode='recover'\][^{]*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 280px[\s\S]*?\.beta-target-stage\[data-mode='recover'\] > \.beta-decision-rail[^{]*\{[^}]*grid-column:\s*auto/,
  )
})
