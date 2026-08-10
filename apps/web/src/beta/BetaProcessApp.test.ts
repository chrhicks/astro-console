import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  projects: [],
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
  projectActions: [],
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

const projectWorkspace = Schema.decodeUnknownSync(ProcessingProjection)({
  snapshotVersion: 9,
  eventCursor: 6,
  selectedProjectId: 'project-m27',
  projects: [
    {
      projectId: 'project-m27',
      revision: 2,
      name: 'M27 multi-night',
      targetName: 'M27',
      sources: [
        {
          assetId: 'asset-m27-006',
          assetRevision: 1,
          role: 'Lights',
          suggestedRole: 'Lights',
          libraryRole: 'original',
          libraryFormat: 'cameraRaw',
          captureSetId: 'm27-night-1',
          targetName: 'M27',
          capturedAt: '2026-08-07T02:13:00.000Z',
          checksum: 'sha256:m27-006',
          availability: 'availableLocally',
          provenance: {
            runId: 'run-m27-1',
            sequenceId: 'sequence-l',
            rigId: 'rig-1',
            cameraDeviceId: 'camera-1',
            exposureSeconds: 120,
            filter: 'L',
            binning: 1,
          },
          warnings: [],
        },
      ],
      warnings: [],
      currentStage: 'Sources',
      stages: [
        {
          stage: 'Calibration',
          draft: {
            revision: 0,
            settings: [],
            overrides: [],
            undo: [],
            redo: [],
          },
          attempts: [],
          calibrationRecommendations: [],
        },
        {
          stage: 'Registration',
          draft: {
            revision: 0,
            settings: [],
            overrides: [],
            undo: [],
            redo: [],
          },
          attempts: [],
          calibrationRecommendations: [],
        },
        {
          stage: 'Stacking',
          draft: {
            revision: 0,
            settings: [],
            overrides: [],
            undo: [],
            redo: [],
          },
          attempts: [],
          calibrationRecommendations: [],
        },
      ],
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:01:00.000Z',
    },
  ],
  actions: [],
  sessions: [],
  sessionActions: [],
  projectActions: [
    {
      projectId: 'project-m27',
      actions: [
        { _tag: 'Eligible', action: 'AddProcessingProjectSources' },
        { _tag: 'Eligible', action: 'AssignProcessingSourceRole' },
      ],
    },
  ],
  assets: [],
  pressure: { state: 'normal' },
  work: [],
})

test('renders exact Processing Project Sources without automatic stage work', () => {
  const markup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: projectWorkspace,
    }),
  )
  assert.match(markup, /M27 multi-night/)
  assert.match(markup, /Processing Project stages/)
  assert.match(markup, /No Calibration work has started/)
  assert.match(markup, /asset-m27-006/)
  assert.match(markup, /Revision 1 · m27-night-1/)
  assert.match(markup, /Suggested: Lights/)
  assert.match(markup, /Add sources from Library/)
  assert.match(markup, /No Calibration, Registration, or Stacking work starts/)
  assert.doesNotMatch(markup, /Build recommended set/)
})

test('uses the service-owned project action denial for role controls', () => {
  const denied = Schema.decodeUnknownSync(ProcessingProjection)({
    ...projectWorkspace,
    projectActions: [
      {
        projectId: 'project-m27',
        actions: [
          {
            _tag: 'Ineligible',
            action: 'AssignProcessingSourceRole',
            reason: 'readOnlyClient',
          },
        ],
      },
    ],
  })
  const markup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: denied,
    }),
  )
  assert.match(markup, /control-capable desktop client is required/)
  assert.match(markup, /<select class="nb-select" disabled=""/)
  assert.match(markup, /aria-label="Processing Project stages"/)
  assert.match(
    markup,
    /<button type="button"><span[^>]*>02<\/span><div><b>Calibration<\/b>/,
  )
  assert.doesNotMatch(
    markup,
    /<button[^>]*disabled=""[^>]*>Calibration<\/button>/,
  )
})

test('phone project summary does not mix in an unrelated selected session', () => {
  const markup = renderToStaticMarkup(
    createElement(ProcessPhone, {
      workspace: projectWorkspace,
      state: 'Current',
    }),
  )
  assert.match(markup, /Processing Project/)
  assert.match(markup, /Project summary/)
  assert.match(markup, /Frozen sources/)
  assert.doesNotMatch(markup, /History|Frozen candidates|Current evidence/)
})

