import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ProcessingProjection,
  ProcessSourceHandoff,
} from '@astro-console/v2-contracts'
import { Schema } from 'effect'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { unavailableProjection } from '../future-adapter'
import {
  BetaProcessApp,
  ProcessCommandBar,
  ProcessPhone,
} from './BetaProcessApp'

const source = {
  _tag: 'SourceAsset' as const,
  assetId: 'asset-linear-1',
  checksum: 'sha256:linear-1',
}

const workspace = Schema.decodeUnknownSync(ProcessingProjection)({
  snapshotVersion: 8,
  eventCursor: 5,
  selectedSessionId: 'session-process-1',
  actions: [{ _tag: 'Eligible', action: 'StartProcessingSession' }],
  sessions: [
    {
      sessionId: 'session-process-1',
      revision: 4,
      lifecycle: 'active',
      phase: 'develop',
      sources: [
        {
          assetId: source.assetId,
          assetRevision: 1,
          role: 'linearMaster',
          checksum: source.checksum,
          locallyAvailable: true,
        },
      ],
      baseImage: source,
      history: [],
      historyPosition: 0,
      preview: {
        previewId: 'preview-1',
        clientPreviewSequence: 1,
        operation: 'stretch',
        toolId: 'deterministic-compatible',
        parameters: [],
        input: source,
        baseHistoryPosition: 0,
        state: 'ready',
        progress: 1,
        previewOutputId: 'preview-output-1',
      },
      assistantFindings: [],
      savedAssetIds: [],
    },
  ],
  sessionActions: [
    {
      sessionId: 'session-process-1',
      actions: [
        {
          _tag: 'Ineligible',
          action: 'ResumeProcessingSession',
          reason: 'sessionUnfinishedRequired',
        },
        { _tag: 'Eligible', action: 'SyncProcessingPreview' },
        { _tag: 'Eligible', action: 'ApplyProcessingPreview' },
        {
          _tag: 'Ineligible',
          action: 'UndoProcessingStep',
          reason: 'undoUnavailable',
        },
        {
          _tag: 'Ineligible',
          action: 'RedoProcessingStep',
          reason: 'redoUnavailable',
        },
        {
          _tag: 'Ineligible',
          action: 'RetryProcessingStep',
          reason: 'failedAttemptRequired',
        },
        {
          _tag: 'Ineligible',
          action: 'SaveProcessingArtifacts',
          reason: 'outputRequired',
        },
      ],
    },
  ],
  assets: [],
  pressure: { state: 'normal' },
})

const processControllerProjection = {
  ...unavailableProjection,
  shell: {
    ...unavailableProjection.shell,
    readOnly: true,
    freshness: 'Current bootstrap snapshot confirmed at fixture-time',
    membership: 'Owner member',
    capability: 'Control-capable client / no eligible action',
    controller: 'No active controller',
    protection: 'Read-only: no eligible action is projected for this client.',
    control: {
      ...unavailableProjection.shell.control,
      readOnly: false,
    },
  },
}

test('does not confuse absent Plan or Observe eligibility with Process read-only', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: workspace,
    }),
  )

  assert.match(markup, /Preview Stretch/)
  assert.match(markup, /<button[^>]*>Preview Stretch<\/button>/)
  assert.match(markup, /<button[^>]*>Apply exact preview<\/button>/)
  assert.match(markup, /Stretch amount/)
  assert.match(markup, /Local adapter/)
  assert.match(markup, /Control · you/)
  assert.match(markup, /This client has Process authority/)
  assert.doesNotMatch(markup, /Control · view|No active controller/)
})

