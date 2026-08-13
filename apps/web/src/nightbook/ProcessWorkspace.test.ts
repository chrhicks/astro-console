import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BootstrapSnapshot,
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

test('protects source-handoff Project creation without current authority', () => {
  const markup = renderSourceIntake(
    BootstrapClientState.Unavailable({ reason: 'Bootstrap unavailable.' }),
    false,
  )

  assert.match(markup, /<input[^>]*disabled=""/)
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Create Project<\/button>/)
  assert.match(markup, /Current service truth is unavailable/)
})
