import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from 'effect'
import { ProcessingProjection } from '@astro-console/v2-contracts'
import { openOriginDatabase } from '../persistence/database.ts'
import { seedLibrary } from '../persistence/library-sqlite-repository.ts'
import {
  executeProcessCommand,
  processSnapshot,
} from '../services/process-workspace.ts'

const owner = {
  personId: 'owner-1',
  clientId: 'desktop-1',
  role: 'owner' as const,
  capability: 'controlCapable' as const,
}

const command = (
  database: ReturnType<typeof openOriginDatabase>,
  value: object,
) =>
  executeProcessCommand(
    database,
    { commandId: crypto.randomUUID(), command: value },
    owner,
  )

test('Processing Project intake freezes individual and whole Capture Set sources across restart', () => {
  const database = openOriginDatabase(':memory:')
  seedLibrary(database)
  const created = command(database, {
    _tag: 'CreateProcessingProject',
    name: 'M27 multi-night',
    selection: {
      assetIds: ['asset-m27-006'],
      captureSetIds: ['m27-stack-1'],
    },
    idempotencyKey: 'create-m27-project',
  })
  assert.equal(created.outcome, 'accepted')
  let projection = Schema.decodeUnknownSync(ProcessingProjection)(
    processSnapshot(database, owner),
  )
  let project = projection.projects[0]
  assert.ok(project)
  assert.equal(project.targetName, 'M27')
  assert.ok(project.sources.length >= 2)
  assert.ok(project.sources.every((source) => source.assetRevision === 1))
  assert.ok(
    project.sources.some((source) => source.captureSetId === 'm27-stack-1'),
  )
  assert.equal(
    database.prepare('SELECT count(*) AS count FROM processing_work').get()
      ?.count,
    0,
  )

  const added = command(database, {
    _tag: 'AddProcessingProjectSources',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    selection: { assetIds: [], captureSetIds: ['m27-stack-2'] },
    idempotencyKey: 'add-second-night',
  })
  assert.equal(added.outcome, 'accepted')
  projection = Schema.decodeUnknownSync(ProcessingProjection)(
    processSnapshot(database, owner),
  )
  project = projection.projects[0]
  assert.ok(project)
  assert.equal(project.revision, 1)
  assert.ok(
    project.sources.some((source) => source.captureSetId === 'm27-stack-2'),
  )
  assert.ok(project.sources.every((source) => source.role === 'Lights'))

  const exact = project.sources.map((source) => ({
    assetId: source.assetId,
    assetRevision: source.assetRevision,
  }))
  database
    .prepare(
      "UPDATE library_assets SET revision=revision+1 WHERE comparison_group_id='m27-stack-2'",
    )
    .run()
  const afterCatalogChange = Schema.decodeUnknownSync(ProcessingProjection)(
    processSnapshot(database, owner),
  ).projects[0]
  assert.deepEqual(
    afterCatalogChange?.sources.map((source) => ({
      assetId: source.assetId,
      assetRevision: source.assetRevision,
    })),
    exact,
  )
  database.close()
})