test('shows the service-owned needs-review queue with evidence and blocks Build', () => {
  const empty = Schema.decodeUnknownSync(ProcessingProjection)({
    snapshotVersion: 1,
    eventCursor: 1,
    actions: [{ _tag: 'Eligible', action: 'StartProcessingSession' }],
    sessions: [],
    sessionActions: [],
    assets: [],
    pressure: { state: 'normal' },
  })
  const sourceHandoff = Schema.decodeUnknownSync(ProcessSourceHandoff)({
    sourceAssetId: 'asset-m27-001',
    revision: 1,
    role: 'original',
    format: 'cameraRaw',
    availability: 'availableLocally',
    comparisonGroupId: 'm27-stack-1',
    lineage: { sourceAssetIds: ['asset-m27-001'] },
    processing: {
      availability: 'available',
      currentFixtureFacts: ['Deterministic file-backed adapter.'],
    },
    recommendedSet: {
      candidateCount: 2,
      includedCount: 0,
      excludedCount: 0,
      needsReviewCount: 2,
      frozen: false,
      candidates: [
        {
          assetId: 'asset-m27-006',
          assetRevision: 1,
          reviewRevision: 0,
          platformDecision: 'review',
          manualDecision: 'unreviewed',
          effectiveDecision: 'needsReview',
          hardIneligible: false,
          measuredSharpness: 994,
          reason: 'Inspection evidence is unavailable; review this frame.',
        },
      ],
    },
  })
  const markup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      sourceAssetId: 'asset-m27-001',
      sourceHandoff,
      initialWorkspace: empty,
    }),
  )
  assert.match(markup, /Needs review/)
  assert.match(markup, /Review evidence for asset-m27-006/)
  assert.match(markup, /Sharpness/)
  assert.match(markup, /2 candidates/)
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Accept<\/button>/)
  assert.match(
    markup,
    /<button[^>]*disabled=""[^>]*>Build recommended set<\/button>/,
  )
})

test('protects every Process mutation when current authority is unavailable', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: unavailableProjection,
      loading: false,
      initialWorkspace: workspace,
    }),
  )

  assert.match(markup, /<button[^>]*disabled=""[^>]*>Preview Stretch<\/button>/)
  assert.match(
    markup,
    /<button[^>]*disabled=""[^>]*>Apply exact preview<\/button>/,
  )
})

test('phone Process projection contains evidence and zero mutation controls', () => {
  const bodyMarkup = renderToStaticMarkup(
    createElement(ProcessPhone, {
      projection: processControllerProjection,
      workspace,
      state: 'Current',
    }),
  )
  const shellMarkup = renderToStaticMarkup(
    createElement(ProcessCommandBar, {
      projection: processControllerProjection,
      loading: false,
      phone: true,
    }),
  )

  assert.match(shellMarkup, /Control · view/)
  assert.doesNotMatch(shellMarkup, /Control · you/)
  assert.match(bodyMarkup, /Read-only on phone/)
  assert.match(bodyMarkup, /Session summary/)
  assert.match(bodyMarkup, /A preview is ready for exact apply on desktop/)
  assert.doesNotMatch(bodyMarkup, /<button/)
  assert.doesNotMatch(bodyMarkup, /<input|<select|<textarea/)
})

test('renders restart recovery and exact denial reasons from service eligibility', () => {
  const unfinished = Schema.decodeUnknownSync(ProcessingProjection)({
    ...workspace,
    sessions: workspace.sessions.map((session) => ({
      ...session,
      revision: session.revision + 1,
      lifecycle: 'unfinished',
    })),
    sessionActions: [
      {
        sessionId: 'session-process-1',
        actions: [
          { _tag: 'Eligible', action: 'ResumeProcessingSession' },
          {
            _tag: 'Ineligible',
            action: 'SyncProcessingPreview',
            reason: 'sessionActiveRequired',
          },
          {
            _tag: 'Ineligible',
            action: 'ApplyProcessingPreview',
            reason: 'sessionActiveRequired',
          },
          {
            _tag: 'Ineligible',
            action: 'UndoProcessingStep',
            reason: 'sessionActiveRequired',
          },
          {
            _tag: 'Ineligible',
            action: 'RedoProcessingStep',
            reason: 'sessionActiveRequired',
          },
          {
            _tag: 'Ineligible',
            action: 'SaveProcessingArtifacts',
            reason: 'sessionActiveRequired',
          },
        ],
      },
    ],
  })
  const markup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: unfinished,
    }),
  )

  assert.match(markup, /<button[^>]*>Resume session<\/button>/)
  assert.match(
    markup,
    /<button[^>]*disabled=""[^>]*title="Resume the unfinished session first\."[^>]*>Preview Stretch<\/button>/,
  )
  assert.match(
    markup,
    /<button[^>]*>Preview Stretch<\/button><p class="beta-process-denial"><b>Unavailable:<\/b> Resume the unfinished session first\.<\/p>/,
  )
})
