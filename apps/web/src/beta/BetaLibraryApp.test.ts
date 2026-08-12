import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  LibraryAssetDetail as LibraryAssetDetailSchema,
  LibraryPage as LibraryPageSchema,
  LibraryQuery as LibraryQuerySchema,
  LibraryQueryId,
} from '@astro-console/protocol'
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
  captureSetId: 'm27-night-1',
  equipment: {
    rigId: 'rig-backyard-primary',
    cameraDeviceId: 'camera-asi2600mc-pro',
  },
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
    rating: 4,
    annotation: 'Keep the centered frame.',
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
      captureSetId: detail.captureSetId,
      review: { decision: 'unreviewed', rating: 4 },
    },
    {
      assetId: 'asset-m27-002',
      revision: 1,
      role: 'original',
      format: 'fits',
      availability: 'temporarilyUnavailable',
      comparisonGroupId: 'm27-night-1',
      review: { decision: 'rejected' },
    },
  ],
  catalogChanged: false,
})

const controllerProjection = {
  ...unavailableProjection,
  shell: {
    ...unavailableProjection.shell,
    readOnly: false,
    membership: 'Owner member',
    control: { ...unavailableProjection.shell.control, readOnly: false },
  },
}

test('allows a desktop owner to select Project sources without the Control Lease', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: controllerProjection,
      loading: false,
      page: { query, value: page },
      onSelectAsset: () => undefined,
    }),
  )

  assert.match(markup, /Select frame/)
  assert.doesNotMatch(markup, /type="checkbox" disabled=""/)
  assert.match(markup, /Select at least one Asset or Capture Set/)
})

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
      onOpenProcess: () => undefined,
    }),
  )

  assert.match(markup, /frame-m27-001/)
  assert.match(markup, /Frame review modes/)
  assert.match(markup, />Review</)
  assert.match(markup, />Compare</)
  assert.match(markup, />Availability &amp; delivery</)
  assert.match(markup, /\/api\/library\/assets\/asset-m27-001\/preview/)
  assert.match(markup, /Inspection metrics/)
  assert.match(markup, /Preview controls/)
  assert.match(markup, />Accept</)
  assert.match(markup, />Reject</)
  assert.match(markup, /Frame rating/)
  assert.match(markup, /Rate 4/)
  assert.match(markup, /Durable review note/)
  assert.match(markup, /Keep the centered frame/)
  assert.match(markup, /Save review details/)
  assert.match(markup, /Open in Process/)
  assert.match(markup, /Loaded service facts/)
  assert.match(markup, /Browser-only view/)
  assert.match(markup, /Inspection metrics/)
  assert.match(markup, /Available · Not loaded/)
  assert.match(markup, /Previous/)
  assert.match(markup, /Next/)
  assert.match(markup, /href="\/library">Catalog/)
  assert.match(markup, /href="\/library\/assets\/asset-m27-002"/)
  assert.match(markup, /<dt>Rig<\/dt>/)
  assert.match(markup, /rig-backyard-primary/)
  assert.match(markup, /<dt>Camera<\/dt>/)
  assert.match(markup, /camera-asi2600mc-pro/)
  assert.match(markup, /Backyard observatory/)
  assert.match(markup, /aria-current="page">Library/)
  assert.doesNotMatch(markup, /Computed delta/)
})