test('renders persistent stage drafts, retained lineage, result selection, and phone evidence', () => {
  const staged = Schema.decodeUnknownSync(ProcessingProjection)({
    ...projectWorkspace,
    projects: projectWorkspace.projects.map((project) => ({
      ...project,
      revision: 7,
      currentStage: 'Registration',
      stages: project.stages.map((stage) =>
        stage.stage !== 'Registration'
          ? stage
          : {
              ...stage,
              draft: {
                revision: 2,
                settings: [{ key: 'profile', value: 'Alternate' }],
                overrides: [],
                undo: [{ settings: [], overrides: [] }],
                redo: [],
              },
              attempts: [
                {
                  attemptId: 'stage-attempt-registration-1',
                  stage: 'Registration',
                  state: 'succeeded',
                  draftRevision: 1,
                  settings: [{ key: 'profile', value: 'Default' }],
                  toolIdentity: 'deterministic-stage-harness-v1',
                  resultKind: 'deterministicStageEvidence',
                  basedOnEarlierUpstream: true,
                  sourceRevisions: [
                    {
                      assetId: 'asset-m27-006',
                      assetRevision: 1,
                      role: 'Lights',
                    },
                  ],
                  recommendations: [],
                  overrides: [],
                  frameOutcomes: [],
                  outputs: [],
                  diagnostics: [],
                  upstreamAttemptId: 'stage-attempt-calibration-1',
                  resultId: 'stage-result-registration-1',
                  outputChecksum: 'sha256:registration-1',
                  startedAt: '2026-08-09T00:02:00.000Z',
                  completedAt: '2026-08-09T00:02:01.000Z',
                },
              ],
            },
      ),
    })),
    projectActions: [
      {
        projectId: 'project-m27',
        actions: [
          { _tag: 'Eligible', action: 'NavigateProcessingProjectStage' },
          { _tag: 'Eligible', action: 'UpdateProcessingStageDraft' },
          { _tag: 'Eligible', action: 'UndoProcessingStageDraft' },
          {
            _tag: 'Ineligible',
            action: 'RedoProcessingStageDraft',
            reason: 'draftRedoUnavailable',
          },
          {
            _tag: 'Ineligible',
            action: 'RunProcessingProjectStage',
            reason: 'upstreamResultRequired',
          },
          { _tag: 'Eligible', action: 'SelectProcessingStageResult' },
        ],
      },
    ],
  })
  const desktop = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: staged,
    }),
  )
  assert.match(desktop, /Registration retained/)
  assert.match(desktop, /Alternate/)
  assert.match(desktop, /Based on earlier source or upstream input/)
  assert.match(desktop, /Select result/)
  assert.match(desktop, /does not perform or prove astronomy processing/)

  const phone = renderToStaticMarkup(
    createElement(ProcessPhone, {
      workspace: staged,
      state: 'Current',
    }),
  )
  assert.match(phone, /All stage evidence/)
  assert.match(phone, /Earlier input lineage retained/)
  assert.match(phone, /Stage attempts/)
  assert.doesNotMatch(phone, /<button|<input|<select|<textarea/)
})

