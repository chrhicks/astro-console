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
            registrationInclusions: [],
            stackingFrameChoices: [],
            undo: [],
            redo: [],
          },
          attempts: [],
          calibrationRecommendations: [],
          stackingRecommendations: [],
        },
        {
          stage: 'Registration',
          draft: {
            revision: 0,
            settings: [],
            overrides: [],
            registrationInclusions: [],
            stackingFrameChoices: [],
            undo: [],
            redo: [],
          },
          attempts: [],
          calibrationRecommendations: [],
          stackingRecommendations: [],
        },
        {
          stage: 'Stacking',
          draft: {
            revision: 0,
            settings: [],
            overrides: [],
            registrationInclusions: [],
            stackingFrameChoices: [],
            undo: [],
            redo: [],
          },
          attempts: [],
          calibrationRecommendations: [],
          stackingRecommendations: [],
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
                settings: [
                  { key: 'referenceAssetId', value: 'auto' },
                  { key: 'alignmentModel', value: 'affine' },
                  { key: 'starDetection', value: 'balanced' },
                ],
                overrides: [],
                registrationInclusions: [],
                stackingFrameChoices: [],
                undo: [
                  {
                    settings: [],
                    overrides: [],
                    registrationInclusions: [],
                    stackingFrameChoices: [],
                  },
                ],
                redo: [],
              },
              attempts: [
                {
                  attemptId: 'stage-attempt-registration-1',
                  stage: 'Registration',
                  state: 'succeeded',
                  draftRevision: 1,
                  settings: [
                    { key: 'referenceAssetId', value: 'auto' },
                    { key: 'alignmentModel', value: 'translation' },
                    { key: 'starDetection', value: 'balanced' },
                  ],
                  toolIdentity: 'deterministic-registration-adapter-v1',
                  resultKind: 'deterministicRegistrationEvidence',
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
                  registrationInclusions: [],
                  stackingRecommendations: [],
                  stackingFrameChoices: [],
                  stackingInputAssetIds: [],
                  frameOutcomes: [],
                  outputs: [],
                  registrationTransforms: [],
                  viableAssetIds: [],
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
  assert.match(desktop, /Affine/)
  assert.match(desktop, /Based on earlier source or upstream input/)
  assert.match(desktop, /Select result/)
  assert.match(desktop, /does not claim astronomy registration quality/)

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

test('renders Registration reference, warning consequence, viable subset, and photographer-facing inclusion choice', () => {
  const registered = Schema.decodeUnknownSync(ProcessingProjection)({
    ...projectWorkspace,
    projects: projectWorkspace.projects.map((project) => ({
      ...project,
      currentStage: 'Registration',
      stages: project.stages.map((stage) => {
        if (stage.stage === 'Calibration')
          return {
            ...stage,
            attempts: [
              {
                attemptId: 'stage-attempt-calibration-registration-ui',
                stage: 'Calibration',
                state: 'succeeded',
                draftRevision: 1,
                settings: [],
                toolIdentity: 'deterministic-calibration-adapter-v1',
                resultKind: 'deterministicCalibrationEvidence',
                basedOnEarlierUpstream: false,
                sourceRevisions: [
                  {
                    assetId: 'asset-m27-006',
                    assetRevision: 1,
                    role: 'Lights',
                  },
                ],
                recommendations: [],
                overrides: [],
                registrationInclusions: [],
                stackingRecommendations: [],
                stackingFrameChoices: [],
                stackingInputAssetIds: [],
                frameOutcomes: [
                  {
                    assetId: 'asset-m27-006',
                    assetRevision: 1,
                    outcome: 'Warning',
                    message: 'Calibration retained a usable Light output.',
                    outputChecksum: 'sha256:calibrated-light',
                  },
                ],
                outputs: [
                  {
                    sourceAssetId: 'asset-m27-006',
                    sourceAssetRevision: 1,
                    checksum: 'sha256:calibrated-light',
                    format: 'deterministicEvidenceJson',
                  },
                ],
                registrationTransforms: [],
                viableAssetIds: [],
                diagnostics: [],
                resultId: 'stage-result-calibration-registration-ui',
                outputChecksum: 'sha256:calibration-attempt',
              },
            ],
            selectedAttemptId: 'stage-attempt-calibration-registration-ui',
          }
        if (stage.stage !== 'Registration') return stage
        return {
          ...stage,
          draft: {
            revision: 2,
            settings: [
              { key: 'referenceAssetId', value: 'asset-m27-006' },
              { key: 'alignmentModel', value: 'translation' },
              { key: 'starDetection', value: 'balanced' },
            ],
            overrides: [],
            registrationInclusions: [],
            stackingFrameChoices: [],
            undo: [],
            redo: [],
          },
          attempts: [
            {
              attemptId: 'stage-attempt-registration-ui',
              stage: 'Registration',
              state: 'succeeded',
              draftRevision: 1,
              settings: [{ key: 'referenceAssetId', value: 'asset-m27-006' }],
              toolIdentity: 'deterministic-registration-adapter-v1',
              resultKind: 'deterministicRegistrationEvidence',
              basedOnEarlierUpstream: false,
              sourceRevisions: [
                {
                  assetId: 'asset-m27-006',
                  assetRevision: 1,
                  role: 'Lights',
                },
              ],
              recommendations: [],
              overrides: [],
              registrationInclusions: [],
              stackingRecommendations: [],
              stackingFrameChoices: [],
              stackingInputAssetIds: [],
              frameOutcomes: [
                {
                  assetId: 'asset-m27-006',
                  assetRevision: 1,
                  outcome: 'Warning',
                  message:
                    'A usable transform was retained, but this Light stays out of the next Stack input until included.',
                  outputChecksum: 'sha256:registration-transform',
                  diagnostic: 'AlignmentNeedsReview',
                },
              ],
              outputs: [
                {
                  sourceAssetId: 'asset-m27-006',
                  sourceAssetRevision: 1,
                  checksum: 'sha256:registration-transform',
                  format: 'deterministicEvidenceJson',
                },
              ],
              registrationTransforms: [
                {
                  assetId: 'asset-m27-006',
                  assetRevision: 1,
                  referenceAssetId: 'asset-m27-006',
                  referenceAssetRevision: 1,
                  model: 'translation',
                  coefficients: [1, 0, 0, 0, 1, 0],
                  checksum: 'sha256:registration-transform',
                  usable: true,
                  diagnostic: 'AlignmentNeedsReview',
                },
              ],
              viableAssetIds: [],
              diagnostics: [
                'Deterministic transform evidence only; astronomy registration quality is not claimed.',
              ],
              stageOutcome: 'Warning',
              upstreamAttemptId: 'stage-attempt-calibration-registration-ui',
              resultId: 'stage-result-registration-ui',
              outputChecksum: 'sha256:registration-attempt',
            },
          ],
          selectedAttemptId: 'stage-attempt-registration-ui',
        }
      }),
    })),
    projectActions: [
      {
        projectId: 'project-m27',
        actions: [
          { _tag: 'Eligible', action: 'NavigateProcessingProjectStage' },
          { _tag: 'Eligible', action: 'UpdateProcessingStageDraft' },
          {
            _tag: 'Ineligible',
            action: 'UndoProcessingStageDraft',
            reason: 'draftUndoUnavailable',
          },
          {
            _tag: 'Ineligible',
            action: 'RedoProcessingStageDraft',
            reason: 'draftRedoUnavailable',
          },
          {
            _tag: 'Eligible',
            action: 'SetRegistrationFrameIncluded',
          },
          { _tag: 'Eligible', action: 'RunProcessingProjectStage' },
          { _tag: 'Eligible', action: 'SelectProcessingStageResult' },
        ],
      },
    ],
  })
  const markup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: registered,
    }),
  )
  assert.match(markup, /Selected Calibration result/)
  assert.match(markup, /Reference Light/)
  assert.match(markup, /Not selected for next Stack input/)
  assert.match(markup, /Include this Light/)
  assert.match(markup, /0 Lights selected for the next Stack input/)
  assert.match(markup, /AlignmentNeedsReview/)

  const included = Schema.decodeUnknownSync(ProcessingProjection)({
    ...registered,
    projects: registered.projects.map((project) => ({
      ...project,
      stages: project.stages.map((stage) =>
        stage.stage === 'Registration'
          ? {
              ...stage,
              draft: {
                ...stage.draft,
                registrationInclusions: [
                  {
                    assetId: 'asset-m27-006',
                    decision: 'Include warning frame',
                  },
                ],
              },
            }
          : stage,
      ),
    })),
  })
  const includedMarkup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: included,
    }),
  )
  assert.match(includedMarkup, /Included with alignment warning/)
  assert.match(includedMarkup, /Keep out of Stack input/)
})

