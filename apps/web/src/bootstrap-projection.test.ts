import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bootstrapFixtures,
  BootstrapSnapshot,
} from '@astro-console/v2-contracts'
import { Schema } from 'effect'
import { BootstrapClientState } from './bootstrap-client'
import { projectBootstrapState } from './bootstrap-projection'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ObserveView } from './workspaces/ObserveView'

const snapshot = (fixture: keyof typeof bootstrapFixtures) =>
  Schema.decodeUnknownSync(BootstrapSnapshot)(bootstrapFixtures[fixture])

test('projects a fresh authoritative snapshot with distinct health facts', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('fresh') }),
  )
  assert.match(projection.shell.freshness, /^Current bootstrap snapshot/)
  assert.equal(projection.shell.membership, 'Owner member')
  assert.equal(
    projection.shell.remoteAvailability,
    'Remote viewing availability is not currently observed.',
  )
  assert.equal(
    projection.shell.attentionOwner,
    'Attention owner unavailable from bootstrap.',
  )
  assert.equal(
    projection.shell.presence,
    'This desktop is the current controller.',
  )
  assert.equal(
    projection.shell.capability,
    'Control-capable client / no eligible action',
  )
  assert.equal(projection.shell.readOnly, true)
  assert.deepEqual(
    projection.shell.health.map((fact) => [fact.label, fact.state]),
    [
      ['Service', 'healthy'],
      ['Rig', 'unknown'],
      ['Tunnel', 'unknown'],
      ['Processing', 'unknown'],
      ['Publication', 'unknown'],
      ['Storage', 'unknown'],
    ],
  )
  assert.equal(projection.plan.sequences.length, 0)
  assert.equal('action' in projection.observe, false)
})

test('shows tunnel failure as remote viewing unavailable without changing active-run truth', () => {
  const active = Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.fresh,
    activeRun: {
      _tag: 'Active',
      run: {
        runId: 'run-m27',
        target: 'M27',
        phase: 'capture',
        progress: 52,
        completedSequenceCount: 1,
        revision: 4,
      },
    },
    health: {
      ...bootstrapFixtures.fresh.health,
      tunnel: {
        state: 'unavailable',
        reason: 'Access probe failed',
        observedAt: '2026-08-05T00:00:00Z',
      },
    },
  })
  const projection = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: active }),
  )
  assert.equal(
    projection.shell.remoteAvailability,
    'Remote viewing unavailable; the local service and active run may continue.',
  )
  assert.equal(projection.shell.currentRun?.target, 'M27')
  assert.equal(projection.shell.currentRun?.phase, 'Capture')
})

test('projects server-owned Plan detail and preserves it as last-confirmed when stale', () => {
  const plan = Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.fresh,
    plan: {
      planId: 'plan-m27',
      revision: 3,
      readiness: 'readyWithLimitations',
      readinessSummary:
        'The plan is usable with the named deterministic limitations.',
      limitations: ['seq-1: horizon clearance is limited.'],
      acceptedRunDefinition: {
        id: 'definition-m27-r2',
        sourcePlanRevision: 2,
        acceptedAt: '2026-07-25T20:00:00Z',
        executor: 'fake',
      },
      sequences: [
        {
          sequenceId: 'seq-1',
          target: 'M27',
          capture: '24 × 180s · L',
          acquisition: 'Solve and center',
          stopCondition: '24 frames',
          window: {
            startsAt: '2026-07-25T21:00:00Z',
            endsAt: '2026-07-26T01:00:00Z',
            usableMinutes: 240,
            peakAltitudeDeg: 68,
            horizonClearanceDeg: 28,
          },
          estimatedMinutes: 180,
          storageForecastMb: 1200,
          horizon: 'limited',
          storage: 'available',
          viability: 'limited',
        },
      ],
    },
  })
  const current = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: plan }),
  )
  const stale = projectBootstrapState(
    BootstrapClientState.Stale({ snapshot: plan, reason: 'Disconnected.' }),
  )
  assert.equal(current.plan.readiness, 'Ready with limitations')
  assert.equal(current.plan.sequences[0]?.target, 'M27')
  assert.equal(
    current.plan.source?.acceptedRunDefinition?.sourcePlanRevision,
    2,
  )
  assert.equal(stale.plan.readiness, 'Last-confirmed Ready with limitations')
})

