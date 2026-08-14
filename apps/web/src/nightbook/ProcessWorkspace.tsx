import {
  AttentionCard,
  Button,
  Cluster,
  DataList,
  DataListItem,
  EvidenceViewport,
  NumberField,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
  StatusIndicator,
  StepRail,
} from '@nightbook/ui'
import {
  AssetId,
  CaptureSetId,
  type ExecutableProcessingStage,
  ProcessingProjectId,
  type ProcessingStageDraftValue,
} from '@astro-console/protocol'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react'
import type { ProcessSourceHandoff } from '../library-client'
import {
  ProcessAction,
  type OpenedProcessingProject,
  type ProcessingProjectEvidence,
  type ProcessingProjectList,
} from '../nightbook-workspace-runtime'
import type { Projection } from '../presentation'
import { latestSavedStackingMasterAssetIdFromCompleteEvidence } from '../processing-project-evidence'
import { nightbookHref } from '../route-href'
import { CommandBar, type ControlPresentation } from './shared-shell'
import '@nightbook/ui/styles.css'
import './workspace.css'
import './process.css'

type ViewedStage = 'Sources' | ExecutableProcessingStage | 'Master'
type HandoffState = 'loading' | 'not-found' | 'not-local' | 'unavailable'

export type ProcessWorkspaceProps = {
  projection: Projection
  loading: boolean
  projectId?: typeof ProcessingProjectId.Type | undefined
  sourceAssetId?: typeof AssetId.Type | undefined
  sourceHandoff?: ProcessSourceHandoff | undefined
  sourceHandoffState?: HandoffState | undefined
  process: {
    projects: ProcessingProjectList
    project: OpenedProcessingProject | undefined
    evidence: ProcessingProjectEvidence | undefined
    state: 'loading' | 'current' | 'unavailable'
  }
  onCreateProject?: (
    name: string,
    selection: {
      readonly assetIds: ReadonlyArray<typeof AssetId.Type>
      readonly captureSetIds: ReadonlyArray<typeof CaptureSetId.Type>
    },
  ) => Promise<void>
  onChangeProject: (action: ProcessAction) => Promise<void>
}

const stages: ReadonlyArray<ViewedStage> = [
  'Sources',
  'Calibration',
  'Registration',
  'Stacking',
  'Master',
  'Develop',
]

const titleCase = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (v) => v.toUpperCase())

