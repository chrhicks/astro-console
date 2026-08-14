import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BootstrapSnapshot,
  OpenedProcessingProject,
  ProcessingProjectEvidence,
  ProcessSourceHandoff as ProcessSourceHandoffSchema,
} from '@astro-console/protocol'
import { Schema } from 'effect'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BootstrapClientState } from '../bootstrap-client'
import { projectBootstrapState } from '../bootstrap-projection'
import { bootstrapFixtures } from '../testing/bootstrap-fixtures'
import ProcessWorkspace from './ProcessWorkspace'

const sourceHandoff = Schema.decodeUnknownSync(ProcessSourceHandoffSchema)({
  sourceAssetId: 'asset-m27-001',
  revision: 3,
  role: 'original',
  format: 'fits',
  availability: 'availableLocally',
  comparisonGroupId: 'm27-night-1',
  lineage: { sourceAssetIds: [] },
  processing: { availability: 'available', currentFixtureFacts: [] },
})

const process = {
  projects: [],
  project: undefined,
  evidence: undefined,
  state: 'current' as const,
}

const renderSourceIntake = (
  state: Parameters<typeof projectBootstrapState>[0],
  withCreate = true,
) =>
  renderToStaticMarkup(
    createElement(ProcessWorkspace, {
      projection: projectBootstrapState(state),
      loading: false,
      sourceAssetId: sourceHandoff.sourceAssetId,
      sourceHandoff,
      process,
      ...(withCreate ? { onCreateProject: async () => undefined } : {}),
      onChangeProject: async () => undefined,
    }),
  )

test('allows source-handoff Project creation without the Control Lease', () => {
  const snapshot = Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.fresh,
    control: {
      revision: 5,
      state: 'held',
      holderClientId: 'desktop-other-owner',
    },
  })
  const markup = renderSourceIntake(BootstrapClientState.Current({ snapshot }))

  assert.match(markup, /Create a Processing Project/)
  assert.doesNotMatch(markup, /<input[^>]*disabled=""/)
  assert.doesNotMatch(
    markup,
    /<button[^>]*disabled=""[^>]*>Create Project<\/button>/,
  )
})

const projectWithSavedAssets = Schema.decodeUnknownSync(
  OpenedProcessingProject,
)({
  projectId: 'project-1',
  revision: 7,
  name: 'M27',
  authority: { _tag: 'Allowed' },
  sources: [],
  warnings: [],
  stages: [],
  savedAssetIds: ['asset-developed', 'asset-master'],
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:07.000Z',
})

const savedMasterEvidence = (incomplete: boolean) =>
  Schema.decodeUnknownSync(ProcessingProjectEvidence)({
    projectId: projectWithSavedAssets.projectId,
    attempts: [
      {
        attemptId: 'stacking-attempt',
        stage: 'Stacking',
        state: 'succeeded',
        draftRevision: 2,
        draft: { _tag: 'Stacking', settings: [], frameChoices: [] },
        sources: [],
        frozenAt: '2026-08-11T00:00:03.000Z',
        settledAt: '2026-08-11T00:00:04.000Z',
        outcome: 'Succeeded',
        outputs: [
          {
            outputId: 'stacking-output',
            checksum: 'stacking-checksum',
            relation: 'CurrentResult',
          },
        ],
        evidence: {
          _tag: 'Stacking',
          recommendations: [],
          frameChoices: [],
          includedAssetIds: [],
          savedMasterAssetId: 'asset-master',
        },
        diagnostics: [],
      },
    ],
    ...(incomplete ? { nextAttemptId: 'stacking-attempt-next' } : {}),
  })

const renderProject = (
  evidence: typeof ProcessingProjectEvidence.Type | undefined,
) =>
  renderToStaticMarkup(
    createElement(ProcessWorkspace, {
      projection: projectBootstrapState(
        BootstrapClientState.Current({
          snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
            bootstrapFixtures.fresh,
          ),
        }),
      ),
      loading: false,
      projectId: projectWithSavedAssets.projectId,
      process: {
        projects: [],
        project: projectWithSavedAssets,
        evidence,
        state: 'current',
      },
      onChangeProject: async () => undefined,
    }),
  )

const masterStep =
  /<li data-status="(pending|complete)"><button(?:(?!<\/li>).)*<b>Master<\/b>/s

test('shows Master eligible only from complete matched saved Stacking evidence', () => {
  const withoutEvidence = renderProject(undefined)
  const incomplete = renderProject(savedMasterEvidence(true))
  const complete = renderProject(savedMasterEvidence(false))

  assert.equal(withoutEvidence.match(masterStep)?.[1], 'pending')
  assert.equal(incomplete.match(masterStep)?.[1], 'pending')
  assert.equal(complete.match(masterStep)?.[1], 'complete')
})

test('protects source-handoff Project creation without current authority', () => {
  const markup = renderSourceIntake(
    BootstrapClientState.Unavailable({ reason: 'Bootstrap unavailable.' }),
    false,
  )

  assert.match(markup, /<input[^>]*disabled=""/)
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Create Project<\/button>/)
  assert.match(markup, /Current service truth is unavailable/)
})
