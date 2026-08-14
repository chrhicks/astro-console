import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BootstrapSnapshot,
  OpenedProcessingProject,
  ProcessingProjectEvidence,
  ProcessSourceHandoff as ProcessSourceHandoffSchema,
} from '@astro-console/protocol'
import { Schema } from 'effect'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer'
import { BootstrapClientState } from '../bootstrap-client'
import { projectBootstrapState } from '../bootstrap-projection'
import { ProcessAction } from '../nightbook-workspace-runtime'
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

Object.defineProperties(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: { value: true },
  matchMedia: {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  },
})

const currentProjection = projectBootstrapState(
  BootstrapClientState.Current({
    snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)(
      bootstrapFixtures.fresh,
    ),
  }),
)

const nodeText = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : nodeText(child)))
    .join('')

const developProject = (
  projectId: string,
  projectRevision: number,
  draftRevision: number,
  amount: number | undefined,
) =>
  Schema.decodeUnknownSync(OpenedProcessingProject)({
    projectId,
    revision: projectRevision,
    name: projectId,
    authority: { _tag: 'Allowed' },
    sources: [],
    warnings: [],
    stages: [
      {
        stage: 'Develop',
        draft: {
          revision: draftRevision,
          value: {
            _tag: 'Develop',
            operation:
              amount === undefined
                ? { _tag: 'BackgroundExtraction', sampleDensity: 'balanced' }
                : { _tag: 'Stretch', method: 'asinh', amount },
          },
          canUndo: false,
          canRedo: false,
        },
        resultHistory: { canUndo: false, canRedo: false },
        run: { _tag: 'Unavailable', reason: 'CurrentUpstreamResultRequired' },
      },
    ],
    savedAssetIds: [],
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: `2026-08-11T00:00:${String(projectRevision).padStart(2, '0')}.000Z`,
  })

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

test('fails closed while the routed source Asset leads its handoff projection', async () => {
  const assetAUpdated = Schema.decodeUnknownSync(ProcessSourceHandoffSchema)({
    ...sourceHandoff,
    revision: 4,
  })
  const assetB = Schema.decodeUnknownSync(ProcessSourceHandoffSchema)({
    ...sourceHandoff,
    sourceAssetId: 'asset-m31-002',
    revision: 1,
  })
  const creations: Array<{ name: string; assetIds: ReadonlyArray<string> }> = []
  const workspace = (
    routedAssetId: typeof sourceHandoff.sourceAssetId,
    handoff: typeof ProcessSourceHandoffSchema.Type,
  ) =>
    createElement(ProcessWorkspace, {
      projection: currentProjection,
      loading: false,
      sourceAssetId: routedAssetId,
      sourceHandoff: handoff,
      process,
      onCreateProject: async (name, selection) => {
        creations.push({ name, assetIds: selection.assetIds })
      },
      onChangeProject: async () => undefined,
    })
  const renderer: ReactTestRenderer = await act(() =>
    create(workspace(sourceHandoff.sourceAssetId, sourceHandoff)),
  )
  const nameInput = () => renderer.root.findByType('input')
  const createButton = () =>
    renderer.root
      .findAllByType('button')
      .find((button) => nodeText(button) === 'Create Project')
  assert.equal(nameInput().props.value, 'Process asset-m27-001')

  await act(() => nameInput().props.onChange({ target: { value: 'My M27' } }))
  await act(() =>
    renderer.update(workspace(sourceHandoff.sourceAssetId, assetAUpdated)),
  )
  assert.equal(nameInput().props.value, 'My M27')

  await act(() =>
    renderer.update(workspace(assetB.sourceAssetId, sourceHandoff)),
  )
  assert.equal(nameInput().props.value, 'Process asset-m31-002')
  assert.equal(createButton()?.props.disabled, true)
  assert.doesNotMatch(nodeText(renderer.root), /Revision3/)
  await act(async () => {
    createButton()?.props.onClick()
    await Promise.resolve()
  })
  assert.deepEqual(creations, [])

  await act(() => renderer.update(workspace(assetB.sourceAssetId, assetB)))
  assert.equal(nameInput().props.value, 'Process asset-m31-002')
  assert.equal(createButton()?.props.disabled, false)
  await act(async () => {
    createButton()?.props.onClick()
    await Promise.resolve()
  })
  assert.deepEqual(creations, [
    { name: 'Process asset-m31-002', assetIds: ['asset-m31-002'] },
  ])
})

test('binds the mounted Develop editor to Project and draft revision', async () => {
  const projectA = developProject('project-a', 1, 4, 0.2)
  const projectAUpdated = developProject('project-a', 2, 4, 0.2)
  const projectB = developProject('project-b', 1, 1, 0.6)
  const projectBNewDraft = developProject('project-b', 2, 2, 0.8)
  const projectWithoutStretch = developProject('project-c', 1, 1, undefined)
  const actions: Array<ProcessAction> = []
  const workspace = (
    routedProjectId: typeof projectA.projectId,
    project: typeof OpenedProcessingProject.Type,
  ) =>
    createElement(ProcessWorkspace, {
      projection: currentProjection,
      loading: false,
      projectId: routedProjectId,
      process: {
        projects: [],
        project,
        evidence: undefined,
        state: 'current' as const,
      },
      onChangeProject: async (action) => {
        actions.push(action)
      },
    })
  const renderer: ReactTestRenderer = await act(() =>
    create(workspace(projectA.projectId, projectA)),
  )
  const developButton = renderer.root
    .findAllByType('button')
    .find((button) => nodeText(button).includes('Develop'))
  assert.ok(developButton)
  await act(() => developButton.props.onClick())
  const stretchInput = () =>
    renderer.root
      .findAllByType('input')
      .find((input) => input.props.step === 0.05)

  assert.equal(stretchInput()?.props.value, 0.2)
  await act(() => stretchInput()?.props.onChange({ target: { value: '0.45' } }))
  assert.equal(stretchInput()?.props.value, 0.45)
  const updateButton = renderer.root
    .findAllByType('button')
    .find((button) => nodeText(button) === 'Update draft')
  assert.ok(updateButton)
  await act(async () => {
    updateButton.props.onClick()
    await Promise.resolve()
  })
  assert.deepEqual(actions, [
    ProcessAction.ReplaceDraft({
      draft: {
        _tag: 'Develop',
        operation: { _tag: 'Stretch', method: 'asinh', amount: 0.45 },
      },
    }),
  ])

  await act(() =>
    renderer.update(workspace(projectA.projectId, projectAUpdated)),
  )
  assert.equal(stretchInput()?.props.value, 0.45)

  await act(() =>
    renderer.update(workspace(projectB.projectId, projectAUpdated)),
  )
  assert.equal(stretchInput(), undefined)
  assert.doesNotMatch(nodeText(renderer.root), /project-a/)

  await act(() => renderer.update(workspace(projectB.projectId, projectB)))
  const caughtUpDevelopButton = renderer.root
    .findAllByType('button')
    .find((button) => nodeText(button).includes('Develop'))
  assert.ok(caughtUpDevelopButton)
  await act(() => caughtUpDevelopButton.props.onClick())
  assert.equal(stretchInput()?.props.value, 0.6)

  await act(() => stretchInput()?.props.onChange({ target: { value: '0.7' } }))
  await act(() =>
    renderer.update(workspace(projectB.projectId, projectBNewDraft)),
  )
  assert.equal(stretchInput()?.props.value, 0.8)

  await act(() =>
    renderer.update(
      workspace(projectWithoutStretch.projectId, projectWithoutStretch),
    ),
  )
  assert.equal(stretchInput()?.props.value, 0.35)
})
