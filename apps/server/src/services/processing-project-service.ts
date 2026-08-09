import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  CaptureSetId,
  Command,
  ProcessingProject,
  ProcessingProjectId,
  ProcessingProjectRevision,
  ProcessingProjectSource,
  ProcessingProjectWarning,
  type ProcessingSourceRole,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'

type ProjectCommand = Extract<
  typeof Command.Type,
  | { readonly _tag: 'CreateProcessingProject' }
  | { readonly _tag: 'AddProcessingProjectSources' }
  | { readonly _tag: 'AssignProcessingSourceRole' }
>

const ProjectRow = Schema.Struct({ project: Schema.String })
const ReceiptRow = Schema.Struct({ response: Schema.String })
const ProjectAcceptedResponse = Schema.Struct({
  outcome: Schema.Literal('accepted'),
  replayed: Schema.Boolean,
  effect: Schema.Literals([
    'projectCreated',
    'projectSourcesAdded',
    'projectSourceRoleAssigned',
  ]),
  project: ProcessingProject,
})
const SourceRow = Schema.Struct({
  asset_id: Schema.String,
  revision: Schema.Int,
  availability: Schema.String,
  comparison_group_id: Schema.String,
  captured_at: Schema.String,
  role: Schema.String,
  detail: Schema.String,
})
const StoredDetail = Schema.Struct({
  checksum: Schema.optionalKey(Schema.String),
  targetName: Schema.optionalKey(Schema.String),
  captureSetId: Schema.optionalKey(CaptureSetId),
  equipment: Schema.optionalKey(
    Schema.Struct({ rigId: Schema.String, cameraDeviceId: Schema.String }),
  ),
  lineage: Schema.Struct({
    runId: Schema.optionalKey(Schema.String),
    sequenceId: Schema.optionalKey(Schema.String),
    acquisitionId: Schema.optionalKey(Schema.String),
  }),
  capture: Schema.optionalKey(
    Schema.Struct({
      exposureSeconds: Schema.Number,
      filter: Schema.String,
      binning: Schema.Int,
      frameType: Schema.Literals(['light', 'dark', 'flat', 'bias']),
    }),
  ),
})

export const isProcessingProjectCommand = (
  command: typeof Command.Type,
): command is ProjectCommand =>
  Command.guards.CreateProcessingProject(command) ||
  Command.guards.AddProcessingProjectSources(command) ||
  Command.guards.AssignProcessingSourceRole(command)

export function processingProjects(database: DatabaseSync) {
  return Schema.decodeUnknownSync(Schema.Array(ProjectRow))(
    database
      .prepare(
        'SELECT project FROM processing_projects ORDER BY updated_at,project_id',
      )
      .all(),
  ).map((row) =>
    Schema.decodeUnknownSync(ProcessingProject)(JSON.parse(row.project)),
  )
}