test('projects stale and reconnecting snapshots as last-confirmed and protected', () => {
  const stale = projectBootstrapState(
    BootstrapClientState.Stale({
      snapshot: snapshot('activeRun'),
      reason: 'The event stream disconnected.',
    }),
  )
  const reconnecting = projectBootstrapState(
    BootstrapClientState.Reconnecting({
      snapshot: snapshot('stale'),
      reason: 'A fresh snapshot is required.',
    }),
  )
  assert.match(stale.shell.currentRun?.phase ?? '', /^Last-confirmed Capture$/)
  assert.match(stale.shell.protection, /cannot be sent or replayed/)
  assert.doesNotMatch(stale.shell.freshness, /live/i)
  assert.match(reconnecting.shell.freshness, /^Reconnecting snapshot/)
  assert.match(reconnecting.shell.controller, /reconnecting/)
})

test('projects unavailable state without invented service or workspace truth', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Unavailable({ reason: 'Snapshot request failed.' }),
  )
  assert.equal(projection.shell.currentRun, undefined)
  assert.equal(projection.shell.health[0]?.state, 'unavailable')
  assert.equal(projection.observe.phase, 'Unavailable')
  assert.equal(projection.observe.detailAvailable, false)
  assert.equal(projection.library.assets.length, 0)
})

test('bootstrap projections render unavailable Observe evidence without fixture imagery or claims', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('fresh') }),
  )
  const observe = renderToStaticMarkup(
    createElement(ObserveView, { view: projection.observe }),
  )
  assert.match(observe, /Detailed evidence unavailable/)
  assert.match(
    observe,
    /Detailed Observe evidence is unavailable from bootstrap/,
  )
  assert.doesNotMatch(observe, /evidence-image/)
})

test('Observe renders fake lifecycle evidence and omits terminal controls', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
        ...bootstrapFixtures.activeRun,
        observe: {
          runId: 'run-active-001',
          revision: 2,
          executor: 'fake',
          phase: 'stopped',
          terminalOutcome: 'stopped',
          target: 'M27',
          currentSequence: 0,
          completedSequences: 0,
          totalSequences: 2,
          retryUsed: true,
          lifecycleFacts: ['Fake/fixture lifecycle fact: RunStopped.'],
          attemptFacts: ['All attempt evidence is fake/fixture only.'],
          actions: {
            pause: { _tag: 'Ineligible', reason: 'terminalRun' },
            resume: { _tag: 'Ineligible', reason: 'terminalRun' },
            stop: { _tag: 'Ineligible', reason: 'terminalRun' },
            skip: { _tag: 'Ineligible', reason: 'terminalRun' },
            retry: { _tag: 'Ineligible', reason: 'terminalRun' },
            park: { _tag: 'Ineligible', reason: 'terminalRun' },
          },
        },
      }),
    }),
  )
  const markup = renderToStaticMarkup(
    createElement(ObserveView, { view: projection.observe }),
  )
  assert.match(markup, /Current fake lifecycle evidence/)
  assert.doesNotMatch(markup, /Current verified evidence/)
  assert.doesNotMatch(markup, /<button/)
})

test('Observe promotes Polar alignment guidance and its action before fixture lifecycle detail', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: observeSnapshot(ineligibleObserveActions('activeRunRequired'), {
        observe: {
          runId: 'run-polar-001',
          revision: 2,
          executor: 'fixture',
          phase: 'acquire',
          target: 'Polar alignment',
          currentSequence: 0,
          completedSequences: 0,
          totalSequences: 1,
          retryUsed: false,
          lifecycleFacts: ['Fixture lifecycle fact: Acquire started.'],
          attemptFacts: ['Fixture provenance: deterministic measurement.'],
          acquire: {
            revision: 1,
            mode: 'polar',
            phase: 'polarGuidance',
            recoverySeries: 0,
            attemptCount: 0,
            actions: [
              {
                _tag: 'Available',
                action: 'CapturePolarAlignmentMeasurement',
              },
            ],
          },
          actions: ineligibleObserveActions('activeRunRequired'),
        },
      }),
    }),
  )
  const markup = renderToStaticMarkup(
    createElement(ObserveView, {
      view: projection.observe,
      polarCommand: async () => undefined,
    }),
  )
  assert.match(markup, /Current polar alignment evidence/)
  assert.match(markup, /Polar alignment guidance is current/)
  assert.match(
    markup,
    /Fixture provenance: measurement evidence is deterministic/,
  )
  assert.match(markup, /Manual Alt\/Az guidance/)
  assert.match(markup, /Capture polar measurement/)
  assert.match(markup, /Run lifecycle/)
  assert.ok(
    markup.indexOf('Manual Alt/Az guidance') < markup.indexOf('Run lifecycle'),
  )
  assert.doesNotMatch(markup, /Current fixture lifecycle evidence/)
})

