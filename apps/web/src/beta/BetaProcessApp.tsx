import {
  AttentionCard,
  Button,
  Cluster,
  DataList,
  DataListItem,
  EvidenceViewport,
  Field,
  MetricOverlay,
  NumberField,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
  Stack,
  StatusIndicator,
  StepRail,
} from '@nightbook/ui'
import { ProcessingProjection } from '@astro-console/v2-contracts'
import { Schema } from 'effect'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { ProcessSourceHandoff, ReviewRequest } from '../library-client'
import type { Projection } from '../presentation'
import {
  BetaCommandBar,
  type BetaControlPresentation,
  type BetaControlSubmit,
} from './BetaObserveApp'
import { nightbookHref } from './route'
import '@nightbook/ui/styles.css'
import './beta-observe.css'
import './beta-process.css'

export type ProcessWorkspace = typeof ProcessingProjection.Type
type Session = ProcessWorkspace['sessions'][number]
type ProcessAction = ProcessWorkspace['actions'][number]
type ProcessActionName = ProcessAction['action']
type ProjectStageName = ProcessWorkspace['projects'][number]['currentStage']
type ProcessDenialReason = Extract<
  ProcessAction,
  { _tag: 'Ineligible' }
>['reason']
type HandoffState = 'loading' | 'not-found' | 'not-local' | 'unavailable'

export type BetaProcessAppProps = {
  projection: Projection
  loading: boolean
  submitControl?: BetaControlSubmit
  sourceAssetId?: string | undefined
  sourceHandoff?: ProcessSourceHandoff | undefined
  sourceHandoffState?: HandoffState | undefined
  initialWorkspace?: ProcessWorkspace | undefined
  loadWorkspace?: (() => Promise<ProcessWorkspace>) | undefined
  sendCommand?: ((command: object) => Promise<unknown>) | undefined
  onReviewCandidate?:
    | ((assetId: string, request: ReviewRequest) => Promise<void>)
    | undefined
}

const decodeWorkspace = (value: unknown) =>
  Schema.decodeUnknownSync(ProcessingProjection)(value)

const browserLoad = async () => {
  const response = await fetch('/api/workspaces/process')
  if (!response.ok) throw new Error('Process projection unavailable')
  return decodeWorkspace(await response.json())
}

const browserSend = async (command: object) => {
  const response = await fetch('/api/process/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: crypto.randomUUID(), command }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (
    !response.ok ||
    (value as { outcome?: string } | undefined)?.outcome !== 'accepted'
  )
    throw new Error('Process command rejected')
  return value
}

const titleCase = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (v) => v.toUpperCase())

const calibrationSupportLabel = (role: string) =>
  role === 'Flats'
    ? 'Flat'
    : role === 'Darks'
      ? 'Dark'
      : role === 'Bias'
        ? 'Bias frame'
        : role === 'Dark flats'
          ? 'Dark flat'
          : role

const processAuthorityConfirmed = (projection: Projection) =>
  projection.shell.freshness.startsWith('Current ') &&
  projection.shell.membership === 'Owner member' &&
  projection.shell.capability.startsWith('Control-capable client') &&
  !projection.shell.control.readOnly

const processCommandsProtected = (projection: Projection) =>
  !processAuthorityConfirmed(projection)

const processControlPresentation = (
  projection: Projection,
  phone: boolean,
): BetaControlPresentation => {
  if (phone)
    return {
      label: 'Control · view',
      dialogLabel: 'Process authority',
      heading: 'Process authority',
      state: 'read-only',
      tone: 'warning',
      subjectLabel: 'Mode',
      subject: 'Read-only phone projection',
      presence: 'Process mutations require a current desktop owner.',
      protection: 'Phone Process evidence is intentionally read-only.',
      currentUiHref: '/process',
    }
  if (projection.shell.control.actions.some((action) => action.kind === 'take'))
    return {
      label: 'Control · view',
      dialogLabel: 'Process authority',
      heading: 'Process authority',
      state: 'unheld',
      tone: 'warning',
      subjectLabel: 'Controller',
      subject: projection.shell.controller,
      presence: projection.shell.control.presence,
      protection:
        'Take shared control before using controller-owned Process actions.',
      currentUiHref: '/process',
    }
  if (processAuthorityConfirmed(projection))
    return {
      label: 'Control · you',
      dialogLabel: 'Process authority',
      heading: 'Process authority',
      state: 'authorized',
      tone: 'positive',
      subjectLabel: 'Authority',
      subject: 'This client has Process authority',
      presence: 'Current desktop owner · control-capable client',
      protection:
        'Process commands remain service-owned and current-revision guarded.',
      currentUiHref: '/process',
    }
  return {
    label: 'Process · view',
    dialogLabel: 'Process authority',
    heading: 'Process authority',
    state: 'protected',
    tone: 'warning',
    subjectLabel: 'Authority',
    subject: 'Process authority unavailable',
    presence: 'Current desktop owner authority is not confirmed.',
    protection: 'Process commands are protected until authority is current.',
    currentUiHref: '/process',
  }
}

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

const selectedSession = (workspace: ProcessWorkspace | undefined) =>
  workspace?.sessions.find(
    (session) => session.sessionId === workspace.selectedSessionId,
  ) ??
  workspace?.sessions
    .filter((session) => session.lifecycle !== 'discarded')
    .at(-1)

const selectedProject = (workspace: ProcessWorkspace | undefined) =>
  workspace?.projects.find(
    (project) => project.projectId === workspace.selectedProjectId,
  ) ?? workspace?.projects.at(-1)

const projectStageNames = [
  'Sources',
  'Calibration',
  'Registration',
  'Stacking',
  'Master',
  'Develop',
] as const

const projectSteps = (
  project: ProcessWorkspace['projects'][number],
  viewedStage: ProjectStageName,
) => {
  const stacking = project.stages.find(
    (candidate) => candidate.stage === 'Stacking',
  )
  const selectedStack = stacking?.attempts.find(
    (attempt) => attempt.attemptId === stacking.selectedAttemptId,
  )
  return projectStageNames.map((name) => {
    const stage = project.stages.find((candidate) => candidate.stage === name)
    const selected = stage?.attempts.find(
      (attempt) => attempt.attemptId === stage.selectedAttemptId,
    )
    const active = stage?.attempts.some(
      (attempt) => attempt.state === 'queued' || attempt.state === 'running',
    )
    const failed = stage?.attempts.at(-1)?.state === 'failed'
    const current = viewedStage === name
    return {
      id: name.toLowerCase(),
      label: name,
      description:
        name === 'Sources'
          ? `${project.sources.length} retained`
          : name === 'Master' && selectedStack?.savedMaster
            ? 'Saved Library Master'
            : name === 'Develop' && project.developMasterAssetId
              ? 'Saved Master open'
              : selected?.state === 'succeeded' &&
                  !selected.basedOnEarlierUpstream
                ? 'Result selected'
                : active
                  ? 'Attempt active'
                  : stage?.attempts.length
                    ? `${stage.attempts.length} retained`
                    : name === 'Master'
                      ? 'No result yet'
                      : name === 'Develop'
                        ? 'No saved Master'
                        : 'Explicit Run later',
      status: current
        ? ('current' as const)
        : failed
          ? ('failed' as const)
          : name === 'Sources' ||
              (name === 'Master' && selectedStack?.savedMaster !== undefined) ||
              (name === 'Develop' &&
                project.developMasterAssetId !== undefined) ||
              (selected?.state === 'succeeded' &&
                !selected.basedOnEarlierUpstream)
            ? ('complete' as const)
            : ('pending' as const),
    }
  })
}

const currentOutputId = (session: Session) => {
  if (session.historyPosition > 0)
    return session.history[session.historyPosition - 1]?.output.outputId
  return session.baseImage?._tag === 'DerivedOutput'
    ? session.baseImage.outputId
    : undefined
}

const processDenialMessages: Record<ProcessDenialReason, string> = {
  ownerRequired: 'The current member must be an owner.',
  readOnlyClient: 'A control-capable desktop client is required.',
  sourceRequired: 'Select a supported local Library source.',
  sessionActiveRequired: 'Resume the unfinished session first.',
  sessionUnfinishedRequired: 'Only an unfinished session can resume.',
  sessionDiscarded: 'The discarded session cannot change.',
  currentImageRequired: 'A durable current image is required.',
  previewReadyRequired: 'Compute an exact ready preview first.',
  processingAttemptActive: 'Wait for the current processing attempt.',
  failedAttemptRequired: 'No failed checkpoint is available to retry.',
  undoUnavailable: 'There is no applied step to undo.',
  redoUnavailable: 'There is no later applied step to redo.',
  outputRequired: 'Create a durable processing output first.',
  assistantFindingRequired: 'No current assistant finding is available.',
  saveInProgress: 'Wait for the current Library save to finish.',
  projectStageRequired: 'Choose Calibration, Registration, or Stacking.',
  draftUndoUnavailable: 'There is no earlier draft setting.',
  draftRedoUnavailable: 'There is no later draft setting.',
  upstreamResultRequired: 'Select the required upstream result first.',
  stageAttemptActive: 'Wait for the current stage attempt.',
  stageResultUnavailable: 'No completed stage result is available.',
  calibrationOverrideUnavailable:
    'Mismatched support can be included only after Calibration review.',
  calibrationLightsUnavailable:
    'At least one readable Light is required for Calibration.',
  registrationFrameChoiceUnavailable:
    'Only a current warning frame with a usable transform can change the next Stack input.',
  registrationReferenceUnavailable:
    'Choose a Light from the exact selected Calibration result.',
  stackingFrameChoiceUnavailable:
    'Only a technically usable registered Light can change this Stack input.',
  stackingInputUnavailable: 'Include at least one technically usable Light.',
  stackResultRequired: 'Select a completed Stack result first.',
  savedMasterRequired: 'Save the selected Stack result before opening Develop.',
  developBaseRequired: 'Open an exact saved Master before using Develop.',
  developPreviewRequired:
    'Wait for the current settings preview to synchronize.',
  developApplyActive: 'Wait for the current Develop operation.',
  developFailedAttemptRequired:
    'No failed Develop operation is available to retry.',
  developAppliedResultRequired: 'Apply at least one Develop operation first.',
}

const processAction = (
  actions: ReadonlyArray<ProcessAction> | undefined,
  action: ProcessActionName,
) => actions?.find((candidate) => candidate.action === action)

const processActionReason = (
  actions: ReadonlyArray<ProcessAction> | undefined,
  action: ProcessActionName,
) => {
  const availability = processAction(actions, action)
  if (availability?._tag === 'Eligible') return undefined
  return availability?._tag === 'Ineligible'
    ? processDenialMessages[availability.reason]
    : 'The service did not project this Process action.'
}

function ProcessActionDenial({ reason }: { reason: string | undefined }) {
  return reason ? (
    <p className="beta-process-denial">
      <b>Unavailable:</b> {reason}
    </p>
  ) : null
}

function CalibrationReasonList({
  reasons,
}: {
  reasons: ReadonlyArray<string>
}) {
  return (
    <ul className="beta-process-calibration-reasons">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  )
}

const lifecycleSteps = (session: Session) => [
  {
    id: 'source',
    label: 'Source',
    description: `${session.sources.length} local`,
    status: 'complete' as const,
  },
  {
    id: 'build',
    label: 'Build master',
    description: session.phase === 'build' ? 'Current' : 'Complete',
    status:
      session.phase === 'build' ? ('current' as const) : ('complete' as const),
  },
  {
    id: 'develop',
    label: 'Develop image',
    description:
      session.phase === 'develop'
        ? `${session.historyPosition} applied`
        : 'Pending',
    status:
      session.phase === 'develop' ? ('current' as const) : ('pending' as const),
  },
  {
    id: 'save',
    label: 'Library artifact',
    description: session.savedAssetIds.length
      ? `${session.savedAssetIds.length} saved`
      : 'Intentional',
    status: session.savedAssetIds.length
      ? ('complete' as const)
      : ('pending' as const),
  },
]

const buildStageNames = [
  'validate',
  'calibrate',
  'debayer',
  'align',
  'evaluate',
  'stack',
] as const

const buildStageItems = (
  current: (typeof buildStageNames)[number] | undefined,
) => {
  const currentIndex = buildStageNames.indexOf(current ?? 'validate')
  return buildStageNames.map((stage, index) => ({
    id: stage,
    label: titleCase(stage),
    description: index < currentIndex ? 'Checkpoint complete' : undefined,
    status:
      index < currentIndex
        ? ('complete' as const)
        : index === currentIndex
          ? ('current' as const)
          : ('pending' as const),
  }))
}

const buildStage = (value: string | undefined) =>
  buildStageNames.find((candidate) => candidate === value)