test('renders a service-page catalog grouped only by projected identities', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: controllerProjection,
      loading: false,
      page: { query, value: page },
      onQuery: () => undefined,
      onSelectAsset: () => undefined,
    }),
  )

  assert.match(markup, /Library \/ Durable evidence/)
  assert.match(markup, /<h1[^>]*>Catalog<\/h1>/)
  assert.match(markup, /2 loaded records · snapshot 8/)
  assert.match(markup, /Processing Project intake/)
  assert.match(markup, /Select whole Capture Set/)
  assert.match(markup, /Select frame/)
  assert.match(markup, /Create project/)
  assert.match(markup, /does not start Calibration/)
  assert.match(markup, /Organize/)
  assert.match(markup, /Service query/)
  assert.match(markup, /<label[^>]*><span>Role<\/span>/)
  assert.match(markup, /All roles/)
  assert.match(markup, /<label[^>]*><span>Sort<\/span>/)
  assert.match(markup, /Newest first/)
  assert.match(markup, /m27-night-1/)
  assert.match(markup, /2 loaded representations/)
  assert.match(markup, /\/library\/assets\/asset-m27-001/)
  assert.match(markup, /\/library\/assets\/asset-m27-002/)
  assert.match(markup, /★ 4\/5/)
  assert.match(markup, /Unreviewed/)
  assert.match(markup, /☆ Not rated/)
  assert.match(markup, /Rejected/)
  assert.match(markup, /beta-library-catalog-availability/)
  assert.match(markup, /Temporarily Unavailable/)
  assert.match(markup, /Revision 1/)
  assert.match(
    markup,
    /Night, target, and review-status facets are not projected/,
  )
  assert.match(markup, /First loaded page/)
  assert.match(markup, /Next page/)
  assert.doesNotMatch(markup, /Captured 25 Jul|M27 target|Accepted frames/)
})

test('disables every Library intake control for a read-only shell', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: unavailableProjection,
      loading: false,
      page: { query, value: page },
      onQuery: () => undefined,
      onSelectAsset: () => undefined,
    }),
  )
  assert.match(markup, /Owner membership is required for Project intake/)
  assert.doesNotMatch(markup, /<input type="checkbox"(?! disabled)/)
  assert.match(markup, /<select class="nb-select" disabled=""/)
})

test('wraps long catalog availability and revision inside the card', () => {
  const styles = readFileSync(
    new URL('./beta-library.css', import.meta.url),
    'utf8',
  )
  const availabilityRule = styles.match(
    /\.beta-library-catalog-availability\s*\{([^}]*)\}/s,
  )?.[1]
  const availabilityTextRule = styles.match(
    /\.beta-library-catalog-availability > b,\s*\.beta-library-catalog-availability > small\s*\{([^}]*)\}/s,
  )?.[1]
  assert.ok(availabilityRule)
  assert.ok(availabilityTextRule)
  assert.match(availabilityRule, /width:\s*100%/)
  assert.match(availabilityRule, /min-width:\s*0/)
  assert.match(
    availabilityRule,
    /grid-template-columns:\s*7px minmax\(0,\s*1fr\)/,
  )
  assert.match(availabilityRule, /white-space:\s*normal/)
  assert.match(availabilityTextRule, /min-width:\s*0/)
  assert.match(availabilityTextRule, /white-space:\s*normal/)
  assert.match(availabilityTextRule, /overflow-wrap:\s*anywhere/)
})

test('renders the published fixture facts without inventing delivery progress or expiry', () => {
  const publishedDetail = Schema.decodeUnknownSync(LibraryAssetDetailSchema)({
    ...detail,
    availability: 'published',
    representations: [
      ...detail.representations,
      { label: 'Published delivery available', state: 'published' },
    ],
    actions: [
      { _tag: 'Eligible', action: 'download' },
      {
        _tag: 'Unavailable',
        action: 'openInProcess',
        reason: 'AssetNotAvailableLocally',
      },
    ],
  })
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: controllerProjection,
      loading: false,
      assetId: publishedDetail.assetId,
      page: { query, value: page },
      detail: publishedDetail,
      onSelectAsset: () => undefined,
      onOpenProcess: () => undefined,
    }),
  )

  assert.match(markup, /Published delivery available/)
  assert.match(markup, /Published delivery/)
  assert.match(markup, /Download action<\/dt><dd>Eligible/)
  assert.match(markup, /Process handoff/)
  assert.match(markup, /Unavailable · Asset Not Available Locally/)
  assert.match(markup, /Download original/)
  assert.match(markup, /No grant expiry or transfer progress is projected/)
  assert.doesNotMatch(markup, /2h|Preparing \d+%|32 MB/)
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
  assert.doesNotMatch(markup, /aria-label="Inspection metrics"/)
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
      processingProjectId: 'project-process-1',
      processingAttemptIds: ['attempt-process-1'],
      processingResultId: 'result-process-1',
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
  assert.match(markup, /<dt>Processing Project<\/dt>/)
  assert.match(markup, /project-process-1/)
  assert.match(markup, /<dt>Process output<\/dt>/)
  assert.match(markup, /output-process-1/)
  assert.match(markup, /<dt>Operations<\/dt>/)
  assert.match(markup, /operation-stretch-1/)
  assert.doesNotMatch(markup, /<dt>Run<\/dt>|<dt>Solve<\/dt>/)
})