test('projects membership and server capability independently', () => {
  const viewer = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('viewer') }),
  )
  const phone = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('phone') }),
  )
  assert.equal(viewer.shell.membership, 'Viewer member')
  assert.equal(
    viewer.shell.capability,
    'Control-capable client / no eligible action',
  )
  assert.equal(
    viewer.shell.remoteAvailability,
    'Remote viewing availability is not currently observed.',
  )
  assert.equal(
    viewer.shell.authority,
    'Viewer membership can request shared control but cannot operate until the service grants its lease.',
  )
  assert.equal(phone.shell.membership, 'Owner member')
  assert.equal(phone.shell.capability, 'Read-only client / no eligible action')
  assert.equal(
    phone.shell.remoteAvailability,
    'Remote viewing availability is not currently observed.',
  )
  assert.equal(
    phone.shell.authority,
    'Phone clients are read-only, including the owner.',
  )
})

test('projects current controller actions and renders Manage only when eligible', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: observeSnapshot({
        pause: { _tag: 'Eligible' },
        resume: { _tag: 'Ineligible', reason: 'pausedRunRequired' },
        stop: { _tag: 'Eligible' },
        skip: { _tag: 'Eligible' },
        retry: { _tag: 'Eligible' },
        park: { _tag: 'Eligible' },
      }),
    }),
  )
  const markup = renderToStaticMarkup(
    createElement(ObserveView, { view: projection.observe }),
  )
  assert.equal(projection.shell.readOnly, false)
  assert.equal(
    projection.shell.capability,
    'Control-capable client / service-projected controls',
  )
  assert.equal(
    projection.shell.protection,
    'Controls are service-projected and current-revision guarded.',
  )
  assert.match(markup, /Manage the current fake\/fixture run/)
})

test('projects non-controller and phone Observe clients as monitoring-only', () => {
  const nonController = projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: observeSnapshot(
        ineligibleObserveActions('controlRequired'),
        {
          membership: {
            ...bootstrapFixtures.activeRun.membership,
            clientId: 'desktop-viewer',
          },
          control: {
            revision: 4,
            state: 'held',
            holderClientId: 'desktop-owner',
          },
        },
        'paused',
      ),
    }),
  )
  const phone = projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: observeSnapshot(ineligibleObserveActions('readOnlyClient'), {
        membership: bootstrapFixtures.phone.membership,
        control: bootstrapFixtures.phone.control,
      }),
    }),
  )
  const nonControllerMarkup = renderToStaticMarkup(
    createElement(ObserveView, { view: nonController.observe }),
  )
  const phoneMarkup = renderToStaticMarkup(
    createElement(ObserveView, { view: phone.observe }),
  )
  assert.equal(nonController.shell.readOnly, true)
  assert.equal(
    nonController.shell.capability,
    'Control-capable client / no eligible action',
  )
  assert.match(nonControllerMarkup, /Monitor the current fake\/fixture run/)
  assert.match(nonControllerMarkup, /Another client holds control/)
  assert.doesNotMatch(
    nonControllerMarkup,
    /Manage the current fake\/fixture run/,
  )
  assert.equal(phone.shell.readOnly, true)
  assert.equal(phone.shell.capability, 'Read-only client / no eligible action')
  assert.match(phoneMarkup, /No action is currently eligible. Monitor/)
})