export function ProcessPhone({
  workspace,
  state,
  sourceAssetId,
  sourceHandoff,
  sourceHandoffState,
}: {
  workspace: ProcessWorkspace | undefined
  state: string
  sourceAssetId?: string | undefined
  sourceHandoff?: ProcessSourceHandoff | undefined
  sourceHandoffState?: HandoffState | undefined
}) {
  if (sourceAssetId !== undefined)
    return (
      <main
        id="beta-workspace"
        className="beta-phone-workspace beta-process-phone"
      >
        <header className="beta-phone-header">
          <div>
            <p>Process source / read only</p>
            <h1>{sourceAssetId}</h1>
          </div>
          <StatusIndicator
            label={sourceHandoff ? 'Library source resolved' : state}
            tone={sourceHandoff ? 'positive' : 'neutral'}
          />
        </header>
        <AttentionCard
          tone="warning"
          statusLabel="Read-only on phone"
          title="Exact Library handoff"
          description="Start or add this source from the desktop workspace."
        />
        <Panel>
          <PanelHeader title="Source evidence" meta="Service owned" />
          <PanelBody>
            <DataList>
              <DataListItem label="Asset" value={sourceAssetId} />
              <DataListItem
                label="State"
                value={
                  sourceHandoff
                    ? 'Resolved'
                    : titleCase(sourceHandoffState ?? state)
                }
              />
              {sourceHandoff ? (
                <>
                  <DataListItem
                    label="Revision"
                    value={String(sourceHandoff.revision)}
                  />
                  <DataListItem
                    label="Representation"
                    value={`${titleCase(sourceHandoff.role)} · ${sourceHandoff.format}`}
                  />
                  <DataListItem
                    label="Availability"
                    value={titleCase(sourceHandoff.availability)}
                  />
                </>
              ) : null}
            </DataList>
          </PanelBody>
        </Panel>
      </main>
    )
  const session = selectedSession(workspace)
  const project = selectedProject(workspace)
  const calibration = project?.stages.find(
    (stage) => stage.stage === 'Calibration',
  )
  const registration = project?.stages.find(
    (stage) => stage.stage === 'Registration',
  )
  const stacking = project?.stages.find((stage) => stage.stage === 'Stacking')
  const currentProjectStage = project?.stages.find(
    (stage) => stage.stage === project.currentStage,
  )
  const currentDevelop =
    project?.currentStage === 'Develop' ? project.develop : undefined
  const selectedStackingAttempt = stacking?.attempts.find(
    (attempt) => attempt.attemptId === stacking.selectedAttemptId,
  )
  return (
    <main
      id="beta-workspace"
      className="beta-phone-workspace beta-process-phone"
    >
      <header className="beta-phone-header">
        <div>
          <p>Process / read only</p>
          <h1>
            {project?.name ??
              (session ? titleCase(session.phase) : 'Process session')}
          </h1>
        </div>
        <StatusIndicator
          label={project ? project.currentStage : (session?.lifecycle ?? state)}
          tone={project || session ? 'positive' : 'neutral'}
        />
      </header>
      <AttentionCard
        tone="warning"
        statusLabel="Read-only on phone"
        title="Durable processing evidence"
        description="Process mutations require the desktop workspace."
      />
      <Panel>
        <PanelHeader
          title={project ? 'Project summary' : 'Session summary'}
          meta={
            project
              ? `project rev ${project.revision}`
              : session
                ? `rev ${session.revision}`
                : 'No session'
          }
        />
        <PanelBody>
          <DataList>
            <DataListItem
              label="Lifecycle"
              value={
                project ? 'Processing Project' : (session?.lifecycle ?? state)
              }
            />
            <DataListItem
              label="Phase"
              value={
                project
                  ? project.currentStage
                  : (session?.phase ?? 'Unavailable')
              }
            />
            {!project ? (
              <>
                <DataListItem
                  label="History"
                  value={
                    session
                      ? `${session.historyPosition} / ${session.history.length}`
                      : '—'
                  }
                />
                <DataListItem
                  label="Preview"
                  value={session?.preview?.state ?? 'None'}
                />
              </>
            ) : null}
            <DataListItem
              label="Pressure"
              value={workspace?.pressure.state ?? 'Unknown'}
              detail={workspace?.pressure.reason}
            />
            {!project ? (
              <DataListItem
                label="Saved"
                value={String(session?.savedAssetIds.length ?? 0)}
              />
            ) : null}
            {project ? (
              <>
                <DataListItem
                  label="Target"
                  value={project.targetName ?? 'Not set'}
                />
                <DataListItem
                  label="Frozen sources"
                  value={String(project.sources.length)}
                />
                <DataListItem
                  label="Warnings"
                  value={String(project.warnings.length)}
                />
                <DataListItem
                  label="Stage draft"
                  value={
                    (currentDevelop?.draft.revision ??
                      currentProjectStage?.draft.revision) === undefined
                      ? 'Not editable in this stage'
                      : `Revision ${currentDevelop?.draft.revision ?? currentProjectStage?.draft.revision}`
                  }
                />
                <DataListItem
                  label="Stage attempts"
                  value={String(
                    currentDevelop?.attempts.length ??
                      currentProjectStage?.attempts.length ??
                      0,
                  )}
                  detail={
                    currentDevelop
                      ? `Applied history ${currentDevelop.historyCursor} / ${currentDevelop.history.length}`
                      : currentProjectStage?.selectedAttemptId
                        ? `Selected ${currentProjectStage.selectedAttemptId}`
                        : 'No selected result'
                  }
                />
                <DataListItem
                  label="Available views"
                  value="Sources · Calibration · Registration · Stacking · Master · Develop"
                />
              </>
            ) : null}
            {!project ? (
              <DataListItem
                label="Frozen candidates"
                value={String(session?.selection?.candidateCount ?? 0)}
                detail={
                  session?.selection
                    ? `${session.selection.includedCount} included · ${session.selection.excludedCount} excluded`
                    : 'No recommended set is frozen.'
                }
              />
            ) : null}
          </DataList>
        </PanelBody>
      </Panel>
      {project ? (
        <Panel>
          <PanelHeader
            title="Frozen sources"
            meta={`${project.sources.length} exact revision${project.sources.length === 1 ? '' : 's'}`}
          />
          <PanelBody>
            <div
              className="beta-process-phone-sources"
              aria-label="Read-only frozen project sources"
            >
              {project.sources.map((source) => (
                <article
                  className="beta-process-phone-source"
                  key={source.assetId}
                >
                  <b>{source.assetId}</b>
                  <span>
                    Revision {source.assetRevision}
                    {source.captureSetId ? ` · ${source.captureSetId}` : ''}
                  </span>
                  <span>
                    {source.targetName ?? 'Calibration support'} · {source.role}
                  </span>
                  <span>Suggested: {source.suggestedRole}</span>
                  <span>
                    Library: {source.libraryRole} · {source.libraryFormat}
                  </span>
                  <span>
                    {source.provenance.exposureSeconds === undefined
                      ? 'Exposure not recorded'
                      : `${source.provenance.exposureSeconds}s`}
                    {' · '}
                    {source.provenance.filter ?? 'Filter not recorded'} · bin{' '}
                    {source.provenance.binning ?? '—'}
                  </span>
                </article>
              ))}
            </div>
          </PanelBody>
        </Panel>
      ) : null}
      {calibration ? (
        <Panel>
          <PanelHeader
            title="Calibration evidence"
            meta={`${calibration.calibrationRecommendations.length} support review${calibration.calibrationRecommendations.length === 1 ? '' : 's'}`}
          />
          <PanelBody>
            <Stack>
              <p>
                Matches use retained exposure, filter, binning, and camera
                identity where applicable. Gain and temperature are not retained
                and are not evaluated.
              </p>
              <div className="beta-process-phone-sources">
                {calibration.calibrationRecommendations.map(
                  (recommendation) => (
                    <article
                      className="beta-process-phone-source"
                      key={recommendation.assetId}
                    >
                      <b>
                        {recommendation.role} · {recommendation.assetId}
                      </b>
                      <span>
                        {recommendation.decision} ·{' '}
                        {recommendation.compatibility}
                      </span>
                      <CalibrationReasonList reasons={recommendation.reasons} />
                      <span>
                        {calibration.draft.overrides.some(
                          (override) =>
                            override.assetId === recommendation.assetId,
                        )
                          ? 'Included despite mismatch in the current draft'
                          : 'Excluded from Calibration in the current draft'}
                      </span>
                    </article>
                  ),
                )}
                {calibration.attempts.map((attempt) => (
                  <article
                    className="beta-process-phone-source"
                    key={attempt.attemptId}
                  >
                    <b>{attempt.attemptId}</b>
                    <span>
                      {titleCase(attempt.state)} ·{' '}
                      {attempt.stageOutcome ?? 'Pending'} ·{' '}
                      {attempt.toolIdentity}
                    </span>
                    <span>
                      {attempt.outputs.length} deterministic JSON evidence
                      output{attempt.outputs.length === 1 ? '' : 's'}
                    </span>
                    {attempt.frameOutcomes.map((outcome) => (
                      <span key={outcome.assetId}>
                        {outcome.assetId} · {outcome.outcome} ·{' '}
                        {outcome.message}
                        {outcome.diagnostic ? ` · ${outcome.diagnostic}` : ''}
                      </span>
                    ))}
                    {attempt.diagnostics.map((diagnostic) => (
                      <span key={diagnostic}>{diagnostic}</span>
                    ))}
                    {calibration.selectedAttemptId === attempt.attemptId ? (
                      <strong>Selected result</strong>
                    ) : null}
                  </article>
                ))}
              </div>
            </Stack>
          </PanelBody>
        </Panel>
      ) : null}
      {registration ? (
        <Panel>
          <PanelHeader
            title="Registration evidence"
            meta={`${registration.attempts.length} retained attempt${registration.attempts.length === 1 ? '' : 's'}`}
          />
          <PanelBody>
            <div className="beta-process-phone-sources">
              {registration.attempts.map((attempt) => (
                <article
                  className="beta-process-phone-source"
                  key={attempt.attemptId}
                >
                  <b>{attempt.attemptId}</b>
                  <span>
                    {titleCase(attempt.state)} ·{' '}
                    {attempt.stageOutcome ?? 'Pending'} · {attempt.toolIdentity}
                  </span>
                  <span>
                    Upstream {attempt.upstreamAttemptId ?? 'not selected'}
                  </span>
                  <span>
                    {attempt.viableAssetIds.length} Light
                    {attempt.viableAssetIds.length === 1 ? '' : 's'} selected
                    for the next Stack input
                  </span>
                  {attempt.frameOutcomes.map((outcome) => (
                    <span key={outcome.assetId}>
                      {outcome.assetId} · {outcome.outcome} · {outcome.message}
                      {outcome.diagnostic ? ` · ${outcome.diagnostic}` : ''}
                    </span>
                  ))}
                  <span>
                    {attempt.registrationTransforms.length} retained transform
                    {attempt.registrationTransforms.length === 1 ? '' : 's'}
                  </span>
                  {attempt.diagnostics.map((diagnostic) => (
                    <span key={diagnostic}>{diagnostic}</span>
                  ))}
                  {registration.selectedAttemptId === attempt.attemptId ? (
                    <strong>Selected result</strong>
                  ) : null}
                </article>
              ))}
            </div>
          </PanelBody>
        </Panel>
      ) : null}
      {stacking ? (
        <Panel>
          <PanelHeader
            title="Stacking and Master evidence"
            meta={`${stacking.attempts.length} retained attempt${stacking.attempts.length === 1 ? '' : 's'}`}
          />
          <PanelBody>
            <div className="beta-process-phone-sources">
              {stacking.stackingRecommendations.map((recommendation) => (
                <article
                  className="beta-process-phone-source"
                  key={recommendation.assetId}
                >
                  <b>
                    {recommendation.assetId} · {recommendation.decision}
                  </b>
                  <span>
                    {recommendation.technicallyUsable
                      ? 'Technically usable'
                      : 'No usable Registration transform'}
                  </span>
                  {recommendation.reasons.map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                </article>
              ))}
              {stacking.attempts.map((attempt) => (
                <article
                  className="beta-process-phone-source"
                  key={attempt.attemptId}
                >
                  <b>{attempt.attemptId}</b>
                  <span>
                    {titleCase(attempt.state)} ·{' '}
                    {attempt.stageOutcome ?? 'Pending'} · {attempt.toolIdentity}
                  </span>
                  <span>
                    Exact Registration input{' '}
                    {attempt.upstreamAttemptId ?? 'not selected'}
                  </span>
                  <span>
                    {attempt.stackingInputAssetIds.length} contributing Light
                    {attempt.stackingInputAssetIds.length === 1 ? '' : 's'}
                  </span>
                  {attempt.frameOutcomes.map((outcome) => (
                    <span key={outcome.assetId}>
                      {outcome.assetId} · {outcome.outcome} · {outcome.message}
                      {outcome.diagnostic ? ` · ${outcome.diagnostic}` : ''}
                    </span>
                  ))}
                  {attempt.stackingOutput ? (
                    <span>
                      FITS Master evidence · {attempt.stackingOutput.checksum} ·{' '}
                      {attempt.stackingOutput.diagnostic}
                    </span>
                  ) : null}
                  {attempt.savedMaster ? (
                    <strong>
                      Saved Library Master · {attempt.savedMaster.assetId}
                    </strong>
                  ) : null}
                  {stacking.selectedAttemptId === attempt.attemptId ? (
                    <strong>Selected result</strong>
                  ) : null}
                </article>
              ))}
              {project?.developMasterAssetId ? (
                <article className="beta-process-phone-source">
                  <b>Develop handoff</b>
                  <span>
                    Exact saved Master · {project.developMasterAssetId}
                  </span>
                  <span>Develop operations arrive in Item 3.5.6.</span>
                </article>
              ) : selectedStackingAttempt?.savedMaster ? (
                <article className="beta-process-phone-source">
                  <b>Saved Master ready for Develop</b>
                  <span>{selectedStackingAttempt.savedMaster.assetId}</span>
                </article>
              ) : null}
            </div>
          </PanelBody>
        </Panel>
      ) : null}
      {project?.develop ? (
        <Panel>
          <PanelHeader
            title="Astronomy Develop evidence"
            meta={`${project.develop.attempts.length} retained attempt${project.develop.attempts.length === 1 ? '' : 's'}`}
          />
          <PanelBody>
            <Stack>
              <DataList>
                <DataListItem
                  label="Exact saved Master"
                  value={`${project.develop.base.assetId} · revision ${project.develop.base.assetRevision}`}
                  detail={project.develop.base.checksum}
                />
                <DataListItem
                  label="Current operation"
                  value={developOperationLabel(project.develop.draft.operation)}
                  detail={`Draft revision ${project.develop.draft.revision}`}
                />
                <DataListItem
                  label="Preview"
                  value={
                    project.develop.preview
                      ? `Synchronized draft ${project.develop.preview.draftRevision}`
                      : 'Not synchronized'
                  }
                  detail={project.develop.preview?.checksum}
                />
                <DataListItem
                  label="Applied history"
                  value={`${project.develop.historyCursor} / ${project.develop.history.length}`}
                />
                <DataListItem
                  label="Saved Library results"
                  value={String(project.develop.savedResults.length)}
                />
              </DataList>
              <p>
                Comparison uses the original saved Master and creates no
                history. Evidence is deterministic; astronomy-quality processing
                is not claimed.
              </p>
              <div className="beta-process-phone-sources">
                {project.develop.attempts.map((attempt) => (
                  <article
                    className="beta-process-phone-source"
                    key={attempt.attemptId}
                  >
                    <b>
                      {developOperationLabel(attempt.operation)} ·{' '}
                      {attempt.attemptId}
                    </b>
                    <span>
                      {titleCase(attempt.state)} · input{' '}
                      {attempt.inputCheckpointId} · {attempt.toolIdentity}
                    </span>
                    {attempt.retryOfAttemptId ? (
                      <span>Exact retry of {attempt.retryOfAttemptId}</span>
                    ) : null}
                    {attempt.outputs.map((output) => (
                      <span key={output.outputId}>
                        {titleCase(output.relation)} FITS evidence ·{' '}
                        {output.outputId} · {output.checksum} ·{' '}
                        {output.diagnostic}
                      </span>
                    ))}
                    {attempt.diagnostics.map((diagnostic) => (
                      <span key={diagnostic}>{diagnostic}</span>
                    ))}
                  </article>
                ))}
                {project.develop.savedResults.map((saved) => (
                  <article
                    className="beta-process-phone-source"
                    key={saved.assetId}
                  >
                    <b>Saved Library Develop result</b>
                    <span>
                      {saved.assetId} · revision {saved.assetRevision}
                    </span>
                    <span>
                      Checkpoint {saved.checkpointId} · {saved.checksum}
                    </span>
                  </article>
                ))}
              </div>
            </Stack>
          </PanelBody>
        </Panel>
      ) : null}
      {project ? (
        <Panel>
          <PanelHeader title="All stage evidence" meta="Read only" />
          <PanelBody>
            <div className="beta-process-phone-sources">
              {project.stages.map((stage) => (
                <article
                  className="beta-process-phone-source"
                  key={stage.stage}
                >
                  <b>{stage.stage}</b>
                  <span>
                    Draft {stage.draft.revision} · {stage.attempts.length}{' '}
                    retained attempt{stage.attempts.length === 1 ? '' : 's'}
                  </span>
                  <span>
                    {stage.selectedAttemptId
                      ? `Selected ${stage.selectedAttemptId}`
                      : 'No selected result'}
                  </span>
                  <span>
                    {stage.attempts.some(
                      (attempt) => attempt.basedOnEarlierUpstream,
                    )
                      ? 'Earlier input lineage retained'
                      : 'No earlier lineage result'}
                  </span>
                </article>
              ))}
            </div>
          </PanelBody>
        </Panel>
      ) : null}
      {session && !project ? (
        <Panel>
          <PanelHeader title="Current evidence" meta="Last confirmed" />
          <PanelBody>
            <EvidenceViewport
              label="Processing evidence"
              fallback={
                session.failedAttempt
                  ? 'The last valid image is retained. Retry is available on desktop.'
                  : session.preview?.state === 'ready'
                    ? 'A preview is ready for exact apply on desktop.'
                    : 'The durable current image remains selected.'
              }
            />
          </PanelBody>
        </Panel>
      ) : null}
      <p className="beta-process-phone-protection">
        Read-only: Process mutations require a current desktop owner.
      </p>
    </main>
  )
}

function ProjectSourcesDesktop({
  project,
  pending,
  message,
  assignmentReason,
  navigationReason,
  viewedStage,
  onViewStage,
  command,
}: {
  project: ProcessWorkspace['projects'][number]
  pending: string | undefined
  message: string | undefined
  assignmentReason: string | undefined
  navigationReason: string | undefined
  viewedStage: ProcessWorkspace['projects'][number]['currentStage']
  onViewStage: (
    stage: ProcessWorkspace['projects'][number]['currentStage'],
  ) => void
  command: (command: object, label: string) => void
}) {
  const calibrationAttemptCount =
    project.stages.find((stage) => stage.stage === 'Calibration')?.attempts
      .length ?? 0
  const roles = [
    'Lights',
    'Darks',
    'Flats',
    'Bias',
    'Dark flats',
    'Unassigned',
  ] as const
  return (
    <main
      id="beta-workspace"
      className="beta-desktop-workspace beta-process-workspace beta-process-project"
      aria-busy={!!pending}
    >
      <PageHeader
        eyebrow="Process / Processing Project"
        title={project.name}
        meta={`${project.targetName ?? 'Target not set'} · ${project.sources.length} exact sources`}
        actions={
          <StatusIndicator
            tone={project.warnings.length ? 'warning' : 'positive'}
            label="Sources retained"
            detail={`Project revision ${project.revision}`}
          />
        }
      />
      <div className="beta-process-project-grid">
        <Panel className="beta-process-project-rail">
          <PanelHeader title="Workflow" meta="Persistent project" />
          <PanelBody>
            <Stack>
              <ProcessActionDenial reason={assignmentReason} />
              <StepRail
                label="Processing Project stages"
                activeId={viewedStage.toLowerCase()}
                items={projectSteps(project, viewedStage)}
                onActiveChange={(id: string) => {
                  const stage = projectStageNames.find(
                    (candidate) => candidate.toLowerCase() === id,
                  )
                  if (
                    stage === undefined ||
                    stage === viewedStage ||
                    pending !== undefined
                  )
                    return
                  onViewStage(stage)
                  if (navigationReason === undefined)
                    command(
                      {
                        _tag: 'NavigateProcessingProjectStage',
                        projectId: project.projectId,
                        expectedProjectRevision: project.revision,
                        stage,
                        idempotencyKey: crypto.randomUUID(),
                      },
                      `Opening ${stage}`,
                    )
                }}
              />
              <a
                className="nb-button nb-button--secondary nb-button--medium"
                href={nightbookHref('/library')}
              >
                Add sources from Library
              </a>
            </Stack>
          </PanelBody>
        </Panel>
        <Panel className="beta-process-project-sources">
          <PanelHeader
            title="Sources"
            meta={
              calibrationAttemptCount
                ? `${calibrationAttemptCount} Calibration attempt${calibrationAttemptCount === 1 ? '' : 's'} retained`
                : 'No Calibration work has started'
            }
          />
          <PanelBody>
            <Stack>
              {project.warnings.map((warning) => (
                <AttentionCard
                  key={`${warning.code}-${warning.assetIds.join('-')}`}
                  tone={
                    warning.code === 'TargetConflict' ? 'warning' : 'neutral'
                  }
                  statusLabel={titleCase(warning.code)}
                  title={`${warning.assetIds.length} source${warning.assetIds.length === 1 ? '' : 's'}`}
                  description={warning.message}
                />
              ))}
              <div
                className="beta-process-source-table"
                role="table"
                aria-label="Frozen project sources"
              >
                {project.sources.map((source) => (
                  <div
                    key={source.assetId}
                    role="row"
                    className="beta-process-source-row"
                  >
                    <div role="cell">
                      <b>{source.assetId}</b>
                      <span>
                        Revision {source.assetRevision}
                        {source.captureSetId ? ` · ${source.captureSetId}` : ''}
                      </span>
                    </div>
                    <div role="cell">
                      <b>{source.targetName ?? 'Calibration support'}</b>
                      <span>{source.capturedAt}</span>
                    </div>
                    <div role="cell">
                      <Field
                        label="Source role"
                        hint={`Suggested: ${source.suggestedRole} · Library ${source.libraryRole} / ${source.libraryFormat}`}
                      >
                        <Select
                          value={source.role}
                          disabled={
                            pending !== undefined ||
                            assignmentReason !== undefined
                          }
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            command(
                              {
                                _tag: 'AssignProcessingSourceRole',
                                projectId: project.projectId,
                                expectedProjectRevision: project.revision,
                                assetId: source.assetId,
                                role: event.target.value,
                                idempotencyKey: crypto.randomUUID(),
                              },
                              'Assigning source role',
                            )
                          }
                        >
                          {roles.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div role="cell">
                      <span>
                        {source.provenance.exposureSeconds === undefined
                          ? 'Exposure not recorded'
                          : `${source.provenance.exposureSeconds}s`}
                      </span>
                      <span>
                        {source.provenance.filter ?? 'Filter not recorded'} ·
                        bin {source.provenance.binning ?? '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {message ? (
                <p className="beta-process-message" role="status">
                  {message}
                </p>
              ) : null}
              <AttentionCard
                tone="neutral"
                statusLabel="Intake complete"
                title="Calibration is explicit"
                description="These exact asset revisions are retained as project sources. No Calibration, Registration, or Stacking work starts from source intake."
              />
            </Stack>
          </PanelBody>
        </Panel>
      </div>
    </main>
  )
}

type ProjectDevelop = NonNullable<
  ProcessWorkspace['projects'][number]['develop']
>
type DevelopOperation = ProjectDevelop['draft']['operation']

const developOperationLabel = (operation: DevelopOperation) =>
  operation._tag === 'AstrometryWcs'
    ? 'Astrometry / WCS'
    : operation._tag === 'BackgroundExtraction'
      ? 'Background extraction'
      : operation._tag === 'AstronomyColorCalibration'
        ? 'Astronomy color calibration'
        : operation._tag === 'GreenNoiseReduction'
          ? 'Green-noise reduction'
          : operation._tag === 'Stretch'
            ? 'Stretch'
            : operation._tag === 'ColorAdjustment'
              ? 'Color controls'
              : operation._tag === 'RemoveStars'
                ? 'Remove stars'
                : 'Add stars back'

const initialDevelopOperation = (
  tag: DevelopOperation['_tag'],
): DevelopOperation =>
  tag === 'AstrometryWcs'
    ? { _tag: tag, solverProfile: 'balanced' }
    : tag === 'BackgroundExtraction'
      ? { _tag: tag, sampleDensity: 'balanced' }
      : tag === 'AstronomyColorCalibration'
        ? { _tag: tag, method: 'photometric' }
        : tag === 'GreenNoiseReduction'
          ? { _tag: tag, strength: 0.5 }
          : tag === 'Stretch'
            ? { _tag: tag, method: 'asinh', amount: 0.25 }
            : tag === 'ColorAdjustment'
              ? {
                  _tag: tag,
                  cyan: 0,
                  yellow: 0,
                  red: 0,
                  saturation: 0,
                }
              : tag === 'RemoveStars'
                ? { _tag: tag, mode: 'balanced' }
                : { _tag: tag }

function ProjectDevelopDesktop({
  project,
  actions,
  pending,
  command,
}: {
  project: ProcessWorkspace['projects'][number]
  actions: ReadonlyArray<ProcessAction> | undefined
  pending: string | undefined
  command: (command: object, label: string) => void
}) {
  const develop = project.develop
  const [showOriginal, setShowOriginal] = useState(false)
  const updateReason = processActionReason(
    actions,
    'UpdateProcessingDevelopDraft',
  )
  const syncReason = processActionReason(
    actions,
    'SyncProcessingDevelopPreview',
  )
  const applyReason = processActionReason(
    actions,
    'ApplyProcessingDevelopPreview',
  )
  const undoDraftReason = processActionReason(
    actions,
    'UndoProcessingDevelopDraft',
  )
  const redoDraftReason = processActionReason(
    actions,
    'RedoProcessingDevelopDraft',
  )
  const undoStepReason = processActionReason(
    actions,
    'UndoProcessingDevelopStep',
  )
  const redoStepReason = processActionReason(
    actions,
    'RedoProcessingDevelopStep',
  )
  const retryReason = processActionReason(
    actions,
    'RetryProcessingDevelopApply',
  )
  const saveReason = processActionReason(actions, 'SaveProcessingDevelopResult')

  useEffect(() => {
    if (
      develop === undefined ||
      pending !== undefined ||
      syncReason !== undefined ||
      develop.preview?.draftRevision === develop.draft.revision
    )
      return
    const timeout = window.setTimeout(
      () =>
        command(
          {
            _tag: 'SyncProcessingDevelopPreview',
            projectId: project.projectId,
            expectedProjectRevision: project.revision,
            expectedDevelopDraftRevision: develop.draft.revision,
            idempotencyKey: crypto.randomUUID(),
          },
          'Synchronizing Develop preview',
        ),
      250,
    )
    return () => window.clearTimeout(timeout)
  }, [
    command,
    develop,
    pending,
    project.projectId,
    project.revision,
    syncReason,
  ])

  if (develop === undefined)
    return (
      <AttentionCard
        tone="warning"
        statusLabel="Develop unavailable"
        title="Exact saved Master required"
        description="Save and open a selected Master before using Astronomy Develop."
      />
    )

  const operation = develop.draft.operation
  const currentEntry =
    develop.historyCursor > 0
      ? develop.history[develop.historyCursor - 1]
      : undefined
  const latestAttempt = develop.attempts.at(-1)
  const changeOperation = (next: DevelopOperation) =>
    command(
      {
        _tag: 'UpdateProcessingDevelopDraft',
        projectId: project.projectId,
        expectedProjectRevision: project.revision,
        operation: next,
        idempotencyKey: crypto.randomUUID(),
      },
      `Updating ${developOperationLabel(next)}`,
    )
  const controlsDisabled = pending !== undefined || updateReason !== undefined

  return (
    <div className="beta-process-develop">
      <AttentionCard
        tone="neutral"
        statusLabel="Deterministic Develop evidence"
        title="Exact saved Master stays unchanged"
        description="Preview does not change applied history. Apply creates deterministic FITS evidence and does not claim astronomy-quality processing."
      />
      <div className="beta-process-develop-grid">
        <Stack>
          <EvidenceViewport
            label={
              showOriginal ? 'Original saved Master' : 'Current Develop image'
            }
            fallback={
              showOriginal
                ? `Original saved Master ${develop.base.assetId} · revision ${develop.base.assetRevision}`
                : develop.preview
                  ? `${developOperationLabel(develop.preview.operation)} preview synchronized for draft ${develop.preview.draftRevision}`
                  : currentEntry
                    ? `Applied checkpoint ${currentEntry.checkpointId}`
                    : 'The exact saved Master is the current checkpoint.'
            }
            caption={
              showOriginal
                ? `Reference checksum ${develop.base.checksum}`
                : `Current checkpoint ${currentEntry?.checkpointId ?? 'saved Master base'}`
            }
          />
          <Cluster>
            <Button
              onPointerDown={() => setShowOriginal(true)}
              onPointerUp={() => setShowOriginal(false)}
              onPointerCancel={() => setShowOriginal(false)}
              onPointerLeave={() => setShowOriginal(false)}
            >
              Hold to compare original
            </Button>
            <span className="beta-process-calibration-intro">
              {develop.preview
                ? `Preview ${develop.preview.previewId} · ${develop.preview.toolIdentity}`
                : 'Preview synchronizes after a short pause.'}
            </span>
          </Cluster>
        </Stack>
        <Stack>
          <Field label="Astronomy operation" hint="One current bounded draft">
            <Select
              value={operation._tag}
              disabled={controlsDisabled}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                changeOperation(
                  initialDevelopOperation(
                    event.target.value as DevelopOperation['_tag'],
                  ),
                )
              }
            >
              <option value="AstrometryWcs">Astrometry / WCS</option>
              <option value="BackgroundExtraction">
                Background extraction
              </option>
              <option value="AstronomyColorCalibration">
                Astronomy color calibration
              </option>
              <option value="GreenNoiseReduction">Green-noise reduction</option>
              <option value="Stretch">Stretch</option>
              <option value="ColorAdjustment">Color controls</option>
              <option value="RemoveStars">Remove stars</option>
              <option value="AddStars">Add stars back</option>
            </Select>
          </Field>
          {operation._tag === 'AstrometryWcs' ? (
            <Field label="Solver profile" hint="Retained WCS draft choice">
              <Select
                value={operation.solverProfile}
                disabled={controlsDisabled}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  changeOperation({
                    ...operation,
                    solverProfile: event.target.value as
                      | 'balanced'
                      | 'wide-field',
                  })
                }
              >
                <option value="balanced">Balanced</option>
                <option value="wide-field">Wide field</option>
              </Select>
            </Field>
          ) : operation._tag === 'BackgroundExtraction' ? (
            <Field label="Sample density" hint="Small background model choice">
              <Select
                value={operation.sampleDensity}
                disabled={controlsDisabled}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  changeOperation({
                    ...operation,
                    sampleDensity: event.target.value as 'sparse' | 'balanced',
                  })
                }
              >
                <option value="sparse">Sparse</option>
                <option value="balanced">Balanced</option>
              </Select>
            </Field>
          ) : operation._tag === 'GreenNoiseReduction' ? (
            <Field label="Reduction strength" hint="0 to 1">
              <NumberField
                min={0}
                max={1}
                step={0.05}
                value={operation.strength}
                disabled={controlsDisabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  changeOperation({
                    ...operation,
                    strength: Number(event.target.value),
                  })
                }
              />
            </Field>
          ) : operation._tag === 'Stretch' ? (
            <>
              <Field label="Stretch method" hint="Retained with this draft">
                <Select
                  value={operation.method}
                  disabled={controlsDisabled}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    changeOperation({
                      ...operation,
                      method: event.target.value as
                        | 'asinh'
                        | 'generalized-hyperbolic',
                    })
                  }
                >
                  <option value="asinh">Asinh</option>
                  <option value="generalized-hyperbolic">
                    Generalized hyperbolic
                  </option>
                </Select>
              </Field>
              <Field label="Stretch amount" hint="0 to 1">
                <NumberField
                  min={0}
                  max={1}
                  step={0.05}
                  value={operation.amount}
                  disabled={controlsDisabled}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    changeOperation({
                      ...operation,
                      amount: Number(event.target.value),
                    })
                  }
                />
              </Field>
            </>
          ) : operation._tag === 'ColorAdjustment' ? (
            <div className="beta-process-develop-color">
              {(['cyan', 'yellow', 'red', 'saturation'] as const).map((key) => (
                <Field key={key} label={titleCase(key)} hint="-1 to 1">
                  <NumberField
                    min={-1}
                    max={1}
                    step={0.05}
                    value={operation[key]}
                    disabled={controlsDisabled}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      changeOperation({
                        ...operation,
                        [key]: Number(event.target.value),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          ) : (
            <p className="beta-process-calibration-intro">
              {operation._tag === 'AstronomyColorCalibration'
                ? 'Photometric color calibration uses the retained WCS evidence.'
                : operation._tag === 'RemoveStars'
                  ? 'Apply creates one related starless image and star companion.'
                  : 'Add stars back consumes the exact current starless and companion pair.'}
            </p>
          )}
          <Cluster>
            <Button
              disabled={pending !== undefined || undoDraftReason !== undefined}
              title={undoDraftReason}
              onClick={() =>
                command(
                  {
                    _tag: 'UndoProcessingDevelopDraft',
                    projectId: project.projectId,
                    expectedProjectRevision: project.revision,
                    idempotencyKey: crypto.randomUUID(),
                  },
                  'Undoing Develop settings',
                )
              }
            >
              Undo settings
            </Button>
            <Button
              disabled={pending !== undefined || redoDraftReason !== undefined}
              title={redoDraftReason}
              onClick={() =>
                command(
                  {
                    _tag: 'RedoProcessingDevelopDraft',
                    projectId: project.projectId,
                    expectedProjectRevision: project.revision,
                    idempotencyKey: crypto.randomUUID(),
                  },
                  'Redoing Develop settings',
                )
              }
            >
              Redo settings
            </Button>
            <Button
              tone="primary"
              disabled={pending !== undefined || applyReason !== undefined}
              title={applyReason}
              onClick={() => {
                if (develop.preview === undefined) return
                command(
                  {
                    _tag: 'ApplyProcessingDevelopPreview',
                    projectId: project.projectId,
                    expectedProjectRevision: project.revision,
                    previewId: develop.preview.previewId,
                    idempotencyKey: crypto.randomUUID(),
                  },
                  `Applying ${developOperationLabel(operation)}`,
                )
              }}
            >
              Apply exact preview
            </Button>
          </Cluster>
          <ProcessActionDenial reason={applyReason} />
        </Stack>
      </div>
      <Cluster>
        <Button
          disabled={pending !== undefined || undoStepReason !== undefined}
          title={undoStepReason}
          onClick={() =>
            command(
              {
                _tag: 'UndoProcessingDevelopStep',
                projectId: project.projectId,
                expectedProjectRevision: project.revision,
                idempotencyKey: crypto.randomUUID(),
              },
              'Undoing applied Develop step',
            )
          }
        >
          Undo applied step
        </Button>
        <Button
          disabled={pending !== undefined || redoStepReason !== undefined}
          title={redoStepReason}
          onClick={() =>
            command(
              {
                _tag: 'RedoProcessingDevelopStep',
                projectId: project.projectId,
                expectedProjectRevision: project.revision,
                idempotencyKey: crypto.randomUUID(),
              },
              'Redoing applied Develop step',
            )
          }
        >
          Redo applied step
        </Button>
        {develop.failedAttemptId ? (
          <Button
            disabled={pending !== undefined || retryReason !== undefined}
            title={retryReason}
            onClick={() =>
              command(
                {
                  _tag: 'RetryProcessingDevelopApply',
                  projectId: project.projectId,
                  expectedProjectRevision: project.revision,
                  failedAttemptId: develop.failedAttemptId,
                  idempotencyKey: crypto.randomUUID(),
                },
                'Retrying exact failed Develop operation',
              )
            }
          >
            Retry exact failed operation
          </Button>
        ) : null}
        <Button
          tone="primary"
          disabled={pending !== undefined || saveReason !== undefined}
          title={saveReason}
          onClick={() =>
            command(
              {
                _tag: 'SaveProcessingDevelopResult',
                projectId: project.projectId,
                expectedProjectRevision: project.revision,
                idempotencyKey: crypto.randomUUID(),
              },
              'Saving current Develop result to Library',
            )
          }
        >
          Save current result to Library
        </Button>
      </Cluster>
      <DataList>
        <DataListItem
          label="Saved Master base"
          value={`${develop.base.assetId} · revision ${develop.base.assetRevision}`}
          detail={develop.base.checksum}
        />
        <DataListItem
          label="Applied history"
          value={`${develop.historyCursor} / ${develop.history.length}`}
          detail="Undo and redo move only the project cursor."
        />
        <DataListItem
          label="Saved Library results"
          value={String(develop.savedResults.length)}
          detail="Earlier saved results stay independent of later edits."
        />
      </DataList>
      <div className="beta-process-attempts">
        {develop.attempts.length === 0 ? (
          <p>No Develop attempts yet. Apply starts explicit worker work.</p>
        ) : (
          develop.attempts
            .slice()
            .reverse()
            .map((attempt) => (
              <article key={attempt.attemptId}>
                <b>
                  {developOperationLabel(attempt.operation)} ·{' '}
                  {attempt.attemptId}
                </b>
                <span>
                  {titleCase(attempt.state)} · input {attempt.inputCheckpointId}{' '}
                  · {attempt.toolIdentity}
                </span>
                {attempt.retryOfAttemptId ? (
                  <span>Exact retry of {attempt.retryOfAttemptId}</span>
                ) : null}
                {attempt.outputs.map((output) => (
                  <span key={output.outputId}>
                    {titleCase(output.relation)} FITS evidence ·{' '}
                    {output.outputId} · {output.checksum} · {output.diagnostic}
                  </span>
                ))}
                {attempt.diagnostics.map((diagnostic) => (
                  <span key={diagnostic}>{diagnostic}</span>
                ))}
              </article>
            ))
        )}
      </div>
      {latestAttempt?.state === 'failed' ? (
        <AttentionCard
          tone="danger"
          statusLabel="Apply failed"
          title="Last valid checkpoint retained"
          description={latestAttempt.diagnostics.join(' · ')}
        />
      ) : null}
      {develop.savedResults.map((saved) => (
        <a
          key={saved.assetId}
          href={nightbookHref(
            `/library/assets/${encodeURIComponent(saved.assetId)}`,
          )}
        >
          Saved Library Develop result · {saved.assetId} · {saved.checksum}
        </a>
      ))}
    </div>
  )
}

function ProjectStageDesktop({
  project,
  actions,
  pending,
  message,
  command,
  viewedStage,
  onViewStage,
}: {
  project: ProcessWorkspace['projects'][number]
  actions: ReadonlyArray<ProcessAction> | undefined
  pending: string | undefined
  message: string | undefined
  command: (command: object, label: string) => void
  viewedStage: ProcessWorkspace['projects'][number]['currentStage']
  onViewStage: (
    stage: ProcessWorkspace['projects'][number]['currentStage'],
  ) => void
}) {
  const stage = project.stages.find((item) => item.stage === viewedStage)
  const navigationReason = processActionReason(
    actions,
    'NavigateProcessingProjectStage',
  )
  const updateReason = processActionReason(
    actions,
    'UpdateProcessingStageDraft',
  )
  const runReason = processActionReason(actions, 'RunProcessingProjectStage')
  const undoReason = processActionReason(actions, 'UndoProcessingStageDraft')
  const redoReason = processActionReason(actions, 'RedoProcessingStageDraft')
  const selectReason = processActionReason(
    actions,
    'SelectProcessingStageResult',
  )
  const overrideReason = processActionReason(actions, 'SetCalibrationUseAnyway')
  const registrationChoiceReason = processActionReason(
    actions,
    'SetRegistrationFrameIncluded',
  )
  const stackingChoiceReason = processActionReason(
    actions,
    'SetStackingFrameIncluded',
  )
  const saveMasterReason = processActionReason(
    actions,
    'SaveProcessingProjectMaster',
  )
  const openDevelopReason = processActionReason(
    actions,
    'OpenProcessingProjectDevelop',
  )
  const removeSourceReason = processActionReason(
    actions,
    'RemoveProcessingProjectSource',
  )
  const operation =
    stage?.draft.settings.find((setting) => setting.key === 'operation')
      ?.value ?? 'calibrate-and-debayer'
  const allowUncalibrated =
    stage?.draft.settings.find((setting) => setting.key === 'allowUncalibrated')
      ?.value ?? 'true'
  const calibration = project.stages.find(
    (candidate) => candidate.stage === 'Calibration',
  )
  const selectedCalibration = calibration?.attempts.find(
    (attempt) => attempt.attemptId === calibration.selectedAttemptId,
  )
  const registrationReference =
    stage?.draft.settings.find((setting) => setting.key === 'referenceAssetId')
      ?.value ?? 'auto'
  const alignmentModel =
    stage?.draft.settings.find((setting) => setting.key === 'alignmentModel')
      ?.value ?? 'translation'
  const starDetection =
    stage?.draft.settings.find((setting) => setting.key === 'starDetection')
      ?.value ?? 'balanced'
  const latestRegistration = stage?.attempts
    .filter(
      (attempt) =>
        attempt.state === 'succeeded' && !attempt.basedOnEarlierUpstream,
    )
    .at(-1)
  const registrationStage = project.stages.find(
    (candidate) => candidate.stage === 'Registration',
  )
  const selectedRegistration = registrationStage?.attempts.find(
    (attempt) => attempt.attemptId === registrationStage.selectedAttemptId,
  )
  const stackingStage = project.stages.find(
    (candidate) => candidate.stage === 'Stacking',
  )
  const selectedStack = stackingStage?.attempts.find(
    (attempt) => attempt.attemptId === stackingStage.selectedAttemptId,
  )
  const weighting =
    stage?.draft.settings.find((setting) => setting.key === 'weighting')
      ?.value ?? 'equal'
  const rejection =
    stage?.draft.settings.find((setting) => setting.key === 'rejection')
      ?.value ?? 'winsorized-sigma'
  const updatedSettings = (key: string, value: string) => [
    ...(stage?.draft.settings.filter((setting) => setting.key !== key) ?? []),
    { key, value },
  ]
  return (
    <main
      id="beta-workspace"
      className="beta-desktop-workspace beta-process-workspace beta-process-project"
      aria-busy={!!pending}
    >
      <PageHeader
        eyebrow="Process / Processing Project"
        title={project.name}
        meta={`${viewedStage} · ${project.targetName ?? 'Target not set'}`}
        actions={
          <StatusIndicator
            tone={
              stage?.attempts.some(
                (attempt) =>
                  attempt.state === 'queued' || attempt.state === 'running',
              )
                ? 'warning'
                : 'positive'
            }
            label={`${viewedStage} retained`}
            detail={`Project revision ${project.revision}`}
          />
        }
      />
      <div className="beta-process-project-grid">
        <Panel className="beta-process-project-rail">
          <PanelHeader title="Workflow" meta="Persistent project" />
          <PanelBody>
            <Stack>
              <StepRail
                label="Processing Project stages"
                activeId={viewedStage.toLowerCase()}
                items={projectSteps(project, viewedStage)}
                onActiveChange={(id: string) => {
                  const nextStage = projectStageNames.find(
                    (candidate) => candidate.toLowerCase() === id,
                  )
                  if (
                    nextStage === undefined ||
                    nextStage === viewedStage ||
                    pending !== undefined
                  )
                    return
                  onViewStage(nextStage)
                  if (navigationReason === undefined)
                    command(
                      {
                        _tag: 'NavigateProcessingProjectStage',
                        projectId: project.projectId,
                        expectedProjectRevision: project.revision,
                        stage: nextStage,
                        idempotencyKey: crypto.randomUUID(),
                      },
                      `Opening ${nextStage}`,
                    )
                }}
              />
            </Stack>
          </PanelBody>
        </Panel>
        <Panel className="beta-process-project-sources">
          <PanelHeader
            title={viewedStage}
            meta={
              stage
                ? `${stage.attempts.length} retained attempt${stage.attempts.length === 1 ? '' : 's'}`
                : 'Persistent view'
            }
          />
          <PanelBody>
            <Stack>
              {stage ? (
                <>
                  <AttentionCard
                    tone="neutral"
                    statusLabel={
                      stage.stage === 'Calibration'
                        ? 'Deterministic Calibration evidence'
                        : stage.stage === 'Registration'
                          ? 'Deterministic Registration evidence'
                          : 'Deterministic Stacking evidence'
                    }
                    title="Explicit stage control"
                    description={
                      stage.stage === 'Calibration'
                        ? 'Run freezes exact Lights, support revisions, retained compatibility facts, settings, mismatch choices, and the deterministic adapter identity. It does not claim astronomy calibration quality.'
                        : stage.stage === 'Registration'
                          ? 'Run freezes one exact selected Calibration result, the reference Light, alignment settings, frame choices, and deterministic transform evidence. It does not claim astronomy registration quality.'
                          : 'Run freezes one exact selected Registration result, its viable transforms, weighting, rejection, and frame decisions. The FITS result is deterministic evidence, not an astronomy-quality stack.'
                    }
                  />
                  {stage.stage === 'Calibration' ? (
                    <>
                      <p className="beta-process-calibration-intro">
                        Match evidence uses retained exposure, filter, binning,
                        and camera identity where applicable. Gain and
                        temperature are not retained and are not evaluated.
                      </p>
                      <div className="beta-process-calibration-matches">
                        {stage.calibrationRecommendations.length === 0 ? (
                          <AttentionCard
                            tone="warning"
                            statusLabel="No support selected"
                            title="Calibration support"
                            description="The draft permits deterministic uncalibrated continuation for readable Lights."
                          />
                        ) : (
                          stage.calibrationRecommendations.map(
                            (recommendation) => {
                              const overridden = stage.draft.overrides.some(
                                (override) =>
                                  override.assetId === recommendation.assetId,
                              )
                              const supportLabel = calibrationSupportLabel(
                                recommendation.role,
                              )
                              return (
                                <AttentionCard
                                  key={recommendation.assetId}
                                  tone={
                                    recommendation.compatibility ===
                                    'Compatible'
                                      ? 'positive'
                                      : recommendation.compatibility ===
                                          'Technically unavailable'
                                        ? 'danger'
                                        : 'warning'
                                  }
                                  statusLabel={
                                    recommendation.compatibility ===
                                    'Advisory mismatch'
                                      ? overridden
                                        ? 'Included despite mismatch'
                                        : 'Excluded from Calibration'
                                      : `${recommendation.decision} · ${recommendation.compatibility}`
                                  }
                                  title={`${recommendation.role} · ${recommendation.assetId}`}
                                  description={
                                    <Stack gap={4}>
                                      {recommendation.compatibility ===
                                      'Advisory mismatch' ? (
                                        <p className="beta-process-calibration-intro">
                                          This {supportLabel} does not match the
                                          Lights and will{' '}
                                          {overridden ? '' : 'not '}
                                          be used for the next Calibration run.
                                        </p>
                                      ) : null}
                                      <CalibrationReasonList
                                        reasons={recommendation.reasons}
                                      />
                                    </Stack>
                                  }
                                  actions={
                                    recommendation.compatibility ===
                                    'Advisory mismatch' ? (
                                      <Cluster>
                                        {!overridden ? (
                                          <Button
                                            disabled={
                                              pending !== undefined ||
                                              overrideReason !== undefined
                                            }
                                            title={overrideReason}
                                            onClick={() =>
                                              command(
                                                {
                                                  _tag: 'SetCalibrationUseAnyway',
                                                  projectId: project.projectId,
                                                  expectedProjectRevision:
                                                    project.revision,
                                                  assetId:
                                                    recommendation.assetId,
                                                  useAnyway: true,
                                                  idempotencyKey:
                                                    crypto.randomUUID(),
                                                },
                                                `Including ${supportLabel}`,
                                              )
                                            }
                                          >
                                            Use this {supportLabel}
                                          </Button>
                                        ) : null}
                                        <Button
                                          disabled={
                                            pending !== undefined ||
                                            removeSourceReason !== undefined
                                          }
                                          title={removeSourceReason}
                                          onClick={() =>
                                            command(
                                              {
                                                _tag: 'RemoveProcessingProjectSource',
                                                projectId: project.projectId,
                                                expectedProjectRevision:
                                                  project.revision,
                                                assetId: recommendation.assetId,
                                                idempotencyKey:
                                                  crypto.randomUUID(),
                                              },
                                              `Removing ${supportLabel} from project`,
                                            )
                                          }
                                        >
                                          Remove from project
                                        </Button>
                                      </Cluster>
                                    ) : undefined
                                  }
                                />
                              )
                            },
                          )
                        )}
                      </div>
                    </>
                  ) : null}
                  {stage.stage === 'Registration' ? (
                    <>
                      <DataList>
                        <DataListItem
                          label="Selected Calibration result"
                          value={
                            selectedCalibration?.attemptId ??
                            'Run Calibration first'
                          }
                          detail={
                            selectedCalibration
                              ? `${selectedCalibration.outputs.length} calibrated Light output${selectedCalibration.outputs.length === 1 ? '' : 's'}`
                              : 'Registration cannot run without an exact selected result.'
                          }
                        />
                      </DataList>
                      {latestRegistration?.frameOutcomes.some(
                        (outcome) => outcome.outcome === 'Warning',
                      ) ? (
                        <div className="beta-process-calibration-matches">
                          {latestRegistration.frameOutcomes
                            .filter((outcome) => outcome.outcome === 'Warning')
                            .map((outcome) => {
                              const transform =
                                latestRegistration.registrationTransforms.find(
                                  (candidate) =>
                                    candidate.assetId === outcome.assetId,
                                )
                              const included =
                                stage.draft.registrationInclusions.some(
                                  (choice) =>
                                    choice.assetId === outcome.assetId,
                                )
                              return (
                                <AttentionCard
                                  key={outcome.assetId}
                                  tone="warning"
                                  statusLabel={
                                    included
                                      ? 'Included with alignment warning'
                                      : 'Not selected for next Stack input'
                                  }
                                  title={`Light · ${outcome.assetId}`}
                                  description={`${outcome.message} ${transform?.diagnostic ?? outcome.diagnostic ?? ''}`}
                                  actions={
                                    transform?.usable ? (
                                      <Button
                                        disabled={
                                          pending !== undefined ||
                                          registrationChoiceReason !== undefined
                                        }
                                        title={registrationChoiceReason}
                                        onClick={() =>
                                          command(
                                            {
                                              _tag: 'SetRegistrationFrameIncluded',
                                              projectId: project.projectId,
                                              expectedProjectRevision:
                                                project.revision,
                                              assetId: outcome.assetId,
                                              included: !included,
                                              idempotencyKey:
                                                crypto.randomUUID(),
                                            },
                                            included
                                              ? 'Keeping Light out of Stack input'
                                              : 'Including Light in Stack input',
                                          )
                                        }
                                      >
                                        {included
                                          ? 'Keep out of Stack input'
                                          : 'Include this Light'}
                                      </Button>
                                    ) : undefined
                                  }
                                />
                              )
                            })}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {stage.stage === 'Stacking' ? (
                    <>
                      <DataList>
                        <DataListItem
                          label="Selected Registration result"
                          value={
                            selectedRegistration?.attemptId ??
                            'Run Registration first'
                          }
                          detail={`${selectedRegistration?.viableAssetIds.length ?? 0} viable Light${selectedRegistration?.viableAssetIds.length === 1 ? '' : 's'} with exact retained transforms`}
                        />
                      </DataList>
                      <div className="beta-process-calibration-matches">
                        {stage.stackingRecommendations.map((recommendation) => {
                          const choice = stage.draft.stackingFrameChoices.find(
                            (candidate) =>
                              candidate.assetId === recommendation.assetId,
                          )
                          const included =
                            choice?.decision === 'Include' ||
                            (choice === undefined &&
                              recommendation.decision === 'Include')
                          return (
                            <AttentionCard
                              key={recommendation.assetId}
                              tone={
                                !recommendation.technicallyUsable
                                  ? 'danger'
                                  : recommendation.decision === 'Include'
                                    ? 'positive'
                                    : 'warning'
                              }
                              statusLabel={
                                included
                                  ? recommendation.decision === 'Review'
                                    ? 'Included after review'
                                    : 'Included in this Stack draft'
                                  : 'Excluded from this Stack draft'
                              }
                              title={`Light · ${recommendation.assetId}`}
                              description={recommendation.reasons.join(' ')}
                              actions={
                                recommendation.technicallyUsable ? (
                                  <Button
                                    disabled={
                                      pending !== undefined ||
                                      stackingChoiceReason !== undefined
                                    }
                                    title={stackingChoiceReason}
                                    onClick={() =>
                                      command(
                                        {
                                          _tag: 'SetStackingFrameIncluded',
                                          projectId: project.projectId,
                                          expectedProjectRevision:
                                            project.revision,
                                          assetId: recommendation.assetId,
                                          included: !included,
                                          idempotencyKey: crypto.randomUUID(),
                                        },
                                        included
                                          ? 'Excluding Light from this Stack'
                                          : 'Including Light in this Stack',
                                      )
                                    }
                                  >
                                    {included
                                      ? 'Exclude this Light'
                                      : 'Include this Light'}
                                  </Button>
                                ) : undefined
                              }
                            />
                          )
                        })}
                      </div>
                    </>
                  ) : null}
                  <Field
                    label={
                      stage.stage === 'Calibration'
                        ? 'Calibration operation'
                        : stage.stage === 'Registration'
                          ? 'Reference Light'
                          : 'Frame weighting'
                    }
                    hint={`Draft revision ${stage.draft.revision}`}
                  >
                    <Select
                      value={
                        stage.stage === 'Calibration'
                          ? operation
                          : stage.stage === 'Registration'
                            ? registrationReference
                            : weighting
                      }
                      disabled={
                        pending !== undefined || updateReason !== undefined
                      }
                      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                        command(
                          {
                            _tag: 'UpdateProcessingStageDraft',
                            projectId: project.projectId,
                            expectedProjectRevision: project.revision,
                            stage: stage.stage,
                            settings: updatedSettings(
                              stage.stage === 'Calibration'
                                ? 'operation'
                                : stage.stage === 'Registration'
                                  ? 'referenceAssetId'
                                  : 'weighting',
                              event.target.value,
                            ),
                            idempotencyKey: crypto.randomUUID(),
                          },
                          `Updating ${stage.stage} draft`,
                        )
                      }
                    >
                      {stage.stage === 'Calibration' ? (
                        <>
                          <option value="calibrate-and-debayer">
                            Calibrate and debayer
                          </option>
                          <option value="calibrate-only">Calibrate only</option>
                        </>
                      ) : stage.stage === 'Registration' ? (
                        <>
                          <option value="auto">
                            Auto · first calibrated Light
                          </option>
                          {selectedCalibration?.outputs.map((output) => (
                            <option
                              key={output.sourceAssetId}
                              value={output.sourceAssetId}
                            >
                              {output.sourceAssetId} · revision{' '}
                              {output.sourceAssetRevision}
                            </option>
                          ))}
                        </>
                      ) : (
                        <>
                          <option value="equal">Equal contribution</option>
                          <option value="signal-weighted">
                            Signal weighted
                          </option>
                        </>
                      )}
                    </Select>
                  </Field>
                  {stage.stage === 'Calibration' ? (
                    <Field
                      label="Missing support policy"
                      hint="A draft choice retained by undo and redo"
                    >
                      <Select
                        value={allowUncalibrated}
                        disabled={
                          pending !== undefined || updateReason !== undefined
                        }
                        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                          command(
                            {
                              _tag: 'UpdateProcessingStageDraft',
                              projectId: project.projectId,
                              expectedProjectRevision: project.revision,
                              stage: stage.stage,
                              settings: updatedSettings(
                                'allowUncalibrated',
                                event.target.value,
                              ),
                              idempotencyKey: crypto.randomUUID(),
                            },
                            'Updating missing support policy',
                          )
                        }
                      >
                        <option value="true">Allow with warning</option>
                        <option value="false">Require selected support</option>
                      </Select>
                    </Field>
                  ) : stage.stage === 'Registration' ? (
                    <>
                      <Field
                        label="Alignment model"
                        hint="A small deterministic adapter setting"
                      >
                        <Select
                          value={alignmentModel}
                          disabled={
                            pending !== undefined || updateReason !== undefined
                          }
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            command(
                              {
                                _tag: 'UpdateProcessingStageDraft',
                                projectId: project.projectId,
                                expectedProjectRevision: project.revision,
                                stage: 'Registration',
                                settings: updatedSettings(
                                  'alignmentModel',
                                  event.target.value,
                                ),
                                idempotencyKey: crypto.randomUUID(),
                              },
                              'Updating alignment model',
                            )
                          }
                        >
                          <option value="translation">Translation</option>
                          <option value="affine">Affine</option>
                        </Select>
                      </Field>
                      <Field
                        label="Star detection"
                        hint="Balanced keeps reviewable transforms; strict excludes them"
                      >
                        <Select
                          value={starDetection}
                          disabled={
                            pending !== undefined || updateReason !== undefined
                          }
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            command(
                              {
                                _tag: 'UpdateProcessingStageDraft',
                                projectId: project.projectId,
                                expectedProjectRevision: project.revision,
                                stage: 'Registration',
                                settings: updatedSettings(
                                  'starDetection',
                                  event.target.value,
                                ),
                                idempotencyKey: crypto.randomUUID(),
                              },
                              'Updating star detection',
                            )
                          }
                        >
                          <option value="balanced">Balanced</option>
                          <option value="strict">Strict</option>
                        </Select>
                      </Field>
                    </>
                  ) : stage.stage === 'Stacking' ? (
                    <Field
                      label="Rejection"
                      hint="A small retained draft setting"
                    >
                      <Select
                        value={rejection}
                        disabled={
                          pending !== undefined || updateReason !== undefined
                        }
                        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                          command(
                            {
                              _tag: 'UpdateProcessingStageDraft',
                              projectId: project.projectId,
                              expectedProjectRevision: project.revision,
                              stage: 'Stacking',
                              settings: updatedSettings(
                                'rejection',
                                event.target.value,
                              ),
                              idempotencyKey: crypto.randomUUID(),
                            },
                            'Updating rejection setting',
                          )
                        }
                      >
                        <option value="winsorized-sigma">
                          Winsorized sigma
                        </option>
                        <option value="none">No rejection</option>
                      </Select>
                    </Field>
                  ) : null}
                  <Cluster>
                    <Button
                      disabled={
                        pending !== undefined || undoReason !== undefined
                      }
                      title={undoReason}
                      onClick={() =>
                        command(
                          {
                            _tag: 'UndoProcessingStageDraft',
                            projectId: project.projectId,
                            expectedProjectRevision: project.revision,
                            stage: stage.stage,
                            idempotencyKey: crypto.randomUUID(),
                          },
                          'Undoing draft',
                        )
                      }
                    >
                      Undo draft
                    </Button>
                    <Button
                      disabled={
                        pending !== undefined || redoReason !== undefined
                      }
                      title={redoReason}
                      onClick={() =>
                        command(
                          {
                            _tag: 'RedoProcessingStageDraft',
                            projectId: project.projectId,
                            expectedProjectRevision: project.revision,
                            stage: stage.stage,
                            idempotencyKey: crypto.randomUUID(),
                          },
                          'Redoing draft',
                        )
                      }
                    >
                      Redo draft
                    </Button>
                    <Button
                      tone="primary"
                      disabled={
                        pending !== undefined || runReason !== undefined
                      }
                      title={runReason}
                      onClick={() =>
                        command(
                          {
                            _tag: 'RunProcessingProjectStage',
                            projectId: project.projectId,
                            expectedProjectRevision: project.revision,
                            stage: stage.stage,
                            idempotencyKey: crypto.randomUUID(),
                          },
                          `${stage.attempts.length ? 'Rerunning' : 'Running'} ${stage.stage}`,
                        )
                      }
                    >
                      {stage.attempts.length ? 'Rerun' : 'Run'} {stage.stage}
                    </Button>
                  </Cluster>
                  <ProcessActionDenial reason={runReason} />
                  <div className="beta-process-attempts">
                    {stage.attempts.length === 0 ? (
                      <p>
                        No attempts yet. Work starts only after explicit Run.
                      </p>
                    ) : (
                      stage.attempts
                        .slice()
                        .reverse()
                        .map((attempt) => (
                          <article key={attempt.attemptId}>
                            <b>{attempt.attemptId}</b>
                            <span>
                              {titleCase(attempt.state)} · draft{' '}
                              {attempt.draftRevision}
                            </span>
                            <span>
                              {attempt.sourceRevisions.length} exact source
                              inputs · {attempt.toolIdentity}
                            </span>
                            <span>
                              {attempt.upstreamAttemptId
                                ? `Upstream ${attempt.upstreamAttemptId}`
                                : 'Source revisions are the upstream input'}
                            </span>
                            {attempt.basedOnEarlierUpstream ? (
                              <strong>
                                Based on earlier source or upstream input
                              </strong>
                            ) : null}
                            {attempt.resultId ? (
                              <span>
                                {attempt.resultId} ·{' '}
                                {attempt.stage === 'Calibration'
                                  ? 'deterministic Calibration evidence'
                                  : attempt.stage === 'Registration'
                                    ? 'deterministic Registration evidence'
                                    : 'deterministic Stacking evidence'}
                              </span>
                            ) : null}
                            {attempt.stage === 'Calibration' ? (
                              <>
                                <span>
                                  {attempt.overrides.length} mismatched support
                                  inclusion
                                  {attempt.overrides.length === 1
                                    ? ''
                                    : 's'} · {attempt.stageOutcome ?? 'Pending'}
                                </span>
                                {attempt.frameOutcomes.map((outcome) => (
                                  <span key={outcome.assetId}>
                                    {outcome.assetId} · {outcome.outcome} ·{' '}
                                    revision {outcome.assetRevision} ·{' '}
                                    {outcome.message}
                                    {outcome.diagnostic
                                      ? ` · ${outcome.diagnostic}`
                                      : ''}
                                  </span>
                                ))}
                                {attempt.outputs.length ? (
                                  <span>
                                    {attempt.outputs.length} deterministic JSON
                                    evidence output
                                    {attempt.outputs.length === 1 ? '' : 's'}
                                  </span>
                                ) : null}
                                {attempt.diagnostics.map((diagnostic) => (
                                  <span key={diagnostic}>{diagnostic}</span>
                                ))}
                              </>
                            ) : attempt.stage === 'Registration' ? (
                              <>
                                <span>
                                  {attempt.viableAssetIds.length} Light
                                  {attempt.viableAssetIds.length === 1
                                    ? ''
                                    : 's'}{' '}
                                  selected for the next Stack input ·{' '}
                                  {attempt.stageOutcome ?? 'Pending'}
                                </span>
                                {attempt.frameOutcomes.map((outcome) => (
                                  <span key={outcome.assetId}>
                                    {outcome.assetId} · {outcome.outcome} ·{' '}
                                    revision {outcome.assetRevision} ·{' '}
                                    {outcome.message}
                                    {outcome.diagnostic
                                      ? ` · ${outcome.diagnostic}`
                                      : ''}
                                  </span>
                                ))}
                                <span>
                                  {attempt.registrationTransforms.length}{' '}
                                  retained transform
                                  {attempt.registrationTransforms.length === 1
                                    ? ''
                                    : 's'}
                                </span>
                                {attempt.diagnostics.map((diagnostic) => (
                                  <span key={diagnostic}>{diagnostic}</span>
                                ))}
                              </>
                            ) : attempt.stage === 'Stacking' ? (
                              <>
                                <span>
                                  {attempt.stackingInputAssetIds.length} Light
                                  {attempt.stackingInputAssetIds.length === 1
                                    ? ''
                                    : 's'}{' '}
                                  contributed ·{' '}
                                  {attempt.stageOutcome ?? 'Pending'}
                                </span>
                                {attempt.frameOutcomes.map((outcome) => (
                                  <span key={outcome.assetId}>
                                    {outcome.assetId} · {outcome.outcome} ·{' '}
                                    {outcome.message}
                                  </span>
                                ))}
                                {attempt.stackingOutput ? (
                                  <span>
                                    FITS Master evidence ·{' '}
                                    {attempt.stackingOutput.checksum}
                                  </span>
                                ) : null}
                                {attempt.savedMaster ? (
                                  <strong>
                                    Saved to Library ·{' '}
                                    {attempt.savedMaster.assetId}
                                  </strong>
                                ) : null}
                                {attempt.diagnostics.map((diagnostic) => (
                                  <span key={diagnostic}>{diagnostic}</span>
                                ))}
                              </>
                            ) : null}
                            {stage.selectedAttemptId === attempt.attemptId ? (
                              <strong>Selected result</strong>
                            ) : attempt.state === 'succeeded' ? (
                              <Button
                                disabled={
                                  pending !== undefined ||
                                  selectReason !== undefined
                                }
                                title={selectReason}
                                onClick={() =>
                                  command(
                                    {
                                      _tag: 'SelectProcessingStageResult',
                                      projectId: project.projectId,
                                      expectedProjectRevision: project.revision,
                                      stage: stage.stage,
                                      attemptId: attempt.attemptId,
                                      idempotencyKey: crypto.randomUUID(),
                                    },
                                    `Selecting ${stage.stage} result`,
                                  )
                                }
                              >
                                Select result
                              </Button>
                            ) : null}
                          </article>
                        ))
                    )}
                  </div>
                </>
              ) : viewedStage === 'Master' ? (
                <>
                  <AttentionCard
                    tone={
                      selectedStack?.stackingOutput ? 'positive' : 'warning'
                    }
                    statusLabel={
                      selectedStack?.savedMaster
                        ? 'Saved Library Master'
                        : 'Unsaved selected Stack result'
                    }
                    title="Linear Master"
                    description={
                      selectedStack?.stackingOutput
                        ? `${selectedStack.stackingOutput.includedAssetIds.length} Lights · ${selectedStack.stackingOutput.diagnostic}`
                        : 'Run Stacking and select a result before saving a Master.'
                    }
                  />
                  {selectedStack ? (
                    <DataList>
                      <DataListItem
                        label="Stack attempt"
                        value={selectedStack.attemptId}
                      />
                      <DataListItem
                        label="Registration attempt"
                        value={selectedStack.upstreamAttemptId ?? 'Unavailable'}
                      />
                      <DataListItem
                        label="Library asset"
                        value={
                          selectedStack.savedMaster?.assetId ?? 'Not saved yet'
                        }
                      />
                    </DataList>
                  ) : null}
                  <Cluster>
                    {!selectedStack?.savedMaster ? (
                      <Button
                        tone="primary"
                        disabled={
                          pending !== undefined ||
                          saveMasterReason !== undefined
                        }
                        title={saveMasterReason}
                        onClick={() =>
                          command(
                            {
                              _tag: 'SaveProcessingProjectMaster',
                              projectId: project.projectId,
                              expectedProjectRevision: project.revision,
                              idempotencyKey: crypto.randomUUID(),
                            },
                            'Saving selected Master to Library',
                          )
                        }
                      >
                        Save Master to Library
                      </Button>
                    ) : (
                      <Button
                        tone="primary"
                        disabled={
                          pending !== undefined ||
                          openDevelopReason !== undefined
                        }
                        title={openDevelopReason}
                        onClick={() => {
                          command(
                            {
                              _tag: 'OpenProcessingProjectDevelop',
                              projectId: project.projectId,
                              expectedProjectRevision: project.revision,
                              assetId: selectedStack.savedMaster?.assetId,
                              idempotencyKey: crypto.randomUUID(),
                            },
                            'Opening saved Master in Develop',
                          )
                          onViewStage('Develop')
                        }}
                      >
                        Open saved Master in Develop
                      </Button>
                    )}
                  </Cluster>
                </>
              ) : (
                <ProjectDevelopDesktop
                  project={project}
                  actions={actions}
                  pending={pending}
                  command={command}
                />
              )}
              {message ? (
                <p className="beta-process-message" role="status">
                  {message}
                </p>
              ) : null}
            </Stack>
          </PanelBody>
        </Panel>
      </div>
    </main>
  )
}

function SourceEntry({
  assetId,
  handoff,
  state,
  disabled,
  disabledReason,
  start,
  onReviewCandidate,
}: {
  assetId: string | undefined
  handoff: ProcessSourceHandoff | undefined
  state: HandoffState | undefined
  disabled: boolean
  disabledReason: string | undefined
  start: () => void
  onReviewCandidate:
    | ((assetId: string, request: ReviewRequest) => Promise<void>)
    | undefined
}) {
  const [reviewing, setReviewing] = useState<string>()
  const recommendation = handoff?.recommendedSet
  const supported =
    handoff?.role === 'original' ||
    handoff?.role === 'linearMaster' ||
    (recommendation?.candidateCount ?? 0) > 0
  const local = handoff?.availability === 'availableLocally'
  const detail =
    state === 'loading'
      ? 'Resolving the selected Library source.'
      : state === 'not-found'
        ? 'The selected Library source was not found.'
        : state === 'not-local'
          ? 'The selected source is not available locally.'
          : state === 'unavailable'
            ? 'Source evidence is unavailable.'
            : handoff
              ? `${titleCase(handoff.role)} · ${handoff.format} · ${handoff.availability}`
              : 'Choose a supported local source in Library.'
  return (
    <div className="beta-process-empty">
      <AttentionCard
        tone={
          handoff && supported && local
            ? 'positive'
            : state
              ? 'danger'
              : 'neutral'
        }
        statusLabel={handoff ? 'Library source resolved' : 'No active session'}
        title={assetId ?? 'Open a Library source'}
        description={detail}
        evidence={
          handoff && (!supported || !local)
            ? 'Only local originals and linear masters can start Process.'
            : undefined
        }
        actions={
          handoff && supported && local ? (
            <Stack gap={4}>
              {recommendation ? (
                <DataList>
                  <DataListItem
                    label="Candidate set"
                    value={String(recommendation.candidateCount)}
                    detail="One compatible Library group"
                  />
                  <DataListItem
                    label="Included"
                    value={String(recommendation.includedCount)}
                  />
                  <DataListItem
                    label="Excluded"
                    value={String(recommendation.excludedCount)}
                  />
                  <DataListItem
                    label="Needs review"
                    value={String(recommendation.needsReviewCount)}
                  />
                </DataList>
              ) : null}
              {recommendation?.candidates
                .filter(
                  (candidate) => candidate.effectiveDecision === 'needsReview',
                )
                .slice(0, 3)
                .map((candidate) => (
                  <div className="beta-process-review" key={candidate.assetId}>
                    <p>
                      <b>{candidate.assetId}</b> · {candidate.reason}
                      {' · '}sharpness {candidate.measuredSharpness}
                    </p>
                    <EvidenceViewport
                      label={`Review evidence for ${candidate.assetId}`}
                      fallback="A renderable preview is not available for this candidate."
                      overlays={
                        <MetricOverlay
                          label="Candidate metrics"
                          items={[
                            {
                              id: 'sharpness',
                              label: 'Sharpness',
                              value: String(candidate.measuredSharpness),
                            },
                            {
                              id: 'group',
                              label: 'Group',
                              value: `${recommendation.candidateCount} candidates`,
                            },
                          ]}
                        />
                      }
                      caption={candidate.reason}
                    />
                    <Cluster>
                      {(['accepted', 'rejected'] as const).map((decision) => (
                        <Button
                          key={decision}
                          disabled={
                            reviewing !== undefined ||
                            disabled ||
                            onReviewCandidate === undefined
                          }
                          onClick={() => {
                            setReviewing(candidate.assetId)
                            if (onReviewCandidate === undefined) return
                            void onReviewCandidate(candidate.assetId, {
                              expectedAssetRevision: candidate.assetRevision,
                              expectedReviewRevision: candidate.reviewRevision,
                              decision,
                              idempotencyKey: crypto.randomUUID(),
                            }).finally(() => setReviewing(undefined))
                          }}
                        >
                          {decision === 'accepted' ? 'Accept' : 'Reject'}
                        </Button>
                      ))}
                    </Cluster>
                  </div>
                ))}
              <Button
                tone="primary"
                disabled={
                  disabled ||
                  reviewing !== undefined ||
                  (recommendation?.needsReviewCount ?? 0) > 0
                }
                title={disabledReason}
                onClick={start}
              >
                Build recommended set
              </Button>
              <ProcessActionDenial
                reason={disabled ? disabledReason : undefined}
              />
            </Stack>
          ) : (
            <a
              className="nb-button nb-button--secondary nb-button--medium"
              href={nightbookHref('/library')}
            >
              Open Library
            </a>
          )
        }
      />
    </div>
  )
}

function ProcessDesktop({
  projection,
  workspace,
  sourceAssetId,
  sourceHandoff,
  sourceHandoffState,
  pending,
  message,
  amount,
  adapter,
  setAmount,
  setAdapter,
  command,
  onReviewCandidate,
}: {
  projection: Projection
  workspace: ProcessWorkspace | undefined
  sourceAssetId: string | undefined
  sourceHandoff: ProcessSourceHandoff | undefined
  sourceHandoffState: HandoffState | undefined
  pending: string | undefined
  message: string | undefined
  amount: number
  adapter: string
  setAmount: (value: number) => void
  setAdapter: (value: string) => void
  command: (command: object, label: string) => void
  onReviewCandidate:
    | ((assetId: string, request: ReviewRequest) => Promise<void>)
    | undefined
}) {
  const session = selectedSession(workspace)
  const project = selectedProject(workspace)
  const buildWork = workspace?.work?.find(
    (work) => work.sessionId === session?.sessionId && work.kind === 'build',
  )
  const [showReference, setShowReference] = useState(false)
  const [viewedProjectStage, setViewedProjectStage] =
    useState<ProjectStageName>()
  const authorityReason = processCommandsProtected(projection)
    ? 'Current desktop owner authority is not confirmed.'
    : undefined
  const startReason =
    authorityReason ??
    processActionReason(workspace?.actions, 'StartProcessingSession')
  if (sourceAssetId !== undefined)
    return (
      <main
        id="beta-workspace"
        className="beta-desktop-workspace beta-process-workspace"
      >
        <PageHeader
          eyebrow="Process / Library handoff"
          title="Review the exact processing source"
          actions={
            <StatusIndicator
              label={message ?? (workspace ? 'Ready' : 'Loading')}
              tone={workspace ? 'positive' : 'neutral'}
            />
          }
        />
        <SourceEntry
          assetId={sourceAssetId}
          handoff={sourceHandoff}
          state={sourceHandoffState}
          disabled={startReason !== undefined || !!pending}
          disabledReason={startReason}
          start={() =>
            sourceHandoff &&
            command(
              {
                _tag: 'StartProcessingSession',
                selection: 'recommended',
                sourceAssetIds: sourceHandoff.recommendedSet?.candidates
                  .filter(
                    (candidate) => candidate.effectiveDecision === 'include',
                  )
                  .map((candidate) => candidate.assetId) ?? [
                  sourceHandoff.sourceAssetId,
                ],
                idempotencyKey: crypto.randomUUID(),
              },
              'Starting session',
            )
          }
          onReviewCandidate={onReviewCandidate}
        />
      </main>
    )
  if (project) {
    const viewedStage = viewedProjectStage ?? project.currentStage
    const projectActions = workspace?.projectActions.find(
      (entry) => entry.projectId === project.projectId,
    )?.actions
    const assignmentReason =
      authorityReason ??
      processActionReason(projectActions, 'AssignProcessingSourceRole')
    if (viewedStage !== 'Sources')
      return (
        <ProjectStageDesktop
          project={project}
          actions={projectActions}
          pending={pending}
          message={message}
          command={command}
          viewedStage={viewedStage}
          onViewStage={setViewedProjectStage}
        />
      )
    return (
      <ProjectSourcesDesktop
        project={project}
        pending={pending}
        message={message}
        assignmentReason={assignmentReason}
        navigationReason={
          authorityReason ??
          processActionReason(projectActions, 'NavigateProcessingProjectStage')
        }
        viewedStage={viewedStage}
        onViewStage={setViewedProjectStage}
        command={command}
      />
    )
  }
  if (!session)
    return (
      <main
        id="beta-workspace"
        className="beta-desktop-workspace beta-process-workspace"
      >
        <PageHeader
          eyebrow="Process / Durable session"
          title="Open a processing source"
          actions={
            <StatusIndicator
              label={message ?? (workspace ? 'Ready' : 'Loading')}
              tone={workspace ? 'positive' : 'neutral'}
            />
          }
        />
        <SourceEntry
          assetId={sourceAssetId}
          handoff={sourceHandoff}
          state={sourceHandoffState}
          disabled={startReason !== undefined || !!pending}
          disabledReason={startReason}
          start={() =>
            sourceHandoff &&
            command(
              {
                _tag: 'StartProcessingSession',
                selection: 'recommended',
                sourceAssetIds: sourceHandoff.recommendedSet?.candidates
                  .filter(
                    (candidate) => candidate.effectiveDecision === 'include',
                  )
                  .map((candidate) => candidate.assetId) ?? [
                  sourceHandoff.sourceAssetId,
                ],
                idempotencyKey: crypto.randomUUID(),
              },
              'Starting session',
            )
          }
          onReviewCandidate={onReviewCandidate}
        />
      </main>
    )

  const outputId = currentOutputId(session)
  const exactReady =
    session.preview?.state === 'ready' && session.preview.previewOutputId
  const actionReason = (action: ProcessActionName) =>
    authorityReason ??
    processActionReason(
      workspace?.sessionActions.find(
        (projection) => projection.sessionId === session.sessionId,
      )?.actions,
      action,
    )
  const protectedAction = (action: ProcessActionName) =>
    !!pending || actionReason(action) !== undefined
  const previewState = session.failedAttempt
    ? 'Failed attempt'
    : session.activeAttempt
      ? 'Applying operation'
      : session.preview
        ? `Preview ${session.preview.state}`
        : 'Current image'
  const previewFallback = showReference
    ? 'Reference comparison · durable base image'
    : session.phase === 'build'
      ? 'A durable linear master is building from protected local Library sources.'
      : session.failedAttempt
        ? 'The last valid image and checkpoint remain durable.'
        : exactReady
          ? 'The exact preview is ready to apply.'
          : 'The durable current image remains visible while an operation is prepared.'
  return (
    <main
      id="beta-workspace"
      className="beta-desktop-workspace beta-process-workspace"
      aria-busy={!!pending}
    >
      <PageHeader
        eyebrow="Process / Durable session"
        title={
          session.phase === 'build' ? 'Build a linear master' : 'Develop image'
        }
        actions={
          <StatusIndicator
            tone={session.failedAttempt ? 'danger' : 'positive'}
            label={
              session.failedAttempt
                ? 'Checkpoint protected'
                : 'Session protected'
            }
            detail={`rev ${session.revision}`}
          />
        }
      />
      <div className="beta-process-grid">
        <Panel className="beta-process-source">
          <PanelHeader title="Source set" meta={session.lifecycle} />
          <PanelBody>
            <Stack>
              <DataList>
                <DataListItem label="Session" value={session.sessionId} />
                <DataListItem
                  label="Sources"
                  value={String(session.sources.length)}
                  detail={session.sources
                    .map((source) => source.assetId)
                    .join(', ')}
                />
                <DataListItem
                  label="History"
                  value={`${session.historyPosition} / ${session.history.length}`}
                />
                <DataListItem
                  label="Saved"
                  value={String(session.savedAssetIds.length)}
                />
              </DataList>
              <StepRail
                label="Process lifecycle"
                activeId={session.phase === 'build' ? 'build' : 'develop'}
                items={lifecycleSteps(session)}
              />
              {session.phase === 'build' ? (
                <StepRail
                  label="Build stages"
                  activeId={
                    buildStage(
                      workspace?.work?.find(
                        (work) =>
                          work.sessionId === session.sessionId &&
                          work.kind === 'build',
                      )?.stage,
                    ) ?? 'validate'
                  }
                  items={buildStageItems(
                    buildStage(
                      workspace?.work?.find(
                        (work) =>
                          work.sessionId === session.sessionId &&
                          work.kind === 'build',
                      )?.stage,
                    ),
                  )}
                />
              ) : null}
              {session.lifecycle === 'unfinished' ? (
                <Stack gap={4}>
                  <Button
                    disabled={protectedAction('ResumeProcessingSession')}
                    title={actionReason('ResumeProcessingSession')}
                    onClick={() =>
                      command(
                        {
                          _tag: 'ResumeProcessingSession',
                          sessionId: session.sessionId,
                          expectedProcessingRevision: session.revision,
                        },
                        'Resuming session',
                      )
                    }
                  >
                    Resume session
                  </Button>
                  <ProcessActionDenial
                    reason={actionReason('ResumeProcessingSession')}
                  />
                </Stack>
              ) : null}
            </Stack>
          </PanelBody>
        </Panel>
        <Panel className="beta-process-stage">
          <PanelHeader
            title={previewState}
            meta={
              session.preview
                ? titleCase(session.preview.state)
                : 'Authoritative image'
            }
          />
          <PanelBody>
            <Stack>
              <EvidenceViewport
                label="Processing image evidence"
                fit="fill"
                fallback={previewFallback}
                overlays={
                  <MetricOverlay
                    label="Processing facts"
                    items={[
                      { id: 'phase', label: 'Phase', value: session.phase },
                      {
                        id: 'history',
                        label: 'History',
                        value: `${session.historyPosition}/${session.history.length}`,
                      },
                      {
                        id: 'preview',
                        label: 'Preview',
                        value: session.preview?.state ?? 'none',
                      },
                    ]}
                  />
                }
                caption="Process state is durable; preview and Library save remain separate."
              />
              {session.failedAttempt ? (
                <AttentionCard
                  tone="danger"
                  statusLabel="Processing stage failed"
                  title="Last valid checkpoint retained"
                  description="Retry is bound to the exact failed attempt and checkpoint."
                  evidence={
                    <DataList>
                      <DataListItem
                        label="Operation"
                        value={session.failedAttempt.operation}
                      />
                      <DataListItem
                        label="Checkpoint"
                        value={session.failedAttempt.checkpointId}
                      />
                      <DataListItem
                        label="Diagnostic"
                        value={session.failedAttempt.diagnosticRef}
                      />
                    </DataList>
                  }
                  actions={
                    <Stack gap={4}>
                      <Button
                        tone="primary"
                        disabled={protectedAction('RetryProcessingStep')}
                        title={actionReason('RetryProcessingStep')}
                        onClick={() =>
                          command(
                            {
                              _tag: 'RetryProcessingStep',
                              sessionId: session.sessionId,
                              expectedProcessingRevision: session.revision,
                              failedAttemptId: session.failedAttempt?.attemptId,
                              checkpointId: session.failedAttempt?.checkpointId,
                              idempotencyKey: crypto.randomUUID(),
                            },
                            'Retrying checkpoint',
                          )
                        }
                      >
                        Retry exact checkpoint
                      </Button>
                      <ProcessActionDenial
                        reason={actionReason('RetryProcessingStep')}
                      />
                    </Stack>
                  }
                />
              ) : null}
              {message ? (
                <p className="beta-process-message" role="status">
                  {message}
                </p>
              ) : null}
            </Stack>
          </PanelBody>
        </Panel>
        <Panel className="beta-process-operation">
          <PanelHeader
            title="Operation"
            meta={session.phase === 'develop' ? 'Stretch' : 'Build protected'}
          />
          <PanelBody>
            <Stack>
              {session.phase === 'develop' ? (
                <>
                  <Field
                    label="Stretch amount"
                    hint="Bounded preview parameter"
                  >
                    <NumberField
                      min={0}
                      max={1}
                      step={0.05}
                      value={amount}
                      disabled={protectedAction('SyncProcessingPreview')}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setAmount(Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field
                    label="Local adapter"
                    hint="Deterministic fixture only"
                  >
                    <Select
                      value={adapter}
                      disabled={protectedAction('SyncProcessingPreview')}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                        setAdapter(event.target.value)
                      }
                    >
                      <option value="deterministic-compatible">
                        Compatible
                      </option>
                      <option value="deterministic-fail">
                        Failure fixture
                      </option>
                    </Select>
                  </Field>
                  <Button
                    tone="primary"
                    disabled={protectedAction('SyncProcessingPreview')}
                    title={actionReason('SyncProcessingPreview')}
                    onClick={() =>
                      command(
                        {
                          _tag: 'SyncProcessingPreview',
                          sessionId: session.sessionId,
                          expectedProcessingRevision: session.revision,
                          operation: 'stretch',
                          toolId: adapter,
                          parameters: [
                            {
                              key: 'amount',
                              value: { _tag: 'NumberValue', value: amount },
                            },
                          ],
                          baseHistoryPosition: session.historyPosition,
                          clientPreviewSequence: Date.now(),
                        },
                        'Computing preview',
                      )
                    }
                  >
                    Preview Stretch
                  </Button>
                  <ProcessActionDenial
                    reason={actionReason('SyncProcessingPreview')}
                  />
                  <Button
                    tone="primary"
                    disabled={protectedAction('ApplyProcessingPreview')}
                    title={actionReason('ApplyProcessingPreview')}
                    onClick={() =>
                      exactReady &&
                      command(
                        {
                          _tag: 'ApplyProcessingPreview',
                          sessionId: session.sessionId,
                          expectedProcessingRevision: session.revision,
                          previewId: session.preview?.previewId,
                          idempotencyKey: crypto.randomUUID(),
                        },
                        'Applying exact preview',
                      )
                    }
                  >
                    Apply exact preview
                  </Button>
                  <ProcessActionDenial
                    reason={actionReason('ApplyProcessingPreview')}
                  />
                  <Button
                    onPointerDown={() => setShowReference(true)}
                    onPointerUp={() => setShowReference(false)}
                    onPointerCancel={() => setShowReference(false)}
                    onPointerLeave={() => setShowReference(false)}
                    onKeyDown={(event: ReactKeyboardEvent) => {
                      if (event.key === ' ' || event.key === 'Enter')
                        setShowReference(true)
                    }}
                    onKeyUp={(event: ReactKeyboardEvent) => {
                      if (event.key === ' ' || event.key === 'Enter')
                        setShowReference(false)
                    }}
                    onBlur={() => setShowReference(false)}
                  >
                    Hold to compare reference
                  </Button>
                  <Cluster>
                    <Button
                      disabled={protectedAction('UndoProcessingStep')}
                      title={actionReason('UndoProcessingStep')}
                      onClick={() =>
                        command(
                          {
                            _tag: 'UndoProcessingStep',
                            sessionId: session.sessionId,
                            expectedProcessingRevision: session.revision,
                            idempotencyKey: crypto.randomUUID(),
                          },
                          'Undoing step',
                        )
                      }
                    >
                      Undo
                    </Button>
                    <Button
                      disabled={protectedAction('RedoProcessingStep')}
                      title={actionReason('RedoProcessingStep')}
                      onClick={() =>
                        command(
                          {
                            _tag: 'RedoProcessingStep',
                            sessionId: session.sessionId,
                            expectedProcessingRevision: session.revision,
                            idempotencyKey: crypto.randomUUID(),
                          },
                          'Redoing step',
                        )
                      }
                    >
                      Redo
                    </Button>
                  </Cluster>
                  <ProcessActionDenial
                    reason={actionReason('UndoProcessingStep')}
                  />
                  <ProcessActionDenial
                    reason={actionReason('RedoProcessingStep')}
                  />
                  <Button
                    disabled={protectedAction('SaveProcessingArtifacts')}
                    title={actionReason('SaveProcessingArtifacts')}
                    onClick={() =>
                      outputId &&
                      command(
                        {
                          _tag: 'SaveProcessingArtifacts',
                          sessionId: session.sessionId,
                          expectedProcessingRevision: session.revision,
                          artifacts: [
                            { outputId, format: 'tiff', role: 'final' },
                          ],
                          idempotencyKey: crypto.randomUUID(),
                        },
                        'Saving final TIFF',
                      )
                    }
                  >
                    Save final TIFF to Library
                  </Button>
                  <ProcessActionDenial
                    reason={actionReason('SaveProcessingArtifacts')}
                  />
                </>
              ) : (
                <Stack>
                  <AttentionCard
                    tone={buildWork?.state === 'failed' ? 'danger' : 'info'}
                    statusLabel={
                      buildWork?.state === 'failed'
                        ? 'Build stage failed'
                        : 'Build active'
                    }
                    title={
                      buildWork?.state === 'failed'
                        ? `${titleCase(buildWork.stage ?? 'build')} stopped at the last checkpoint`
                        : 'Develop controls are protected'
                    }
                    description="The durable base image must exist before preview or apply."
                  />
                  {buildWork?.state === 'failed' && buildWork.checkpoint ? (
                    <Button
                      tone="primary"
                      disabled={!!pending || authorityReason !== undefined}
                      onClick={() =>
                        command(
                          {
                            _tag: 'RetryProcessingBuild',
                            sessionId: session.sessionId,
                            expectedProcessingRevision: session.revision,
                            checkpoint: buildWork.checkpoint,
                            idempotencyKey: crypto.randomUUID(),
                          },
                          `Retrying ${titleCase(buildWork.stage ?? 'build')} from checkpoint`,
                        )
                      }
                    >
                      Retry {titleCase(buildWork.stage ?? 'build')} → Stack
                    </Button>
                  ) : null}
                </Stack>
              )}
              <DataList>
                <DataListItem
                  label="Pressure"
                  value={workspace?.pressure.state ?? 'unknown'}
                  detail={workspace?.pressure.reason}
                />
                <DataListItem
                  label="Preview"
                  value={session.preview?.state ?? 'none'}
                />
                <DataListItem
                  label="Active attempt"
                  value={session.activeAttempt?.state ?? 'none'}
                />
              </DataList>
              {session.savedAssetIds.map((assetId) => (
                <a
                  key={assetId}
                  href={nightbookHref(
                    `/library/assets/${encodeURIComponent(assetId)}`,
                  )}
                >
                  Saved Library asset · {assetId}
                </a>
              ))}
            </Stack>
          </PanelBody>
        </Panel>
      </div>
    </main>
  )
}

function ProcessStatusStrip({
  projection,
  workspace,
  sourceAssetId,
}: {
  projection: Projection
  workspace: ProcessWorkspace | undefined
  sourceAssetId?: string | undefined
}) {
  const session = selectedSession(workspace)
  const project = selectedProject(workspace)
  return (
    <footer
      className="beta-operational-status beta-process-status"
      aria-label="Operational status"
    >
      <span className="beta-process-status-desktop">
        <i
          data-tone={project || session ? 'positive' : 'neutral'}
          aria-hidden="true"
        />
        <b>Process</b> ·{' '}
        {sourceAssetId
          ? 'Library handoff'
          : project
            ? 'Processing Project'
            : (session?.lifecycle ?? 'No session')}
      </span>
      <span className="beta-process-status-desktop">
        {sourceAssetId
          ? `Exact source · ${sourceAssetId}`
          : project
            ? `${project.currentStage} · project revision ${project.revision}`
            : session
              ? `${titleCase(session.phase)} · revision ${session.revision}`
              : 'Durable workspace ready'}
      </span>
      <span className="beta-process-status-desktop">
        {workspace?.pressure.state ?? 'unknown'} pressure ·{' '}
        {processAuthorityConfirmed(projection)
          ? 'This client has Process authority'
          : 'Process authority unavailable'}
      </span>
      <span className="beta-process-status-mobile">
        <i
          data-tone={project || session ? 'positive' : 'neutral'}
          aria-hidden="true"
        />
        <b>Process</b> ·{' '}
        {sourceAssetId
          ? 'Library handoff'
          : project
            ? project.currentStage
            : (session?.phase ?? 'No session')}
      </span>
    </footer>
  )
}

export function ProcessCommandBar({
  projection,
  loading,
  phone,
  submitControl,
}: {
  projection: Projection
  loading: boolean
  phone: boolean
  submitControl?: BetaControlSubmit
}) {
  return (
    <BetaCommandBar
      projection={projection}
      loading={loading}
      workspace="process"
      controlPresentation={processControlPresentation(projection, phone)}
      submitControl={submitControl}
      allowControlAction={!phone}
    />
  )
}

export function BetaProcessApp(props: BetaProcessAppProps) {
  const [workspace, setWorkspace] = useState<ProcessWorkspace | undefined>(
    props.initialWorkspace,
  )
  const [state, setState] = useState(
    props.initialWorkspace ? 'Current' : 'Loading Process',
  )
  const [pending, setPending] = useState<string>()
  const [amount, setAmount] = useState(0.6)
  const [adapter, setAdapter] = useState('deterministic-compatible')
  const generation = useRef(0)
  const pendingRef = useRef(false)
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace
  const loadWorkspace = props.loadWorkspace ?? browserLoad
  const sendCommand = props.sendCommand ?? browserSend
  const refresh = useCallback(
    async (label = 'Current') => {
      const current = ++generation.current
      try {
        const next = await loadWorkspace()
        if (current === generation.current) {
          setWorkspace(next)
          setState(label)
        }
      } catch {
        if (current === generation.current)
          setState(
            workspaceRef.current
              ? 'Last-confirmed · service unavailable'
              : 'Process unavailable',
          )
      }
    },
    [loadWorkspace],
  )
  useEffect(() => {
    if (!props.initialWorkspace) void refresh()
  }, [props.initialWorkspace, props.projection.snapshotVersion, refresh])
  const command = useCallback(
    (value: object, label: string) => {
      if (pendingRef.current || processCommandsProtected(props.projection))
        return
      pendingRef.current = true
      const current = ++generation.current
      setPending(label)
      setState(label)
      void sendCommand(value).then(
        () => {
          if (current !== generation.current) return
          pendingRef.current = false
          setPending(undefined)
          setState('Command accepted · awaiting projection')
        },
        async () => {
          if (current !== generation.current) return
          pendingRef.current = false
          setPending(undefined)
          setState('Command uncertain or rejected · not replayed')
          await refresh('Reconciled after command failure')
        },
      )
    },
    [props.projection, refresh, sendCommand],
  )
  const phone = usePhoneProjection()
  return (
    <div
      className="beta-app nb-theme"
      data-nb-theme="nightbook"
      data-nb-density="compact"
    >
      <a className="beta-skip-link" href="#beta-workspace">
        Skip to Process
      </a>
      <ProcessCommandBar
        projection={props.projection}
        loading={props.loading}
        phone={phone}
        {...(props.submitControl === undefined
          ? {}
          : { submitControl: props.submitControl })}
      />
      {phone ? (
        <ProcessPhone
          workspace={workspace}
          state={state}
          sourceAssetId={props.sourceAssetId}
          sourceHandoff={props.sourceHandoff}
          sourceHandoffState={props.sourceHandoffState}
        />
      ) : (
        <ProcessDesktop
          projection={props.projection}
          workspace={workspace}
          sourceAssetId={props.sourceAssetId}
          sourceHandoff={props.sourceHandoff}
          sourceHandoffState={props.sourceHandoffState}
          pending={pending}
          message={state}
          amount={amount}
          adapter={adapter}
          setAmount={setAmount}
          setAdapter={setAdapter}
          command={command}
          onReviewCandidate={props.onReviewCandidate}
        />
      )}
      <ProcessStatusStrip
        projection={props.projection}
        workspace={workspace}
        sourceAssetId={props.sourceAssetId}
      />
    </div>
  )
}

export default BetaProcessApp