export function executeProcessingProjectCommand(
  database: DatabaseSync,
  command: ProjectCommand,
  identity: LocalIdentity,
) {
  const existing = Schema.decodeUnknownSync(Schema.optional(ReceiptRow))(
    database
      .prepare(
        'SELECT response FROM processing_project_receipts WHERE idempotency_key=? AND owner_person_id=?',
      )
      .get(command.idempotencyKey, identity.personId),
  )
  if (existing !== undefined)
    return ProjectAcceptedResponse.make({
      ...Schema.decodeUnknownSync(ProjectAcceptedResponse)(
        JSON.parse(existing.response),
      ),
      replayed: true,
    })

  const current = Command.guards.CreateProcessingProject(command)
    ? undefined
    : processingProjects(database).find(
        (project) => project.projectId === command.projectId,
      )
  if (
    current !== undefined &&
    !Command.guards.CreateProcessingProject(command) &&
    current.revision !== command.expectedProjectRevision
  )
    return { outcome: 'rejected' as const, reason: 'ProjectRevisionConflict' }

  let project: ProcessingProject
  if (Command.guards.AssignProcessingSourceRole(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const source = current.sources.find(
      (candidate) => candidate.assetId === command.assetId,
    )
    if (source === undefined)
      return { outcome: 'rejected' as const, reason: 'SourceNotFound' }
    if (
      command.role === 'Lights' &&
      source.targetName !== undefined &&
      current.targetName !== undefined &&
      source.targetName !== current.targetName
    )
      return { outcome: 'rejected' as const, reason: 'TargetConflict' }
    project = reviseProject(
      current,
      current.sources.map((candidate) =>
        candidate.assetId === source.assetId
          ? ProcessingProjectSource.make({ ...candidate, role: command.role })
          : candidate,
      ),
    )
  } else {
    const selected = resolveSelection(database, command.selection)
    if (selected.length === 0)
      return { outcome: 'rejected' as const, reason: 'SourceSelectionInvalid' }
    const now = new Date().toISOString()
    if (Command.guards.CreateProcessingProject(command)) {
      const sources = assignSuggestedRoles(selected, undefined)
      project = withProjectWarnings(
        ProcessingProject.make({
          projectId: ProcessingProjectId.make(`project-${randomUUID()}`),
          revision: ProcessingProjectRevision.make(0),
          name: command.name,
          ...projectTarget(sources),
          sources,
          warnings: [],
          createdAt: now,
          updatedAt: now,
        }),
      )
    } else {
      if (current === undefined)
        return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
      const known = new Set(current.sources.map((source) => source.assetId))
      const added = assignSuggestedRoles(
        selected.filter((source) => !known.has(source.assetId)),
        current.targetName,
      )
      project = reviseProject(current, [...current.sources, ...added])
    }
  }

  const response = {
    outcome: 'accepted' as const,
    replayed: false,
    effect: Command.guards.CreateProcessingProject(command)
      ? ('projectCreated' as const)
      : Command.guards.AddProcessingProjectSources(command)
        ? ('projectSourcesAdded' as const)
        : ('projectSourceRoleAssigned' as const),
    project,
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        'INSERT INTO processing_projects(project_id,revision,project,updated_at) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,project=excluded.project,updated_at=excluded.updated_at',
      )
      .run(
        project.projectId,
        project.revision,
        JSON.stringify(project),
        project.updatedAt,
      )
    database
      .prepare('INSERT INTO processing_project_receipts VALUES (?,?,?)')
      .run(command.idempotencyKey, identity.personId, JSON.stringify(response))
    database.exec('COMMIT')
    return response
  } catch {
    database.exec('ROLLBACK')
    return {
      outcome: 'rejected' as const,
      reason: 'ProjectPersistenceUnavailable',
    }
  }
}

function resolveSelection(
  database: DatabaseSync,
  selection: {
    readonly assetIds: ReadonlyArray<string>
    readonly captureSetIds: ReadonlyArray<string>
  },
) {
  const rows = Schema.decodeUnknownSync(Schema.Array(SourceRow))(
    database
      .prepare(
        `SELECT asset_id,revision,availability,comparison_group_id,captured_at,role,detail
         FROM library_assets ORDER BY captured_at,asset_id`,
      )
      .all(),
  )
  const assetIds = new Set(selection.assetIds)
  const captureSets = new Set(selection.captureSetIds)
  return rows
    .map(projectSource)
    .filter(
      (source) =>
        assetIds.has(source.assetId) ||
        (source.captureSetId !== undefined &&
          captureSets.has(source.captureSetId)),
    )
}

function projectSource(row: typeof SourceRow.Type) {
  const detail = Schema.decodeUnknownSync(StoredDetail)(JSON.parse(row.detail))
  const suggestedRole = suggestedRoleFor(detail.capture?.frameType)
  const targetName = detail.targetName
  return ProcessingProjectSource.make({
    assetId: AssetId.make(row.asset_id),
    assetRevision: AssetRevision.make(row.revision),
    role: 'Unassigned',
    suggestedRole,
    ...(detail.captureSetId === undefined
      ? {}
      : { captureSetId: detail.captureSetId }),
    ...(targetName === undefined ? {} : { targetName }),
    capturedAt: row.captured_at,
    ...(detail.checksum === undefined ? {} : { checksum: detail.checksum }),
    availability: row.availability,
    provenance: {
      ...detail.lineage,
      ...(detail.equipment ?? {}),
      ...(detail.capture === undefined
        ? {}
        : {
            exposureSeconds: detail.capture.exposureSeconds,
            filter: detail.capture.filter,
            binning: detail.capture.binning,
          }),
    },
    warnings: [],
  })
}