test('Processing Project keeps calibration support target-independent and rejects a second Lights target', () => {
  const database = openOriginDatabase(':memory:')
  seedLibrary(database)
  const source = Schema.decodeUnknownSync(
    Schema.Struct({ detail: Schema.String }),
  )(
    database
      .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
      .get('asset-m27-006'),
  )
  const m31 = {
    ...JSON.parse(source.detail),
    assetId: 'asset-source-m31-light',
    targetName: 'M31',
    comparisonGroupId: 'm31-night-1',
  }
  const dark = {
    ...JSON.parse(source.detail),
    assetId: 'asset-source-dark-1',
    targetName: undefined,
    comparisonGroupId: 'calibration-dark-1',
    capture: {
      frameId: 'dark-1',
      exposureSeconds: 120,
      filter: 'L',
      binning: 1,
      frameType: 'dark',
    },
  }
  const insert = database.prepare(
    'INSERT INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
  insert.run(
    m31.assetId,
    1,
    'original',
    'fits',
    'availableLocally',
    m31.comparisonGroupId,
    m31.capturedAt,
    m31.capturedAt,
    10,
    JSON.stringify(m31),
  )
  insert.run(
    dark.assetId,
    1,
    'original',
    'fits',
    'availableLocally',
    dark.comparisonGroupId,
    dark.capturedAt,
    dark.capturedAt,
    10,
    JSON.stringify(dark),
  )
  command(database, {
    _tag: 'CreateProcessingProject',
    name: 'M27 calibrated',
    selection: {
      assetIds: ['asset-m27-006', dark.assetId, m31.assetId],
      captureSetIds: [],
    },
    idempotencyKey: 'mixed-project',
  })
  const project = Schema.decodeUnknownSync(ProcessingProjection)(
    processSnapshot(database, owner),
  ).projects[0]
  assert.ok(project)
  assert.equal(project.targetName, 'M27')
  assert.equal(
    project.sources.find((candidate) => candidate.assetId === dark.assetId)
      ?.role,
    'Darks',
  )
  assert.equal(
    project.sources.find((candidate) => candidate.assetId === m31.assetId)
      ?.role,
    'Unassigned',
  )
  assert.ok(
    project.warnings.some((warning) => warning.code === 'RoleSuggested'),
  )
  const conflict = command(database, {
    _tag: 'AssignProcessingSourceRole',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    assetId: m31.assetId,
    role: 'Lights',
    idempotencyKey: 'force-target-conflict',
  })
  assert.deepEqual(conflict, { outcome: 'rejected', reason: 'TargetConflict' })

  const retainedLight = project.sources.find(
    (candidate) => candidate.role === 'Lights',
  )
  assert.ok(retainedLight)
  const unassigned = command(database, {
    _tag: 'AssignProcessingSourceRole',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    assetId: retainedLight.assetId,
    role: 'Unassigned',
    idempotencyKey: 'unassign-last-light',
  })
  assert.equal(unassigned.outcome, 'accepted')
  if (
    unassigned.outcome !== 'accepted' ||
    unassigned.effect !== 'projectSourceRoleAssigned' ||
    !('project' in unassigned)
  )
    return
  assert.equal(unassigned.project.targetName, 'M27')
  const retarget = command(database, {
    _tag: 'AssignProcessingSourceRole',
    projectId: project.projectId,
    expectedProjectRevision: unassigned.project.revision,
    assetId: m31.assetId,
    role: 'Lights',
    idempotencyKey: 'retarget-after-last-light',
  })
  assert.deepEqual(retarget, { outcome: 'rejected', reason: 'TargetConflict' })
  database.close()
})

test('Processing Project commands and projected actions require owner desktop control', () => {
  const database = openOriginDatabase(':memory:')
  seedLibrary(database)
  const raw = {
    commandId: 'viewer-create-command',
    command: {
      _tag: 'CreateProcessingProject',
      name: 'Denied project',
      selection: { assetIds: ['asset-m27-006'], captureSetIds: [] },
      idempotencyKey: 'viewer-create-project',
    },
  }
  const viewer = { ...owner, role: 'viewer' as const }
  assert.deepEqual(executeProcessCommand(database, raw, viewer), {
    outcome: 'rejected',
    reason: 'OwnerRequired',
  })
  assert.equal(
    processSnapshot(database, viewer).actions.find(
      (action) => action.action === 'CreateProcessingProject',
    )?._tag,
    'Ineligible',
  )
  const readOnly = { ...owner, capability: 'readOnly' as const }
  assert.deepEqual(executeProcessCommand(database, raw, readOnly), {
    outcome: 'rejected',
    reason: 'OwnerRequired',
  })
  assert.deepEqual(
    processSnapshot(database, readOnly).actions.find(
      (action) => action.action === 'CreateProcessingProject',
    ),
    {
      _tag: 'Ineligible',
      action: 'CreateProcessingProject',
      reason: 'readOnlyClient',
    },
  )
  database.close()
})
