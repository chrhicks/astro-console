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
import { ProcessView } from './workspaces/ProcessView'

const snapshot = (fixture: keyof typeof bootstrapFixtures) =>
  Schema.decodeUnknownSync(BootstrapSnapshot)(bootstrapFixtures[fixture])

test('projects a fresh authoritative snapshot with distinct health facts', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('fresh') }),
  )
  assert.match(projection.shell.freshness, /^Current bootstrap snapshot/)
  assert.equal(projection.shell.membership, 'Owner member')
  assert.equal(
    projection.shell.attentionOwner,
    'Attention owner unavailable from bootstrap.',
  )
  assert.equal(
    projection.shell.presence,
    'Presence unavailable from bootstrap.',
  )
  assert.equal(
    projection.shell.capability,
    'Control-capable client / commands unavailable from bootstrap',
  )
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
  assert.match(stale.shell.phase, /^Last-confirmed Capture$/)
  assert.match(stale.shell.protection, /cannot be sent or replayed/)
  assert.doesNotMatch(stale.shell.freshness, /live/i)
  assert.match(reconnecting.shell.freshness, /^Reconnecting snapshot/)
  assert.match(reconnecting.shell.controller, /reconnecting/)
})

test('projects unavailable state without invented service or workspace truth', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Unavailable({ reason: 'Snapshot request failed.' }),
  )
  assert.equal(projection.shell.activeRun, 'Active run unknown')
  assert.equal(projection.shell.health[0]?.state, 'unavailable')
  assert.equal(projection.observe.phase, 'Unavailable')
  assert.equal(projection.observe.detailAvailable, false)
  assert.equal(projection.process.detailAvailable, false)
  assert.equal(projection.library.assets.length, 0)
})

test('bootstrap projections render unavailable Observe and Process evidence without fixture imagery or claims', () => {
  const projection = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('fresh') }),
  )
  const observe = renderToStaticMarkup(
    createElement(ObserveView, { view: projection.observe }),
  )
  const process = renderToStaticMarkup(
    createElement(ProcessView, {
      view: projection.process,
      sessionId: 'session-address',
      sourceAssetId: 'source-address',
    }),
  )
  assert.match(observe, /Detailed evidence unavailable/)
  assert.match(
    observe,
    /Detailed Observe evidence is unavailable from bootstrap/,
  )
  assert.doesNotMatch(observe, /evidence-image/)
  assert.match(process, /Unresolved session address \/ session-address/)
  assert.match(process, /Unresolved source address \/ source-address/)
  assert.match(process, /Host policy and checkpoint evidence are unavailable/)
  assert.doesNotMatch(
    process,
    /Build complete|Gradient removal|Host policy healthy|Measured cause: no pressure|checkpoint preserved|Last valid image|stable handoff|evidence-image/,
  )
})

test('projects membership and server capability independently', () => {
  const viewer = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('viewer') }),
  )
  const phone = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('phone') }),
  )
  assert.equal(viewer.shell.membership, 'Viewer member')
  assert.match(viewer.shell.capability, /Control-capable client/)
  assert.equal(phone.shell.membership, 'Owner member')
  assert.equal(phone.shell.capability, 'Read-only client')
})

test('projects active and idle run summaries without inventing workspace detail', () => {
  const active = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('activeRun') }),
  )
  const idle = projectBootstrapState(
    BootstrapClientState.Current({ snapshot: snapshot('noRun') }),
  )
  assert.equal(active.shell.activeRun, 'M27 / Capture')
  assert.equal(active.shell.progress, '1% complete')
  assert.equal(active.shell.sequenceProgress, '1 completed sequences')
  assert.equal(idle.shell.activeRun, 'No active run')
  assert.equal(idle.shell.phase, 'Idle')
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