function suggestedRoleFor(
  frameType: 'light' | 'dark' | 'flat' | 'bias' | undefined,
): ProcessingSourceRole {
  if (frameType === 'light') return 'Lights'
  if (frameType === 'dark') return 'Darks'
  if (frameType === 'flat') return 'Flats'
  if (frameType === 'bias') return 'Bias'
  return 'Unassigned'
}

function assignSuggestedRoles(
  sources: ReadonlyArray<typeof ProcessingProjectSource.Type>,
  existingTarget: string | undefined,
) {
  let target = existingTarget
  return sources.map((source) => {
    const desired = source.suggestedRole
    if (desired !== 'Lights')
      return ProcessingProjectSource.make({ ...source, role: desired })
    if (target === undefined) target = source.targetName
    const conflict =
      target !== undefined &&
      source.targetName !== undefined &&
      source.targetName !== target
    return ProcessingProjectSource.make({
      ...source,
      role: conflict ? 'Unassigned' : 'Lights',
      warnings: conflict
        ? [
            warning(
              'TargetConflict',
              [source.assetId],
              `${source.targetName} does not match project target ${target}; the frame remains Unassigned.`,
            ),
          ]
        : [],
    })
  })
}

function reviseProject(
  current: ProcessingProject,
  sources: ReadonlyArray<typeof ProcessingProjectSource.Type>,
) {
  return withProjectWarnings(
    ProcessingProject.make({
      ...current,
      revision: ProcessingProjectRevision.make(current.revision + 1),
      ...projectTarget(sources),
      sources,
      warnings: [],
      updatedAt: new Date().toISOString(),
    }),
  )
}

function projectTarget(
  sources: ReadonlyArray<typeof ProcessingProjectSource.Type>,
) {
  const targetName = sources.find(
    (source) => source.role === 'Lights' && source.targetName !== undefined,
  )?.targetName
  return targetName === undefined ? {} : { targetName }
}

function withProjectWarnings(project: ProcessingProject) {
  const warnings: Array<typeof ProcessingProjectWarning.Type> = []
  const lights = project.sources.filter((source) => source.role === 'Lights')
  const reference = lights[0]
  if (reference !== undefined) {
    const conflicts = lights.filter(
      (source) =>
        source.provenance.filter !== reference.provenance.filter ||
        source.provenance.binning !== reference.provenance.binning,
    )
    if (conflicts.length > 0)
      warnings.push(
        warning(
          'MetadataConflict',
          conflicts.map((source) => source.assetId),
          'Light metadata differs from the first selected Light. Review filter and binning before Calibration.',
        ),
      )
  }
  for (const source of project.sources) {
    if (source.role !== source.suggestedRole)
      warnings.push(
        warning(
          'RoleSuggested',
          [source.assetId],
          `${source.assetId} is assigned ${source.role}; retained metadata suggests ${source.suggestedRole}.`,
        ),
      )
    if (
      source.availability !== 'availableLocally' &&
      source.availability !== 'published'
    )
      warnings.push(
        warning(
          'SourceUnavailable',
          [source.assetId],
          `${source.assetId} is frozen in the project but its bytes are not currently local.`,
        ),
      )
  }
  return ProcessingProject.make({ ...project, warnings })
}

function warning(
  code: (typeof ProcessingProjectWarning.Type)['code'],
  assetIds: ReadonlyArray<typeof AssetId.Type>,
  message: string,
) {
  return ProcessingProjectWarning.make({ code, assetIds, message })
}
