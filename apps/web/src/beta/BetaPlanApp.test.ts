import assert from 'node:assert/strict'
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
import { BetaPlanApp, BetaPlanPhone } from './BetaPlanApp'

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

const sequences = [
  {
    sequenceId: 'sequence-one',
    target: 'M27',
    capture: '24 × 180s · L',
    acquisition: 'Solve and center.',
    stopCondition: 'Stop at 24 verified frames.',
    window: {
      startsAt: '2026-08-08T02:00:00.000Z',
      endsAt: '2026-08-08T04:00:00.000Z',
      usableMinutes: 120,
      peakAltitudeDeg: 62,
      horizonClearanceDeg: 28,
    },
    estimatedMinutes: 72,
    storageForecastMb: 1800,
    horizon: 'clear',
    storage: 'available',
    viability: 'viable',
    definition: executionDefinition('sequence-one', 'M27', 0),
  },
  {
    sequenceId: 'sequence-two',
    target: 'M33',
    capture: '18 × 180s · RGB',
    acquisition: 'Solve and center.',
    stopCondition: 'Stop at 18 verified frames.',
    window: {
      startsAt: '2026-08-08T04:00:00.000Z',
      endsAt: '2026-08-08T05:30:00.000Z',
      usableMinutes: 90,
      peakAltitudeDeg: 55,
      horizonClearanceDeg: 24,
    },
    estimatedMinutes: 54,
    storageForecastMb: 1350,
    horizon: 'clear',
    storage: 'available',
    viability: 'viable',
    definition: executionDefinition('sequence-two', 'M33', 1),
  },
] as const

const overlappingSequences = [
  sequences[0],
  {
    ...sequences[1],
    sequenceId: 'sequence-overlap',
    target: 'NGC 7000',
    definition: executionDefinition('sequence-overlap', 'NGC 7000', 1),
    window: {
      ...sequences[1].window,
      startsAt: '2026-08-08T03:00:00.000Z',
      endsAt: '2026-08-08T05:00:00.000Z',
    },
  },
  sequences[1],
] as const

const eligible = { _tag: 'Eligible' } as const
const ineligible = { _tag: 'Ineligible', reason: 'activeRunPresent' } as const

const snapshot = (
  active = false,
  planSequences: readonly (typeof overlappingSequences)[number][] = sequences,
) =>
  Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...(active ? bootstrapFixtures.activeRun : bootstrapFixtures.fresh),
    plan: {
      planId: 'plan-beta',
      revision: 3,
      readiness: 'ready',
      readinessSummary: 'All supplied planning facts are viable.',
      limitations: [],
      sequences: planSequences,
      ...(active
        ? {
            acceptedRunDefinition: {
              id: 'accepted-beta',
              sourcePlanRevision: 3,
              acceptedAt: '2026-08-08T01:00:00.000Z',
              executor: 'fake',
            },
          }
        : {}),
      actions: active
        ? {
            saveDraft: ineligible,
            acceptRunDefinition: ineligible,
            startAcceptedRun: ineligible,
            previewRunMutation: eligible,
            applyRunMutation: {
              _tag: 'Ineligible',
              reason: 'previewRequired',
            },
            approveDisruptiveRunMutation: {
              _tag: 'Ineligible',
              reason: 'previewRequired',
            },
          }
        : {
            saveDraft: eligible,
            acceptRunDefinition: eligible,
            startAcceptedRun: {
              _tag: 'Ineligible',
              reason: 'acceptedDefinitionRequired',
            },
            previewRunMutation: {
              _tag: 'Ineligible',
              reason: 'activeRunRequired',
            },
            applyRunMutation: {
              _tag: 'Ineligible',
              reason: 'previewRequired',
            },
            approveDisruptiveRunMutation: {
              _tag: 'Ineligible',
              reason: 'previewRequired',
            },
          },
    },
  })

const projection = (
  active = false,
  planSequences: readonly (typeof overlappingSequences)[number][] = sequences,
) =>
  projectBootstrapState(
    BootstrapClientState.Current({
      snapshot: snapshot(active, planSequences),
    }),
  )

test('renders the Nightbook Plan shell and real typed editor controls', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaPlanApp, {
      projection: projection(),
      loading: false,
      submit: async () => {
        throw new Error('not used')
      },
    }),
  )
  assert.match(markup, /Plan the next accepted run/)
  assert.match(markup, /Night editor/)
  assert.match(markup, /type="datetime-local"/)
  assert.match(markup, /type="number"/)
  assert.match(markup, /Save draft/)
  assert.match(markup, /Accept run definition/)
  assert.match(markup, /href="\/plan\?ui=beta" aria-current="page"/)
})

test('renders active accepted state without exposing draft save', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaPlanApp, {
      projection: projection(true),
      loading: false,
    }),
  )
  assert.match(markup, /Accepted run and staged future/)
  assert.match(markup, /Observing now/)
  assert.match(markup, /Read only/)
  assert.doesNotMatch(markup, />Accept run definition<\/button>/)
})

test('renders overlapping schedule intervals on deterministic separate lanes', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaPlanApp, {
      projection: projection(false, overlappingSequences),
      loading: false,
    }),
  )
  assert.match(markup, /data-sequence-id="sequence-one" data-lane="0"/)
  assert.match(markup, /data-sequence-id="sequence-overlap" data-lane="1"/)
  assert.match(markup, /--timeline-left:28\.571/)
  assert.match(markup, /--timeline-width:57\.142/)
})

test('keeps stale Plan evidence visible while removing all mutation actions', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaPlanApp, {
      projection: projectBootstrapState(
        BootstrapClientState.Stale({
          snapshot: snapshot(true),
          reason: 'The event stream disconnected.',
        }),
      ),
      loading: false,
    }),
  )
  assert.match(markup, /Accepted run and staged future/)
  assert.match(markup, /Read only/)
  assert.match(markup, /Last-confirmed/)
  assert.match(markup, /disabled="">Preview shorter second sequence<\/button>/)
  assert.doesNotMatch(markup, />Accept run definition<\/button>/)
})

test('phone Plan projection contains no mutation controls', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaPlanPhone, {
      projection: projection(true),
      loading: false,
    }),
  )
  assert.match(markup, /Read-only phone Plan projection/)
  assert.match(markup, /Plan mutations are intentionally unavailable/)
  assert.match(markup, /Accepted/)
  assert.doesNotMatch(markup, /<button/)
  assert.doesNotMatch(markup, /<input/)
})

test('renders unavailable Plan truthfully', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaPlanApp, {
      projection: unavailableProjection,
      loading: false,
    }),
  )
  assert.match(markup, /Plan unavailable/)
  assert.match(markup, /No plan projection/)
  assert.doesNotMatch(markup, /Save draft/)
})