test('renders service-owned Calibration review, draft policy, outcomes, and read-only phone evidence', () => {
  const calibrated = Schema.decodeUnknownSync(ProcessingProjection)({
    ...projectWorkspace,
    projects: projectWorkspace.projects.map((project) => ({
      ...project,
      currentStage: 'Calibration',
      sources: [
        ...project.sources,
        {
          assetId: 'asset-flat-ha',
          assetRevision: 1,
          role: 'Flats',
          suggestedRole: 'Flats',
          libraryRole: 'original',
          libraryFormat: 'cameraRaw',
          capturedAt: '2026-08-07T02:13:00.000Z',
          checksum: 'sha256:flat-ha',
          availability: 'availableLocally',
          provenance: {
            runId: 'run-flat-1',
            sequenceId: 'sequence-flat',
            rigId: 'rig-1',
            cameraDeviceId: 'camera-1',
            exposureSeconds: 2,
            filter: 'Ha',
            binning: 1,
          },
          warnings: [],
        },
      ],
      stages: project.stages.map((stage) =>
        stage.stage !== 'Calibration'
          ? stage
          : {
              ...stage,
              draft: {
                revision: 2,
                settings: [
                  { key: 'operation', value: 'calibrate-and-debayer' },
                  { key: 'allowUncalibrated', value: 'true' },
                ],
                overrides: [],
                undo: [],
                redo: [],
              },
              calibrationRecommendations: [
                {
                  assetId: 'asset-flat-ha',
                  assetRevision: 1,
                  role: 'Flats',
                  decision: 'Review',
                  compatibility: 'Advisory mismatch',
                  reasons: [
                    'asset-m27-006: filter differs',
                    'Gain and temperature are not retained and were not evaluated.',
                  ],
                  matchedLightAssetIds: [],
                },
              ],
              attempts: [
                {
                  attemptId: 'stage-attempt-calibration-1',
                  stage: 'Calibration',
                  state: 'succeeded',
                  draftRevision: 1,
                  settings: [
                    { key: 'operation', value: 'calibrate-and-debayer' },
                    { key: 'allowUncalibrated', value: 'true' },
                  ],
                  toolIdentity: 'deterministic-calibration-adapter-v1',
                  resultKind: 'deterministicCalibrationEvidence',
                  basedOnEarlierUpstream: false,
                  sourceRevisions: [
                    {
                      assetId: 'asset-m27-006',
                      assetRevision: 1,
                      role: 'Lights',
                    },
                    {
                      assetId: 'asset-flat-ha',
                      assetRevision: 1,
                      role: 'Flats',
                    },
                  ],
                  recommendations: [],
                  overrides: [],
                  frameOutcomes: [
                    {
                      assetId: 'asset-m27-006',
                      assetRevision: 1,
                      outcome: 'Warning',
                      message:
                        'Calibration continued without compatible support.',
                      outputChecksum: 'sha256:cal-output',
                      diagnostic: 'ReviewSupport',
                    },
                  ],
                  outputs: [
                    {
                      sourceAssetId: 'asset-m27-006',
                      sourceAssetRevision: 1,
                      checksum: 'sha256:cal-output',
                      format: 'deterministicEvidenceJson',
                    },
                  ],
                  diagnostics: [
                    'Deterministic adapter evidence only; astronomy calibration quality is not claimed.',
                  ],
                  stageOutcome: 'Warning',
                  resultId: 'stage-result-calibration-1',
                  outputChecksum: 'sha256:attempt',
                },
              ],
              selectedAttemptId: 'stage-attempt-calibration-1',
            },
      ),
    })),
    projectActions: [
      {
        projectId: 'project-m27',
        actions: [
          { _tag: 'Eligible', action: 'NavigateProcessingProjectStage' },
          { _tag: 'Eligible', action: 'UpdateProcessingStageDraft' },
          { _tag: 'Eligible', action: 'UndoProcessingStageDraft' },
          { _tag: 'Eligible', action: 'RedoProcessingStageDraft' },
          { _tag: 'Eligible', action: 'RunProcessingProjectStage' },
          { _tag: 'Eligible', action: 'SelectProcessingStageResult' },
          {
            _tag: 'Ineligible',
            action: 'SetCalibrationUseAnyway',
            reason: 'readOnlyClient',
          },
        ],
      },
    ],
  })
  const desktop = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: calibrated,
    }),
  )
  assert.match(desktop, /Deterministic Calibration evidence/)
  assert.match(desktop, /Gain and temperature are not retained/)
  assert.match(desktop, /Allow with warning/)
  assert.match(desktop, /Require selected support/)
  assert.match(desktop, /Excluded from Calibration/)
  assert.match(desktop, /Use this Flat/)
  assert.match(desktop, /Remove from project/)
  assert.match(desktop, /This Flat does not match the Lights/)
  assert.match(desktop, /control-capable desktop client is required/)
  assert.match(desktop, /Calibration continued without compatible support/)
  assert.match(desktop, /ReviewSupport/)
  assert.match(desktop, /deterministic JSON evidence output/)

  const overridden = Schema.decodeUnknownSync(ProcessingProjection)({
    ...calibrated,
    projects: calibrated.projects.map((project) => ({
      ...project,
      stages: project.stages.map((stage) =>
        stage.stage === 'Calibration'
          ? {
              ...stage,
              draft: {
                ...stage.draft,
                overrides: [
                  { assetId: 'asset-flat-ha', decision: 'Use anyway' },
                ],
              },
            }
          : stage,
      ),
    })),
  })
  const overriddenDesktop = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: overridden,
    }),
  )
  assert.match(overriddenDesktop, /Included despite mismatch/)
  assert.match(overriddenDesktop, /Remove from project/)
  assert.doesNotMatch(overriddenDesktop, /Use this Flat/)
  assert.doesNotMatch(overriddenDesktop, /Remove override/)

  const phone = renderToStaticMarkup(
    createElement(ProcessPhone, { workspace: calibrated, state: 'Current' }),
  )
  assert.match(phone, /Calibration evidence/)
  assert.match(phone, /Advisory mismatch/)
  assert.match(phone, /deterministic-calibration-adapter-v1/)
  assert.match(phone, /Selected result/)
  assert.doesNotMatch(phone, /<button|<input|<select|<textarea/)
})

test('keeps the project stage header stable while its body owns vertical scroll', () => {
  const styles = readFileSync(new URL('./beta-process.css', import.meta.url), {
    encoding: 'utf8',
  })
  assert.match(
    styles,
    /\.beta-process-project-sources\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);[^}]*overflow:\s*hidden;/s,
  )
  assert.match(
    styles,
    /\.beta-process-project-sources \.nb-panel-body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
  )
})

test('shows the service-owned needs-review queue with evidence and blocks Build', () => {
  const empty = Schema.decodeUnknownSync(ProcessingProjection)({
    projects: [],
    snapshotVersion: 1,
    eventCursor: 1,
    actions: [{ _tag: 'Eligible', action: 'StartProcessingSession' }],
    sessions: [],
    sessionActions: [],
    projectActions: [],
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