test('renders Stacking decisions, versioned FITS evidence, saved Master, and exact Develop handoff', () => {
  const stackAttempt = {
    attemptId: 'stage-attempt-stacking-ui',
    stage: 'Stacking' as const,
    state: 'succeeded' as const,
    draftRevision: 2,
    settings: [
      { key: 'weighting', value: 'equal' },
      { key: 'rejection', value: 'winsorized-sigma' },
    ],
    toolIdentity: 'deterministic-stacking-adapter-v1' as const,
    resultKind: 'deterministicStackingEvidence' as const,
    basedOnEarlierUpstream: false,
    sourceRevisions: [
      { assetId: 'asset-m27-006', assetRevision: 1, role: 'Lights' as const },
    ],
    recommendations: [],
    overrides: [],
    registrationInclusions: [],
    stackingRecommendations: [
      {
        assetId: 'asset-m27-006',
        assetRevision: 1,
        decision: 'Review' as const,
        technicallyUsable: true,
        reasons: ['Review this usable transform before adding its signal.'],
      },
    ],
    stackingFrameChoices: [
      { assetId: 'asset-m27-006', decision: 'Include' as const },
    ],
    stackingInputAssetIds: ['asset-m27-006'],
    frameOutcomes: [
      {
        assetId: 'asset-m27-006',
        assetRevision: 1,
        outcome: 'Warning' as const,
        message:
          'This technically usable Light is included after operator review.',
      },
    ],
    outputs: [],
    registrationTransforms: [],
    viableAssetIds: [],
    stackingOutput: {
      checksum: 'sha256:stack-ui',
      format: 'fits' as const,
      includedAssetIds: ['asset-m27-006'],
      diagnostic:
        'Deterministic 1 x 1 FITS evidence; not an astronomy-quality image.',
    },
    diagnostics: [
      'Deterministic FITS evidence only; astronomy stacking quality is not claimed.',
    ],
    stageOutcome: 'Warning' as const,
    upstreamAttemptId: 'stage-attempt-registration-ui',
    resultId: 'stage-result-stacking-ui',
    outputChecksum: 'sha256:stack-ui',
  }
  const stacking = Schema.decodeUnknownSync(ProcessingProjection)({
    ...projectWorkspace,
    projects: projectWorkspace.projects.map((project) => ({
      ...project,
      currentStage: 'Stacking',
      stages: project.stages.map((stage) =>
        stage.stage === 'Registration'
          ? {
              ...stage,
              selectedAttemptId: 'stage-attempt-registration-ui',
              attempts: [
                {
                  ...stackAttempt,
                  attemptId: 'stage-attempt-registration-ui',
                  stage: 'Registration',
                  toolIdentity: 'deterministic-registration-adapter-v1',
                  resultKind: 'deterministicRegistrationEvidence',
                  upstreamAttemptId: 'stage-attempt-calibration-ui',
                  stackingRecommendations: [],
                  stackingFrameChoices: [],
                  stackingInputAssetIds: [],
                  frameOutcomes: [],
                  registrationTransforms: [
                    {
                      assetId: 'asset-m27-006',
                      assetRevision: 1,
                      referenceAssetId: 'asset-m27-006',
                      referenceAssetRevision: 1,
                      model: 'translation',
                      coefficients: [1, 0, 0, 0, 1, 0],
                      checksum: 'sha256:transform-ui',
                      usable: true,
                    },
                  ],
                  viableAssetIds: ['asset-m27-006'],
                },
              ],
            }
          : stage.stage === 'Stacking'
            ? {
                ...stage,
                draft: {
                  revision: 2,
                  settings: stackAttempt.settings,
                  overrides: [],
                  registrationInclusions: [],
                  stackingFrameChoices: stackAttempt.stackingFrameChoices,
                  undo: [],
                  redo: [],
                },
                stackingRecommendations: stackAttempt.stackingRecommendations,
                selectedAttemptId: stackAttempt.attemptId,
                attempts: [stackAttempt],
              }
            : stage,
      ),
    })),
    projectActions: [
      {
        projectId: 'project-m27',
        actions: [
          { _tag: 'Eligible', action: 'NavigateProcessingProjectStage' },
          { _tag: 'Eligible', action: 'UpdateProcessingStageDraft' },
          { _tag: 'Eligible', action: 'SetStackingFrameIncluded' },
          { _tag: 'Eligible', action: 'RunProcessingProjectStage' },
          { _tag: 'Eligible', action: 'SelectProcessingStageResult' },
          { _tag: 'Eligible', action: 'SaveProcessingProjectMaster' },
        ],
      },
    ],
  })
  const stackMarkup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: stacking,
    }),
  )
  assert.match(stackMarkup, /Selected Registration result/)
  assert.match(stackMarkup, /Included after review/)
  assert.match(stackMarkup, /Exclude this Light/)
  assert.match(stackMarkup, /Frame weighting/)
  assert.match(stackMarkup, /FITS Master evidence/)

  const saved = Schema.decodeUnknownSync(ProcessingProjection)({
    ...stacking,
    projects: stacking.projects.map((project) => ({
      ...project,
      currentStage: 'Master',
      stages: project.stages.map((stage) =>
        stage.stage !== 'Stacking'
          ? stage
          : {
              ...stage,
              attempts: stage.attempts.map((attempt) => ({
                ...attempt,
                savedMaster: {
                  assetId: 'asset-master-ui',
                  assetRevision: 1,
                  checksum: 'sha256:stack-ui',
                  projectId: project.projectId,
                  registrationAttemptId: 'stage-attempt-registration-ui',
                  stackingAttemptId: attempt.attemptId,
                  stackResultId: 'stage-result-stacking-ui',
                  savedAt: '2026-08-10T18:00:00.000Z',
                },
              })),
            },
      ),
    })),
    projectActions: [
      {
        projectId: 'project-m27',
        actions: [
          { _tag: 'Eligible', action: 'NavigateProcessingProjectStage' },
          { _tag: 'Eligible', action: 'OpenProcessingProjectDevelop' },
        ],
      },
    ],
  })
  const masterMarkup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: saved,
    }),
  )
  assert.match(masterMarkup, /Saved Library Master/)
  assert.match(masterMarkup, /asset-master-ui/)
  assert.match(masterMarkup, /Open saved Master in Develop/)

  const developed = Schema.decodeUnknownSync(ProcessingProjection)({
    ...saved,
    projects: saved.projects.map((project) => ({
      ...project,
      revision: 12,
      currentStage: 'Develop',
      developMasterAssetId: 'asset-master-ui',
      develop: {
        base: {
          assetId: 'asset-master-ui',
          assetRevision: 1,
          checksum: 'sha256:stack-ui',
          stackingAttemptId: 'stage-attempt-stacking-ui',
          stackResultId: 'stage-result-stacking-ui',
        },
        draft: {
          revision: 3,
          operation: { _tag: 'AddStars' },
          undo: [
            {
              operation: { _tag: 'RemoveStars', mode: 'balanced' },
            },
          ],
          redo: [],
        },
        preview: {
          previewId: 'develop-preview-ui',
          draftRevision: 3,
          inputCheckpointId: 'develop-checkpoint-starless-ui',
          operation: { _tag: 'AddStars' },
          toolIdentity: 'deterministic-develop-adapter-v1',
          checksum: 'sha256:develop-preview-ui',
          synchronizedAt: '2026-08-10T19:00:00.000Z',
        },
        attempts: [
          {
            attemptId: 'develop-attempt-remove-stars-ui',
            state: 'succeeded',
            inputCheckpointId: 'develop-checkpoint-base-ui',
            previewId: 'develop-preview-remove-ui',
            draftRevision: 2,
            operation: { _tag: 'RemoveStars', mode: 'balanced' },
            toolIdentity: 'deterministic-develop-adapter-v1',
            inputChecksum: 'sha256:stack-ui',
            relatedInputOutputIds: [],
            outputs: [
              {
                outputId: 'develop-output-starless-ui',
                checksum: 'sha256:starless-ui',
                format: 'fits',
                relation: 'starless',
                diagnostic:
                  'Deterministic starless FITS evidence; astronomy quality is not claimed.',
              },
              {
                outputId: 'develop-output-stars-ui',
                checksum: 'sha256:stars-ui',
                format: 'fits',
                relation: 'starCompanion',
                diagnostic:
                  'Deterministic star companion FITS evidence; astronomy quality is not claimed.',
              },
            ],
            diagnostics: [
              'Related starless and star companion outputs retained.',
            ],
            completedAt: '2026-08-10T19:00:01.000Z',
          },
          {
            attemptId: 'develop-attempt-add-stars-ui',
            state: 'failed',
            inputCheckpointId: 'develop-checkpoint-starless-ui',
            previewId: 'develop-preview-ui',
            draftRevision: 3,
            operation: { _tag: 'AddStars' },
            toolIdentity: 'deterministic-develop-adapter-v1',
            inputChecksum: 'sha256:starless-ui',
            relatedInputOutputIds: [
              'develop-output-starless-ui',
              'develop-output-stars-ui',
            ],
            outputs: [],
            diagnostics: [
              'Input bytes unavailable; the last valid checkpoint is retained.',
            ],
            completedAt: '2026-08-10T19:00:02.000Z',
          },
        ],
        history: [
          {
            checkpointId: 'develop-checkpoint-starless-ui',
            attemptId: 'develop-attempt-remove-stars-ui',
            outputId: 'develop-output-starless-ui',
            checksum: 'sha256:starless-ui',
            operation: { _tag: 'RemoveStars', mode: 'balanced' },
            relatedOutputIds: ['develop-output-stars-ui'],
          },
        ],
        historyCursor: 1,
        failedAttemptId: 'develop-attempt-add-stars-ui',
        savedResults: [
          {
            assetId: 'asset-developed-ui',
            assetRevision: 1,
            checksum: 'sha256:starless-ui',
            checkpointId: 'develop-checkpoint-starless-ui',
            attemptId: 'develop-attempt-remove-stars-ui',
            outputId: 'develop-output-starless-ui',
            savedAt: '2026-08-10T19:00:03.000Z',
          },
        ],
      },
    })),
    projectActions: [
      {
        projectId: 'project-m27',
        actions: [
          { _tag: 'Eligible', action: 'NavigateProcessingProjectStage' },
          { _tag: 'Eligible', action: 'UpdateProcessingDevelopDraft' },
          { _tag: 'Eligible', action: 'UndoProcessingDevelopDraft' },
          {
            _tag: 'Ineligible',
            action: 'RedoProcessingDevelopDraft',
            reason: 'draftRedoUnavailable',
          },
          { _tag: 'Eligible', action: 'SyncProcessingDevelopPreview' },
          { _tag: 'Eligible', action: 'ApplyProcessingDevelopPreview' },
          { _tag: 'Eligible', action: 'UndoProcessingDevelopStep' },
          {
            _tag: 'Ineligible',
            action: 'RedoProcessingDevelopStep',
            reason: 'redoUnavailable',
          },
          { _tag: 'Eligible', action: 'RetryProcessingDevelopApply' },
          { _tag: 'Eligible', action: 'SaveProcessingDevelopResult' },
        ],
      },
    ],
  })
  const developMarkup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      initialWorkspace: developed,
    }),
  )
  assert.match(developMarkup, /Exact saved Master stays unchanged/)
  assert.match(developMarkup, /Astronomy operation/)
  assert.match(developMarkup, /Astrometry \/ WCS/)
  assert.match(developMarkup, /Background extraction/)
  assert.match(developMarkup, /Astronomy color calibration/)
  assert.match(developMarkup, /Green-noise reduction/)
  assert.match(developMarkup, /Add stars back/)
  assert.match(developMarkup, /Apply exact preview/)
  assert.match(developMarkup, /Hold to compare original/)
  assert.match(developMarkup, /Retry exact failed operation/)
  assert.match(developMarkup, /Last valid checkpoint retained/)
  assert.match(developMarkup, /Starless FITS evidence/)
  assert.match(developMarkup, /Star Companion FITS evidence/)
  assert.match(developMarkup, /Saved Library Develop result/)
  const phoneMarkup = renderToStaticMarkup(
    createElement(ProcessPhone, {
      workspace: developed,
      state: 'Current',
    }),
  )
  assert.match(phoneMarkup, /Stacking and Master evidence/)
  assert.match(phoneMarkup, /Exact Registration input/)
  assert.match(phoneMarkup, /FITS Master evidence/)
  assert.match(phoneMarkup, /Saved Library Master/)
  assert.match(phoneMarkup, /Exact saved Master · asset-master-ui/)
  assert.match(phoneMarkup, /Astronomy Develop evidence/)
  assert.match(phoneMarkup, /Applied history/)
  assert.match(phoneMarkup, /last valid checkpoint is retained/)
  assert.match(phoneMarkup, /astronomy-quality processing is not claimed/)
  assert.doesNotMatch(phoneMarkup, /<button|<input|<select|<textarea/)
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
                registrationInclusions: [],
                stackingFrameChoices: [],
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
                  registrationInclusions: [],
                  stackingRecommendations: [],
                  stackingFrameChoices: [],
                  stackingInputAssetIds: [],
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
                  registrationTransforms: [],
                  viableAssetIds: [],
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
  assert.match(
    styles,
    /@media \(max-width: 1180px\) and \(min-width: 601px\)\s*\{\s*\.beta-process-develop-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
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

test('an exact Library handoff takes precedence over an existing selected project', () => {
  const sourceHandoff = Schema.decodeUnknownSync(ProcessSourceHandoff)({
    sourceAssetId: 'asset-m27-006',
    revision: 1,
    role: 'original',
    format: 'cameraRaw',
    availability: 'availableLocally',
    comparisonGroupId: 'm27-stack-1',
    lineage: { sourceAssetIds: ['asset-m27-005'] },
    processing: {
      availability: 'available',
      currentFixtureFacts: ['Deterministic file-backed adapter.'],
    },
  })
  const markup = renderToStaticMarkup(
    createElement(BetaProcessApp, {
      projection: processControllerProjection,
      loading: false,
      sourceAssetId: sourceHandoff.sourceAssetId,
      sourceHandoff,
      initialWorkspace: projectWorkspace,
    }),
  )

  assert.match(markup, /Process \/ Library handoff/)
  assert.match(markup, /Review the exact processing source/)
  assert.match(markup, /asset-m27-006/)
  assert.match(markup, /Process<\/b> · Library handoff/)
  assert.match(markup, /Exact source · asset-m27-006/)
  assert.doesNotMatch(markup, /M27 multi-night/)
})

test('phone keeps an exact Library handoff read only even when a project exists', () => {
  const sourceHandoff = Schema.decodeUnknownSync(ProcessSourceHandoff)({
    sourceAssetId: 'asset-m27-006',
    revision: 1,
    role: 'original',
    format: 'cameraRaw',
    availability: 'availableLocally',
    comparisonGroupId: 'm27-stack-1',
    lineage: { sourceAssetIds: ['asset-m27-005'] },
    processing: {
      availability: 'available',
      currentFixtureFacts: ['Deterministic file-backed adapter.'],
    },
  })
  const markup = renderToStaticMarkup(
    createElement(ProcessPhone, {
      workspace: projectWorkspace,
      state: 'Current',
      sourceAssetId: sourceHandoff.sourceAssetId,
      sourceHandoff,
    }),
  )

  assert.match(markup, /Exact Library handoff/)
  assert.match(markup, /asset-m27-006/)
  assert.match(markup, /Original · cameraRaw/)
  assert.doesNotMatch(markup, /M27 multi-night/)
  assert.doesNotMatch(markup, /<button|<input|<select|<textarea/)
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