const usePhoneProjection = () => {
  const query = '(max-width: 600px)'
  const [phone, setPhone] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
  )
  useEffect(() => {
    const media = matchMedia(query)
    const update = () => setPhone(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return phone
}

const processControlPresentation = (
  project: OpenedProcessingProject | undefined,
  phone: boolean,
): ControlPresentation => {
  if (phone)
    return {
      label: 'Process · view',
      dialogLabel: 'Process authority',
      heading: 'Process authority',
      state: 'read-only',
      tone: 'warning',
      subjectLabel: 'Mode',
      subject: 'Read-only phone projection',
      presence: 'Project evidence remains available.',
      protection: 'Project changes require a desktop owner.',
    }
  if (project?.authority._tag === 'Allowed')
    return {
      label: 'Process · you',
      dialogLabel: 'Process authority',
      heading: 'Process authority',
      state: 'authorized',
      tone: 'positive',
      subjectLabel: 'Authority',
      subject: 'This client can change the Project',
      presence: 'Desktop owner · current Project revision',
      protection: 'The observatory Control Lease is not required.',
    }
  return {
    label: 'Process · view',
    dialogLabel: 'Process authority',
    heading: 'Process authority',
    state: 'protected',
    tone: 'warning',
    subjectLabel: 'Authority',
    subject: 'Project changes are unavailable',
    presence:
      project?.authority._tag === 'Denied'
        ? project.authority.reason
        : 'No Project open',
    protection: 'Open the Project from a desktop owner client.',
  }
}

export default function ProcessWorkspace(props: ProcessWorkspaceProps) {
  const phone = usePhoneProjection()
  const [viewedStage, setViewedStage] = useState<ViewedStage>('Sources')
  const [pending, setPending] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [stretch, setStretch] = useState(0.35)

  const change = useCallback(
    async (action: ProcessAction, label: string) => {
      if (props.process.project === undefined || pending !== undefined) return
      setPending(label)
      setMessage(undefined)
      try {
        await props.onChangeProject(action)
        setMessage(`${label} accepted.`)
      } catch {
        setMessage(`${label} was not accepted. The Project was reloaded.`)
      } finally {
        setPending(undefined)
      }
    },
    [pending, props.onChangeProject, props.process.project],
  )

  const { projects, project, evidence } = props.process
  const state =
    props.process.state === 'current'
      ? 'Current'
      : props.process.state === 'loading'
        ? 'Loading Processing Projects'
        : 'Unavailable'
  const authority = processControlPresentation(project, phone)
  return (
    <div
      className="nightbook-app nb-theme"
      data-nb-theme="nightbook"
      data-nb-density="compact"
    >
      <CommandBar
        projection={props.projection}
        loading={props.loading}
        workspace="process"
        controlPresentation={authority}
        allowControlAction={false}
      />
      {phone ? (
        <ProcessPhone
          {...(project === undefined ? {} : { project })}
          projects={projects}
          state={state}
          {...(props.sourceAssetId === undefined
            ? {}
            : { sourceAssetId: props.sourceAssetId })}
          {...(props.sourceHandoff === undefined
            ? {}
            : { sourceHandoff: props.sourceHandoff })}
        />
      ) : props.sourceAssetId !== undefined ? (
        <SourceIntake
          assetId={props.sourceAssetId}
          mutationAuthority={props.projection.libraryProcessMutation}
          {...(props.sourceHandoff === undefined
            ? {}
            : { handoff: props.sourceHandoff })}
          {...(props.sourceHandoffState === undefined
            ? {}
            : { handoffState: props.sourceHandoffState })}
          {...(pending === undefined ? {} : { pending })}
          {...(message === undefined ? {} : { message })}
          onCreate={async (name) => {
            if (
              props.sourceHandoff === undefined ||
              props.onCreateProject === undefined
            )
              return
            setPending('Creating Project')
            try {
              await props.onCreateProject(name, {
                assetIds: [props.sourceHandoff.sourceAssetId],
                captureSetIds: [],
              })
            } catch {
              setMessage('The Project was not created.')
              setPending(undefined)
            }
          }}
        />
      ) : project === undefined ? (
        <ProjectList projects={projects} state={state} />
      ) : (
        <ProjectWorkspace
          project={project}
          {...(evidence === undefined ? {} : { evidence })}
          viewedStage={viewedStage}
          setViewedStage={setViewedStage}
          {...(pending === undefined ? {} : { pending })}
          {...(message === undefined ? {} : { message })}
          stretch={stretch}
          setStretch={setStretch}
          change={change}
        />
      )}
      <ProcessStatus
        {...(project === undefined ? {} : { project })}
        state={state}
        {...(pending === undefined ? {} : { pending })}
      />
    </div>
  )
}

function ProjectList({
  projects,
  state,
}: {
  projects: ProcessingProjectList
  state: string
}) {
  return (
    <main
      id="nightbook-workspace"
      className="nightbook-desktop-workspace nightbook-process-workspace"
    >
      <PageHeader eyebrow="Process / Projects" title="Processing Projects" />
      <Panel>
        <PanelHeader title="Current projects" meta={state} />
        <PanelBody>
          <Stack>
            {projects.length === 0 ? (
              <AttentionCard
                tone="info"
                statusLabel="No Project"
                title="Choose sources in Library"
                description="A Library selection creates one Processing Project and stops at Sources."
                actions={
                  <a
                    className="nb-button nb-button--primary nb-button--medium"
                    href={nightbookHref('/library')}
                  >
                    Open Library
                  </a>
                }
              />
            ) : (
              projects.map((project) => (
                <a
                  key={project.projectId}
                  className="nightbook-process-project-link"
                  href={nightbookHref(
                    `/process/projects/${encodeURIComponent(project.projectId)}`,
                  )}
                >
                  <b>{project.name}</b>
                  <span>
                    {project.state} · {project.sourceCount} sources · rev{' '}
                    {project.revision}
                  </span>
                </a>
              ))
            )}
          </Stack>
        </PanelBody>
      </Panel>
    </main>
  )
}

function SourceIntake({
  assetId,
  handoff,
  handoffState,
  mutationAuthority,
  pending,
  message,
  onCreate,
}: {
  assetId: string
  handoff?: ProcessSourceHandoff | undefined
  handoffState?: HandoffState | undefined
  mutationAuthority: Projection['libraryProcessMutation']
  pending?: string | undefined
  message?: string | undefined
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(`Process ${assetId}`)
  return (
    <main
      id="nightbook-workspace"
      className="nightbook-desktop-workspace nightbook-process-workspace"
    >
      <PageHeader
        eyebrow="Process / Library handoff"
        title="Create a Processing Project"
      />
      <Panel>
        <PanelHeader
          title="Exact Library source"
          meta={handoff ? 'Resolved' : titleCase(handoffState ?? 'loading')}
        />
        <PanelBody>
          <Stack>
            <DataList>
              <DataListItem label="Asset" value={assetId} />
              <DataListItem
                label="Revision"
                value={handoff ? String(handoff.revision) : '—'}
              />
              <DataListItem
                label="Availability"
                value={handoff?.availability ?? 'unavailable'}
              />
            </DataList>
            <label>
              <span>Project name</span>
              <input
                value={name}
                disabled={!mutationAuthority.allowed}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button
              tone="primary"
              disabled={
                handoff === undefined ||
                !mutationAuthority.allowed ||
                pending !== undefined ||
                name.trim() === ''
              }
              onClick={() => void onCreate(name.trim())}
            >
              Create Project
            </Button>
            {!mutationAuthority.allowed ? (
              <p className="nightbook-process-denial">
                {mutationAuthority.reason}
              </p>
            ) : null}
            {message ? <p role="status">{message}</p> : null}
          </Stack>
        </PanelBody>
      </Panel>
    </main>
  )
}

function ProjectWorkspace({
  project,
  evidence,
  viewedStage,
  setViewedStage,
  pending,
  message,
  stretch,
  setStretch,
  change,
}: {
  project: OpenedProcessingProject
  evidence?: ProcessingProjectEvidence | undefined
  viewedStage: ViewedStage
  setViewedStage: (stage: ViewedStage) => void
  pending?: string | undefined
  message?: string | undefined
  stretch: number
  setStretch: (value: number) => void
  change: (action: ProcessAction, label: string) => Promise<void>
}) {
  const stage = project.stages.find(
    (candidate) => candidate.stage === viewedStage,
  )
  const mutable =
    project.authority._tag === 'Allowed' && project.activeAttempt === undefined
  const savedMasterAssetId =
    latestSavedStackingMasterAssetIdFromCompleteEvidence(project, evidence)
  const steps = useMemo(
    () =>
      stages.map((name) => {
        const state = project.stages.find(
          (candidate) => candidate.stage === name,
        )
        const complete =
          name === 'Sources'
            ? project.sources.length > 0
            : name === 'Master'
              ? savedMasterAssetId !== undefined
              : state?.currentResult !== undefined
        return {
          id: name,
          label: name,
          description:
            name === 'Sources'
              ? `${project.sources.length} retained`
              : (state?.currentResult?.summary ??
                (complete ? 'Complete' : 'Not run')),
          status:
            name === viewedStage
              ? ('current' as const)
              : complete
                ? ('complete' as const)
                : ('pending' as const),
        }
      }),
    [project, savedMasterAssetId, viewedStage],
  )
  return (
    <main
      id="nightbook-workspace"
      className="nightbook-desktop-workspace nightbook-process-workspace"
      aria-busy={pending !== undefined}
    >
      <PageHeader
        eyebrow="Process / Processing Project"
        title={project.name}
        actions={
          <StatusIndicator
            tone={project.activeAttempt ? 'warning' : 'positive'}
            label={
              project.activeAttempt
                ? `${project.activeAttempt.stage} ${project.activeAttempt.state}`
                : `Current · rev ${project.revision}`
            }
          />
        }
      />
      <div className="nightbook-process-grid">
        <Panel className="nightbook-process-source">
          <PanelHeader
            title="Project"
            meta={`${project.sources.length} sources`}
          />
          <PanelBody>
            <Stack>
              <StepRail
                label="Project stages"
                activeId={viewedStage}
                items={steps}
                onActiveChange={(id: string) =>
                  setViewedStage(id as ViewedStage)
                }
              />
              <DataList>
                <DataListItem label="Project ID" value={project.projectId} />
                <DataListItem
                  label="Revision"
                  value={String(project.revision)}
                />
                <DataListItem
                  label="Target"
                  value={project.targetName ?? 'Mixed or unknown'}
                />
              </DataList>
            </Stack>
          </PanelBody>
        </Panel>
        <Panel className="nightbook-process-stage">
          <PanelHeader title={viewedStage} meta="Current Result" />
          <PanelBody>
            {viewedStage === 'Sources' ? (
              <Sources project={project} />
            ) : viewedStage === 'Master' ? (
              <Master
                project={project}
                savedMasterAssetId={savedMasterAssetId}
                disabled={!mutable || pending !== undefined}
                change={change}
              />
            ) : stage ? (
              <StageResult stage={stage} evidence={evidence} />
            ) : null}
          </PanelBody>
        </Panel>
        <Panel className="nightbook-process-operation">
          <PanelHeader
            title="Controls"
            meta={mutable ? 'Project intent' : 'Protected'}
          />
          <PanelBody>
            {stage ? (
              <StageControls
                stage={stage}
                project={project}
                disabled={!mutable || pending !== undefined}
                stretch={stretch}
                setStretch={setStretch}
                change={change}
              />
            ) : (
              <AttentionCard
                tone="info"
                statusLabel="Client navigation"
                title={viewedStage}
                description="This stage does not store a durable current-stage field."
              />
            )}
            {message ? (
              <p className="nightbook-process-message" role="status">
                {message}
              </p>
            ) : null}
          </PanelBody>
        </Panel>
      </div>
    </main>
  )
}

function Sources({ project }: { project: OpenedProcessingProject }) {
  return (
    <Stack>
      {project.warnings.map((warning) => (
        <AttentionCard
          key={`${warning.code}-${warning.assetIds.join('-')}`}
          tone="warning"
          statusLabel={warning.code}
          title={warning.message}
          description={warning.assetIds.join(', ')}
        />
      ))}
      <DataList>
        {project.sources.map((source) => (
          <DataListItem
            key={source.assetId}
            label={`${source.role} · ${source.assetId}`}
            value={`rev ${source.assetRevision}`}
            detail={`${source.libraryFormat} · ${source.availability}`}
          />
        ))}
      </DataList>
    </Stack>
  )
}

function StageResult({
  stage,
  evidence,
}: {
  stage: OpenedProcessingProject['stages'][number]
  evidence?: ProcessingProjectEvidence | undefined
}) {
  const attempts =
    evidence?.attempts.filter((attempt) => attempt.stage === stage.stage) ?? []
  return (
    <Stack>
      <EvidenceViewport
        label={`${stage.stage} Current Result`}
        fit="fill"
        fallback={
          stage.currentResult?.summary ??
          'No Current Result. Run this stage when its exact inputs are ready.'
        }
        caption="Current Result is product state. Retained attempts are secondary evidence."
      />
      <DataList>
        <DataListItem
          label="Current Result"
          value={stage.currentResult?.resultId ?? 'None'}
        />
        <DataListItem
          label="Lineage"
          value={stage.currentResult?.lineage ?? 'Unavailable'}
        />
        <DataListItem
          label="Draft revision"
          value={String(stage.draft.revision)}
        />
        <DataListItem
          label="Retained attempts"
          value={String(attempts.length)}
          detail={
            attempts
              .map((attempt) => `${attempt.attemptId}: ${attempt.state}`)
              .join(' · ') || undefined
          }
        />
      </DataList>
    </Stack>
  )
}

function StageControls({
  stage,
  project,
  disabled,
  stretch,
  setStretch,
  change,
}: {
  stage: OpenedProcessingProject['stages'][number]
  project: OpenedProcessingProject
  disabled: boolean
  stretch: number
  setStretch: (value: number) => void
  change: (action: ProcessAction, label: string) => Promise<void>
}) {
  const runUnavailable =
    stage.run._tag === 'Unavailable' ? stage.run.reason : undefined
  const runLabel = stage.run._tag === 'Available' ? stage.run.label : 'Run'
  const draft =
    stage.stage === 'Develop'
      ? ({
          _tag: 'Develop',
          operation: { _tag: 'Stretch', method: 'asinh', amount: stretch },
        } satisfies ProcessingStageDraftValue)
      : stage.draft.value
  const saveStage =
    stage.stage === 'Stacking' || stage.stage === 'Develop'
      ? stage.stage
      : undefined
  return (
    <Stack>
      {stage.stage === 'Develop' ? (
        <>
          <label>
            <span>Stretch amount</span>
            <NumberField
              min={0}
              max={1}
              step={0.05}
              value={stretch}
              disabled={disabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setStretch(Number(event.target.value))
              }
            />
          </label>
          <Button
            disabled={disabled}
            onClick={() =>
              void change(
                ProcessAction.ReplaceDraft({ draft }),
                'Updating Develop draft',
              )
            }
          >
            Update draft
          </Button>
          <Button
            disabled={disabled || project.developBase === undefined}
            onClick={() =>
              void change(
                ProcessAction.SyncDevelopPreview({}),
                'Synchronizing Develop preview',
              )
            }
          >
            Preview
          </Button>
        </>
      ) : null}
      <Button
        tone="primary"
        disabled={disabled || runUnavailable !== undefined}
        title={runUnavailable}
        onClick={() =>
          void change(
            ProcessAction.RunCurrentDraft({ stage: stage.stage }),
            `${runLabel} ${stage.stage}`,
          )
        }
      >
        {runLabel} {stage.stage}
      </Button>
      {runUnavailable ? (
        <p className="nightbook-process-denial">
          <b>Unavailable:</b> {titleCase(runUnavailable)}
        </p>
      ) : null}
      <Cluster>
        <Button
          disabled={disabled || !stage.draft.canUndo}
          onClick={() =>
            void change(
              ProcessAction.UndoDraft({ stage: stage.stage }),
              'Undoing draft',
            )
          }
        >
          Undo draft
        </Button>
        <Button
          disabled={disabled || !stage.draft.canRedo}
          onClick={() =>
            void change(
              ProcessAction.RedoDraft({ stage: stage.stage }),
              'Redoing draft',
            )
          }
        >
          Redo draft
        </Button>
      </Cluster>
      <Cluster>
        <Button
          disabled={disabled || !stage.resultHistory.canUndo}
          onClick={() =>
            void change(
              ProcessAction.UndoCurrentResult({ stage: stage.stage }),
              'Undoing Current Result',
            )
          }
        >
          Undo result
        </Button>
        <Button
          disabled={disabled || !stage.resultHistory.canRedo}
          onClick={() =>
            void change(
              ProcessAction.RedoCurrentResult({ stage: stage.stage }),
              'Redoing Current Result',
            )
          }
        >
          Redo result
        </Button>
      </Cluster>
      {saveStage !== undefined ? (
        <Button
          disabled={disabled || stage.currentResult === undefined}
          onClick={() => {
            void change(
              ProcessAction.SaveCurrentResult({ stage: saveStage }),
              `Saving ${stage.stage} Current Result`,
            )
          }}
        >
          Save Current Result to Library
        </Button>
      ) : null}
    </Stack>
  )
}

function Master({
  project,
  savedMasterAssetId,
  disabled,
  change,
}: {
  project: OpenedProcessingProject
  savedMasterAssetId: typeof AssetId.Type | undefined
  disabled: boolean
  change: (action: ProcessAction, label: string) => Promise<void>
}) {
  return (
    <Stack>
      <DataList>
        <DataListItem
          label="Saved Library Assets"
          value={String(project.savedAssetIds.length)}
          detail={project.savedAssetIds.join(', ') || undefined}
        />
        <DataListItem
          label="Develop base"
          value={project.developBase?.assetId ?? 'Not open'}
          detail={
            project.developBase
              ? `rev ${project.developBase.assetRevision} · ${project.developBase.checksum}`
              : undefined
          }
        />
      </DataList>
      <Button
        disabled={disabled || savedMasterAssetId === undefined}
        onClick={() =>
          void change(
            ProcessAction.OpenSavedMasterInDevelop({}),
            'Opening saved Master in Develop',
          )
        }
      >
        Open saved Master in Develop
      </Button>
    </Stack>
  )
}

function ProcessPhone({
  project,
  projects,
  state,
  sourceAssetId,
  sourceHandoff,
}: {
  project?: OpenedProcessingProject | undefined
  projects: ProcessingProjectList
  state: string
  sourceAssetId?: string | undefined
  sourceHandoff?: ProcessSourceHandoff | undefined
}) {
  const currentResultCount =
    project?.stages.filter((stage) => stage.currentResult !== undefined)
      .length ?? 0
  return (
    <main
      id="nightbook-workspace"
      className="nightbook-phone-workspace nightbook-process-phone"
    >
      <header className="nightbook-phone-header">
        <div>
          <p>Process / read only</p>
          <h1>{project?.name ?? sourceAssetId ?? 'Processing Projects'}</h1>
        </div>
        <StatusIndicator
          label={state}
          tone={state === 'Current' ? 'positive' : 'neutral'}
        />
      </header>
      <AttentionCard
        tone="warning"
        statusLabel="Read-only on phone"
        title="Current Project evidence"
        description="Use a desktop owner client to change a Project."
      />
      <Panel>
        <PanelHeader
          title="Project summary"
          meta={
            project ? `rev ${project.revision}` : `${projects.length} projects`
          }
        />
        <PanelBody>
          <DataList>
            <DataListItem
              label="Project"
              value={project?.projectId ?? 'No Project open'}
            />
            <DataListItem
              label="Sources"
              value={
                project
                  ? String(project.sources.length)
                  : sourceHandoff
                    ? '1 resolved'
                    : '—'
              }
            />
            <DataListItem
              label="Active attempt"
              value={
                project?.activeAttempt
                  ? `${project.activeAttempt.stage} ${project.activeAttempt.state}`
                  : 'None'
              }
            />
            <DataListItem
              label="Saved Assets"
              value={project ? String(project.savedAssetIds.length) : '—'}
            />
          </DataList>
        </PanelBody>
      </Panel>
      {project ? (
        <Panel>
          <PanelHeader
            title="Current Results"
            meta={`${currentResultCount} current`}
          />
          <PanelBody>
            <DataList>
              <DataListItem
                label="Sources"
                value={project.sources.length > 0 ? 'Complete' : 'Empty'}
                detail={`${project.sources.length} retained`}
              />
              {project.stages.map((stage) => (
                <DataListItem
                  key={stage.stage}
                  label={stage.stage}
                  value={stage.currentResult ? 'Current' : 'Pending'}
                  detail={stage.currentResult?.summary ?? 'Not run'}
                />
              ))}
              <DataListItem
                label="Master"
                value={project.savedAssetIds.length > 0 ? 'Saved' : 'Pending'}
                detail={
                  project.savedAssetIds.length > 0
                    ? `${project.savedAssetIds.length} immutable Library asset${project.savedAssetIds.length === 1 ? '' : 's'}`
                    : 'No saved Library Master'
                }
              />
            </DataList>
          </PanelBody>
        </Panel>
      ) : null}
    </main>
  )
}

function ProcessStatus({
  project,
  state,
  pending,
}: {
  project?: OpenedProcessingProject | undefined
  state: string
  pending?: string | undefined
}) {
  return (
    <footer
      className="nightbook-operational-status nightbook-process-status"
      aria-label="Operational status"
    >
      <span>
        <i
          data-tone={state === 'Current' ? 'positive' : 'warning'}
          aria-hidden="true"
        />
        <b>Process</b> · {pending ?? state}
      </span>
      <span>
        {project
          ? `Project ${project.projectId} · rev ${project.revision}`
          : 'Explicit Project selection'}
      </span>
      <span>
        Current Result · retained attempt evidence · immutable lineage
      </span>
    </footer>
  )
}
