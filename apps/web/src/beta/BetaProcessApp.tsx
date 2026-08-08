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
} from 'react'
import type { ProcessSourceHandoff } from '../library-client'
import type { Projection } from '../presentation'
import { BetaCommandBar, type BetaControlPresentation } from './BetaObserveApp'
import '@nightbook/ui/styles.css'
import './beta-observe.css'
import './beta-process.css'

export type ProcessWorkspace = typeof ProcessingProjection.Type
type Session = ProcessWorkspace['sessions'][number]
type ProcessAction = ProcessWorkspace['actions'][number]
type ProcessActionName = ProcessAction['action']
type ProcessDenialReason = Extract<
  ProcessAction,
  { _tag: 'Ineligible' }
>['reason']
type HandoffState = 'loading' | 'not-found' | 'not-local' | 'unavailable'

export type BetaProcessAppProps = {
  projection: Projection
  loading: boolean
  sourceAssetId?: string | undefined
  sourceHandoff?: ProcessSourceHandoff | undefined
  sourceHandoffState?: HandoffState | undefined
  initialWorkspace?: ProcessWorkspace | undefined
  loadWorkspace?: (() => Promise<ProcessWorkspace>) | undefined
  sendCommand?: ((command: object) => Promise<unknown>) | undefined
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

export function ProcessPhone({
  projection,
  workspace,
  state,
}: {
  projection: Projection
  workspace: ProcessWorkspace | undefined
  state: string
}) {
  const session = selectedSession(workspace)
  return (
    <main
      id="beta-workspace"
      className="beta-phone-workspace beta-process-phone"
    >
      <header className="beta-phone-header">
        <div>
          <p>Process / read only</p>
          <h1>{session ? titleCase(session.phase) : 'Process session'}</h1>
        </div>
        <StatusIndicator
          label={session?.lifecycle ?? state}
          tone={session ? 'positive' : 'neutral'}
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
          title="Session summary"
          meta={session ? `rev ${session.revision}` : 'No session'}
        />
        <PanelBody>
          <DataList>
            <DataListItem
              label="Lifecycle"
              value={session?.lifecycle ?? state}
            />
            <DataListItem
              label="Phase"
              value={session?.phase ?? 'Unavailable'}
            />
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
            <DataListItem
              label="Pressure"
              value={workspace?.pressure.state ?? 'Unknown'}
              detail={workspace?.pressure.reason}
            />
            <DataListItem
              label="Saved"
              value={String(session?.savedAssetIds.length ?? 0)}
            />
          </DataList>
        </PanelBody>
      </Panel>
      {session ? (
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
        {projection.shell.protection}
      </p>
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
}: {
  assetId: string | undefined
  handoff: ProcessSourceHandoff | undefined
  state: HandoffState | undefined
  disabled: boolean
  disabledReason: string | undefined
  start: () => void
}) {
  const supported =
    handoff?.role === 'original' || handoff?.role === 'linearMaster'
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
              <Button
                tone="primary"
                disabled={disabled}
                title={disabledReason}
                onClick={start}
              >
                Start durable session
              </Button>
              <ProcessActionDenial
                reason={disabled ? disabledReason : undefined}
              />
            </Stack>
          ) : (
            <a
              className="nb-button nb-button--secondary nb-button--medium"
              href="/library?ui=beta"
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
}) {
  const session = selectedSession(workspace)
  const authorityReason = processCommandsProtected(projection)
    ? 'Current desktop owner authority is not confirmed.'
    : undefined
  const startReason =
    authorityReason ??
    processActionReason(workspace?.actions, 'StartProcessingSession')
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
                sourceAssetIds: [sourceHandoff.sourceAssetId],
                idempotencyKey: crypto.randomUUID(),
              },
              'Starting session',
            )
          }
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
  const previewFallback =
    session.phase === 'build'
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
                <AttentionCard
                  tone="info"
                  statusLabel="Build active"
                  title="Develop controls are protected"
                  description="The durable base image must exist before preview or apply."
                />
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
                  href={`/library/assets/${encodeURIComponent(assetId)}?ui=beta`}
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
}: {
  projection: Projection
  workspace: ProcessWorkspace | undefined
}) {
  const session = selectedSession(workspace)
  return (
    <footer
      className="beta-operational-status beta-process-status"
      aria-label="Operational status"
    >
      <span className="beta-process-status-desktop">
        <i data-tone={session ? 'positive' : 'neutral'} aria-hidden="true" />
        <b>Process</b> · {session?.lifecycle ?? 'No session'}
      </span>
      <span className="beta-process-status-desktop">
        {session
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
        <i data-tone={session ? 'positive' : 'neutral'} aria-hidden="true" />
        <b>Process</b> · {session?.phase ?? 'No session'}
      </span>
    </footer>
  )
}

export function ProcessCommandBar({
  projection,
  loading,
  phone,
}: {
  projection: Projection
  loading: boolean
  phone: boolean
}) {
  return (
    <BetaCommandBar
      projection={projection}
      loading={loading}
      workspace="process"
      controlPresentation={processControlPresentation(projection, phone)}
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
  }, [
    props.initialWorkspace,
    props.projection.observe.snapshotVersion,
    refresh,
  ])
  const command = useCallback(
    (value: object, label: string) => {
      if (pendingRef.current || processCommandsProtected(props.projection))
        return
      pendingRef.current = true
      const current = ++generation.current
      setPending(label)
      setState(label)
      void sendCommand(value).then(
        async () => {
          if (current !== generation.current) return
          pendingRef.current = false
          setPending(undefined)
          await refresh('Command accepted · current')
          const reconcileGeneration = generation.current
          window.setTimeout(() => {
            if (
              reconcileGeneration === generation.current &&
              !pendingRef.current
            )
              void refresh('Current')
          }, 700)
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
      />
      {phone ? (
        <ProcessPhone
          projection={props.projection}
          workspace={workspace}
          state={state}
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
        />
      )}
      <ProcessStatusStrip projection={props.projection} workspace={workspace} />
    </div>
  )
}

export default BetaProcessApp