test('phone retains exact Process output and operation lineage without controls', () => {
  const processDetail = Schema.decodeUnknownSync(LibraryAssetDetailSchema)({
    ...detail,
    lineage: {
      sourceAssetIds: ['asset-master-1'],
      processingProjectId: 'project-1',
      processingAttemptIds: ['calibration-attempt-1', 'develop-attempt-1'],
      processingResultId: 'develop-result-1',
      processingOutputId: 'develop-output-1',
      operationIds: ['calibration-attempt-1', 'develop-attempt-1'],
    },
  })
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryPhone, {
      projection: controllerProjection,
      loading: false,
      page: { query, value: page },
      detail: processDetail,
    }),
  )
  assert.match(markup, /<dt>Process output<\/dt>/)
  assert.match(markup, /develop-output-1/)
  assert.match(markup, /<dt>Operations<\/dt>/)
  assert.match(markup, /calibration-attempt-1, develop-attempt-1/)
  assert.doesNotMatch(markup, /<button/)
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
  assert.match(markup, /<dt>Rig<\/dt>/)
  assert.match(markup, /rig-backyard-primary/)
  assert.match(markup, /<dt>Camera<\/dt>/)
  assert.match(markup, /camera-asi2600mc-pro/)
  assert.match(markup, /<dt>Source<\/dt>/)
  assert.match(markup, /Inspection record/)
  assert.match(markup, /Review rating/)
  assert.match(markup, /4 \/ 5/)
  assert.match(markup, /Keep the centered frame/)
  assert.match(markup, /Comparison group/)
  assert.match(markup, /Inspection preview/)
  assert.doesNotMatch(markup, /<button/)
  assert.doesNotMatch(markup, /Preview controls/)
  assert.doesNotMatch(markup, /Inspection metrics/)
  assert.doesNotMatch(markup, /Download original/)
})

test('phone catalog is useful read-only service evidence with navigation only', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryPhone, {
      projection: controllerProjection,
      loading: false,
      page: { query, value: page },
    }),
  )

  assert.match(markup, /Read-only Library phone projection/)
  assert.match(markup, /<h1[^>]*>Catalog<\/h1>/)
  assert.match(markup, /Catalog loaded/)
  assert.match(markup, /2 loaded records/)
  assert.match(markup, /Phone Library catalog/)
  assert.match(markup, /m27-night-1/)
  assert.match(markup, /asset-m27-001/)
  assert.match(markup, /asset-m27-002/)
  assert.match(markup, /★ 4\/5/)
  assert.match(markup, /Unreviewed/)
  assert.match(markup, /☆ Not rated/)
  assert.match(markup, /Rejected/)
  assert.match(markup, /Revision 1/)
  assert.doesNotMatch(markup, /<button|<input|<select|<textarea/)
})

test('phone keeps an unavailable asset route distinct from the catalog', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryPhone, {
      projection: controllerProjection,
      loading: false,
      assetId: detail.assetId,
      detailState: 'unavailable',
      page: { query, value: page },
    }),
  )

  assert.match(markup, /<h1[^>]*>Frame review<\/h1>/)
  assert.match(markup, /Asset detail unavailable/)
  assert.match(markup, /Asset detail is unavailable/)
  assert.doesNotMatch(markup, /Phone Library catalog/)
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