test('keeps stale eligible controls protected and finds Plan-only eligible actions', () => {
  const eligibleObserve = observeSnapshot({
    pause: { _tag: 'Eligible' },
    resume: { _tag: 'Ineligible', reason: 'pausedRunRequired' },
    stop: { _tag: 'Eligible' },
    skip: { _tag: 'Eligible' },
    retry: { _tag: 'Eligible' },
    park: { _tag: 'Eligible' },
  })
  const stale = projectBootstrapState(
    BootstrapClientState.Stale({
      snapshot: eligibleObserve,
      reason: 'Disconnected.',
    }),
  )
  const planOnly = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: planActionSnapshot() }),
  )
  assert.equal(stale.shell.readOnly, true)
  assert.equal(
    stale.shell.capability,
    'Control-capable client / controls protected until current',
  )
  assert.match(stale.shell.protection, /cannot be sent or replayed/)
  assert.equal(planOnly.shell.readOnly, false)
  assert.equal(
    planOnly.shell.protection,
    'Controls are service-projected and current-revision guarded.',
  )
})

function observeSnapshot(
  actions: object,
  overrides: object = {},
  phase = 'capture',
) {
  return Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.activeRun,
    observe: {
      runId: 'run-active-001',
      revision: 2,
      executor: 'fake',
      phase,
      target: 'M27',
      currentSequence: 0,
      completedSequences: 0,
      totalSequences: 2,
      retryUsed: false,
      lifecycleFacts: ['Fake/fixture lifecycle fact: RunStarted.'],
      attemptFacts: ['All attempt evidence is fake/fixture only.'],
      actions,
    },
    ...overrides,
  })
}

function ineligibleObserveActions(reason: string) {
  return {
    pause: { _tag: 'Ineligible', reason },
    resume: { _tag: 'Ineligible', reason },
    stop: { _tag: 'Ineligible', reason },
    skip: { _tag: 'Ineligible', reason },
    retry: { _tag: 'Ineligible', reason },
    park: { _tag: 'Ineligible', reason },
  }
}

function planActionSnapshot() {
  return Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.fresh,
    plan: {
      planId: 'plan-m27',
      revision: 1,
      readiness: 'ready',
      readinessSummary: 'Ready to accept.',
      limitations: [],
      sequences: [
        {
          sequenceId: 'seq-1',
          target: 'M27',
          capture: '24 × 180s · L',
          acquisition: 'Solve and center',
          stopCondition: '24 frames',
          window: {
            startsAt: '2026-07-25T21:00:00Z',
            endsAt: '2026-07-26T01:00:00Z',
            usableMinutes: 240,
            peakAltitudeDeg: 68,
            horizonClearanceDeg: 28,
          },
          estimatedMinutes: 180,
          storageForecastMb: 1200,
          horizon: 'clear',
          storage: 'available',
          viability: 'viable',
        },
      ],
      actions: {
        saveDraft: { _tag: 'Ineligible', reason: 'definitionAlreadyAccepted' },
        acceptRunDefinition: { _tag: 'Eligible' },
        startAcceptedRun: {
          _tag: 'Ineligible',
          reason: 'acceptedDefinitionRequired',
        },
        previewRunMutation: {
          _tag: 'Ineligible',
          reason: 'acceptedDefinitionRequired',
        },
        applyRunMutation: { _tag: 'Ineligible', reason: 'previewRequired' },
        approveDisruptiveRunMutation: {
          _tag: 'Ineligible',
          reason: 'previewRequired',
        },
      },
    },
  })
}

test('projects active and idle run summaries without inventing workspace detail', () => {
  const active = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('activeRun') }),
  )
  const idle = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('noRun') }),
  )
  assert.deepEqual(active.shell.currentRun, {
    target: 'M27',
    phase: 'Capture',
    progress: '50% complete',
    progressValue: 50,
    progressMax: 100,
    sequenceProgress: '1 completed sequences',
    estimatedCompletion: 'Estimated completion unavailable from bootstrap.',
  })
  assert.equal(idle.shell.currentRun, undefined)
  assert.match(idle.observe.status, /active-run summary only/)
})

test('retains unknown and unavailable subsystem health distinctly', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('unavailable') }),
  )
  const facts = Object.fromEntries(
    projection.shell.health.map((fact) => [fact.label, fact]),
  )
  assert.equal(facts.Rig?.state, 'unavailable')
  assert.equal(facts.Storage?.state, 'unknown')
  assert.match(facts.Rig?.detail ?? '', /Rig adapter is unavailable/)
})
