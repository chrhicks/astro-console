import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LibraryAssetDetail as LibraryAssetDetailSchema,
  LibraryPage as LibraryPageSchema,
  LibraryQuery as LibraryQuerySchema,
  LibraryQueryId,
} from '@astro-console/v2-contracts'
import { Schema } from 'effect'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { unavailableProjection } from '../future-adapter'
import { BetaLibraryApp, BetaLibraryPhone } from './BetaLibraryApp'

const query = LibraryQuerySchema.make({
  queryId: LibraryQueryId.make('nightbook-beta'),
  pageSize: 40,
  sort: 'capturedAtDescending',
})

const detail = Schema.decodeUnknownSync(LibraryAssetDetailSchema)({
  assetId: 'asset-m27-001',
  revision: 3,
  role: 'original',
  format: 'fits',
  availability: 'availableLocally',
  capturedAt: '2026-08-07T02:13:00.000Z',
  comparisonGroupId: 'm27-night-1',
  lineage: {
    sourceAssetIds: [],
    runId: 'run-m27-001',
    solveAttemptId: 'solve-m27-001',
    sequenceId: 'sequence-l',
    acquisitionId: 'acquire-m27-001',
  },
  capture: {
    frameId: 'frame-m27-001',
    exposureSeconds: 180,
    filter: 'L',
    binning: 1,
    frameType: 'light',
  },
  provenance: {
    source: 'alpaca-imagearray',
    checksum: 'sha256:m27-original',
  },
  inspection: {
    _tag: 'Available',
    preview: {
      format: 'png',
      checksum: 'sha256:m27-preview',
      provenance: {
        algorithm: 'deterministic-fixture-v1',
        sourceChecksum: 'sha256:m27-original',
      },
    },
    metrics: {
      clippingPercent: 1,
      framing: 'inFrame',
      sharpness: 87,
      shape: 91,
      driftArcsec: 2,
    },
    rationale: {
      decision: 'accepted',
      summary: 'The frame is sharp and remains inside the framing bound.',
    },
  },
  review: {
    revision: 2,
    decision: 'unreviewed',
    updatedAt: '2026-08-07T02:14:00.000Z',
  },
  representations: [{ label: 'Inspection preview', state: 'available' }],
  actions: [
    { _tag: 'Eligible', action: 'download' },
    { _tag: 'Eligible', action: 'openInProcess' },
  ],
})

const page = Schema.decodeUnknownSync(LibraryPageSchema)({
  queryId: query.queryId,
  querySnapshotVersion: 8,
  results: [
    {
      assetId: detail.assetId,
      revision: detail.revision,
      role: detail.role,
      format: detail.format,
      availability: detail.availability,
      comparisonGroupId: detail.comparisonGroupId,
    },
    {
      assetId: 'asset-m27-002',
      revision: 1,
      role: 'original',
      format: 'fits',
      availability: 'temporarilyUnavailable',
      comparisonGroupId: 'm27-night-1',
    },
  ],
  catalogChanged: false,
})

const controllerProjection = {
  ...unavailableProjection,
  shell: { ...unavailableProjection.shell, readOnly: false },
}

test('renders one real frame-review task from Library contracts', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: controllerProjection,
      loading: false,
      assetId: detail.assetId,
      page: { query, value: page },
      detail,
      onSelectAsset: () => undefined,
      onReview: async () => undefined,
    }),
  )

  assert.match(markup, /frame-m27-001/)
  assert.match(markup, /Frame review modes/)
  assert.match(markup, />Review</)
  assert.match(markup, />Availability</)
  assert.match(markup, /\/api\/library\/assets\/asset-m27-001\/preview/)
  assert.match(markup, /Inspection metrics/)
  assert.match(markup, /Preview controls/)
  assert.match(markup, />Accept</)
  assert.match(markup, />Reject</)
  assert.match(markup, /Previous/)
  assert.match(markup, /Next/)
  assert.match(markup, /asset-m27-002\?ui=beta/)
  assert.match(markup, /Backyard observatory · beta/)
  assert.match(markup, /aria-current="page">Library/)
  assert.doesNotMatch(markup, /Compare/)
  assert.doesNotMatch(markup, /Rating|Annotation/)
})