test('keeps Process handoff disabled when the service marks it unavailable', () => {
  const unavailableProcess = Schema.decodeUnknownSync(LibraryAssetDetailSchema)(
    {
      ...detail,
      actions: [
        { _tag: 'Eligible', action: 'download' },
        {
          _tag: 'Unavailable',
          action: 'openInProcess',
          reason: 'AssetNotAvailableLocally',
        },
      ],
    },
  )
  const markup = renderToStaticMarkup(
    createElement(BetaLibraryApp, {
      projection: controllerProjection,
      loading: false,
      page: { query, value: page },
      detail: unavailableProcess,
      onSelectAsset: () => undefined,
      onOpenProcess: () => undefined,
    }),
  )

  assert.match(
    markup,
    /<button[^>]*disabled=""[^>]*title="Unavailable: Asset Not Available Locally"[^>]*>Open in Process →<\/button>/,
  )
  assert.match(markup, /Process handoff/)
  assert.match(markup, /Unavailable · Asset Not Available Locally/)
})

test('contains the wide review grid inside the available shell height', () => {
  const styles = readFileSync(
    new URL('./beta-library.css', import.meta.url),
    'utf8',
  )
  const wideRule = styles.match(
    /\.beta-library-review-grid\s*\{([^}]*)\}/s,
  )?.[1]
  assert.ok(wideRule)
  assert.match(wideRule, /height:\s*100%/)
  assert.match(wideRule, /min-height:\s*0/)
  assert.doesNotMatch(wideRule, /100vh/)
  assert.match(
    styles,
    /@media \(max-width: 1050px\)[\s\S]*?\.beta-library-review-grid\s*\{[^}]*height:\s*auto/,
  )
})

test('gives each desktop rating star a clear bounded hit area', () => {
  const styles = readFileSync(
    new URL('./beta-library.css', import.meta.url),
    'utf8',
  )
  const ratingButtonRule = styles.match(
    /\.beta-library-rating button\s*\{([^}]*)\}/s,
  )?.[1]
  assert.ok(ratingButtonRule)
  assert.match(ratingButtonRule, /width:\s*40px/)
  assert.match(ratingButtonRule, /min-width:\s*40px/)
  assert.match(ratingButtonRule, /height:\s*40px/)
  assert.match(ratingButtonRule, /flex:\s*0 0 40px/)
})

test('keeps both Library preview modes inside the bounded wide review row', () => {
  const styles = readFileSync(
    new URL('./beta-library.css', import.meta.url),
    'utf8',
  )
  const evidenceRule = Array.from(
    styles.matchAll(/\.beta-library-evidence\s*\{([^}]*)\}/gs),
  )
    .map((match) => match[1])
    .find((rule) => rule?.includes('height: 100%'))
  const canvasRule = styles.match(
    /\.beta-library-evidence \.nb-evidence-canvas\s*\{([^}]*)\}/s,
  )?.[1]
  assert.ok(evidenceRule)
  assert.ok(canvasRule)
  assert.match(evidenceRule, /height:\s*100%/)
  assert.match(
    evidenceRule,
    /grid-template-rows:\s*minmax\(0,\s*1fr\) auto auto/,
  )
  assert.match(canvasRule, /height:\s*100%/)
  assert.match(canvasRule, /aspect-ratio:\s*auto/)
  assert.match(
    styles,
    /\.beta-library-evidence\[data-fit='aspect'\] \.nb-evidence-canvas > img\s*\{[^}]*object-fit:\s*contain/,
  )
  assert.match(
    styles,
    /\.beta-library-evidence\[data-fit='fill'\] \.nb-evidence-canvas > img\s*\{[^}]*object-fit:\s*cover/,
  )
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
