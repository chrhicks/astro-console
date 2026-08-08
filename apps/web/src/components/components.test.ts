import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ActionBar,
  AvailabilityStrip,
  EvidenceFrame,
  FactRegister,
  Panel,
  Status,
  availabilityLabel,
  availabilityTone,
  type AssetAvailability,
} from './index'

// Guardrails for the component grammar: these tests prove the invariants
// that keep workspaces from drifting — named titles, text-carried status,
// scoped destructive actions, and a fully-labeled availability lifecycle.

test('Status renders text with its tone, never color alone', () => {
  const html = renderToStaticMarkup(
    createElement(Status, { tone: 'attention', children: 'expiring' }),
  )
  assert.match(html, /data-tone="attention"/)
  assert.match(html, />expiring</)
})

test('Panel names its region with the title as accessible label', () => {
  const html = renderToStaticMarkup(
    createElement(Panel, {
      title: 'Lineage',
      note: 'identity, not paths',
      children: 'body',
    }),
  )
  assert.match(html, /aria-labelledby/)
  assert.match(html, /panel__title[^>]*>Lineage</)
  assert.match(html, /panel__note[^>]*>identity, not paths</)
})

test('FactRegister renders every fact as visible text', () => {
  const html = renderToStaticMarkup(
    createElement(FactRegister, {
      facts: [
        { label: 'Captured', value: '02:54:11Z' },
        { label: 'Checksum', value: '9f3c…a1', tone: 'safe' },
      ],
    }),
  )
  assert.match(html, /Captured/)
  assert.match(html, /02:54:11Z/)
  assert.match(html, /data-tone="safe"/)
})

test('ActionBar announces destructive scope and shows disabled reasons', () => {
  const html = renderToStaticMarkup(
    createElement(ActionBar, {
      summary: '2 selected',
      actions: [
        { label: 'Accept', tone: 'primary' },
        {
          label: 'Reject',
          tone: 'danger',
          scope: 'this review decision only',
        },
        {
          label: 'Download',
          disabled: true,
          disabledReason: 'asset not published',
        },
      ],
      note: 'originals are never touched',
    }),
  )
  assert.match(html, /aria-label="Reject — this review decision only"/)
  assert.match(html, /asset not published/)
  assert.match(html, /originals are never touched/)
  // one dominant action: exactly one primary button
  assert.equal(html.match(/action-bar__action--primary/g)?.length, 1)
})

test('AvailabilityStrip covers every contract state with label and tone', () => {
  const states: readonly AssetAvailability[] = [
    'availableLocally',
    'preparing',
    'published',
    'expiring',
    'expired',
    'republishing',
    'temporarilyUnavailable',
    'failedPublication',
  ]
  for (const state of states) {
    assert.ok(availabilityLabel(state).length > 0, `label for ${state}`)
    assert.ok(availabilityTone(state), `tone for ${state}`)
  }
  const html = renderToStaticMarkup(
    createElement(AvailabilityStrip, { availability: 'expiring' }),
  )
  assert.match(html, /aria-label="Availability: expiring"/)
  assert.match(html, /data-tone="attention"/)
  // the failure branches stay visible even in an ordinary state
  assert.match(html, /publication failed/)
})

test('EvidenceFrame is an accessible contained object with text facts', () => {
  const html = renderToStaticMarkup(
    createElement(EvidenceFrame, {
      label: 'Frame f-0118 preview',
      facts: ['HFR 2.1', 'drift 0.3′'],
    }),
  )
  assert.match(html, /role="img"/)
  assert.match(html, /aria-label="Frame f-0118 preview"/)
  assert.match(html, /HFR 2.1 · drift 0.3′/)
})