test('keeps preview failure truth separate from durable asset truth', () => {
  const unavailableDetail = Schema.decodeUnknownSync(LibraryAssetDetailSchema)({
    ...detail,
    inspection: {
      _tag: 'Unavailable',
      summary: 'The retained original cannot be decoded as a preview.',
    },
  })
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: controllerProjection,
      loading: false,
      page: { query, value: page },
      detail: unavailableDetail,
      onSelectAsset: () => undefined,
      onReview: async () => undefined,
    }),
  )

  assert.match(markup, /Inspection unavailable/)
  assert.match(markup, /Download original/)
  assert.match(markup, /Stable asset/)
  assert.doesNotMatch(markup, /Inspection metrics/)
})

test('renders complete Process output lineage without invented capture lineage', () => {
  const detailWithoutCapture = { ...detail }
  delete detailWithoutCapture.capture
  delete detailWithoutCapture.provenance
  const processDetail = Schema.decodeUnknownSync(LibraryAssetDetailSchema)({
    ...detailWithoutCapture,
    assetId: 'asset-process-00000000-0000-0000-0000-000000000001',
    role: 'final',
    format: 'tiff',
    checksum: 'sha256:process-output',
    lineage: {
      sourceAssetIds: ['asset-m27-001'],
      processingSessionId: 'session-process-1',
      processingOutputId: 'output-process-1',
      operationIds: ['operation-stretch-1'],
    },
  })
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: controllerProjection,
      loading: false,
      page: { query, value: page },
      detail: processDetail,
      onSelectAsset: () => undefined,
    }),
  )

  assert.match(markup, /<dt>Checksum<\/dt>/)
  assert.match(markup, /<dt>Process session<\/dt>/)
  assert.match(markup, /session-process-1/)
  assert.match(markup, /<dt>Process output<\/dt>/)
  assert.match(markup, /output-process-1/)
  assert.doesNotMatch(markup, /<dt>Run<\/dt>|<dt>Solve<\/dt>/)
})

test('phone is evidence, availability, and lineage without mutation controls', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryPhone, {
      projection: controllerProjection,
      loading: false,
      page: { query, value: page },
      detail,
    }),
  )

  assert.match(markup, /Read-only Library phone projection/)
  assert.match(markup, /Read-only on phone/)
  assert.match(markup, /Phone asset evidence and availability/)
  assert.match(markup, /<dt>Run<\/dt>/)
  assert.match(markup, /<dt>Source<\/dt>/)
  assert.match(markup, /Inspection record/)
  assert.doesNotMatch(markup, /<button/)
  assert.doesNotMatch(markup, /Preview controls/)
  assert.doesNotMatch(markup, /Inspection metrics/)
  assert.doesNotMatch(markup, /Download original/)
})

test('does not expose a review action without current asset detail', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: controllerProjection,
      loading: false,
      page: { query, value: page },
      detailState: 'unavailable',
      onSelectAsset: () => undefined,
    }),
  )

  assert.match(markup, /Asset detail is unavailable/)
  assert.match(markup, /No review action is available/)
  assert.doesNotMatch(markup, />Accept</)
  assert.doesNotMatch(markup, />Reject</)
})

test('keeps desktop review controls disabled for a read-only or stale projection', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: unavailableProjection,
      loading: false,
      page: { query, value: page },
      detail,
      onSelectAsset: () => undefined,
    }),
  )

  assert.match(markup, /Review · viewer/)
  assert.match(markup, /Desktop control is required/)
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Accept<\/button>/)
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Reject<\/button>/)
})

test('names loading and not-found detail states without exposing review actions', () => {
  for (const [detailState, expected] of [
    ['loading', 'Loading the selected asset.'],
    ['not-found', 'The selected asset was not found.'],
  ] as const) {
    const markup = renderToStaticMarkup(
      createElement(BetaLibraryApp, {
        projection: controllerProjection,
        loading: detailState === 'loading',
        page: { query, value: page },
        detailState,
        onSelectAsset: () => undefined,
      }),
    )
    assert.match(markup, new RegExp(expected.replace('.', '\\.')))
    assert.doesNotMatch(markup, />Accept</)
    assert.doesNotMatch(markup, />Reject</)
  }
})
