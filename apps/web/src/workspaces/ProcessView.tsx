import { useEffect, useState } from 'react'
import type { ProcessSourceHandoff } from '../library-client'
import { Status } from './shared'

type Session = {
  sessionId: string
  revision: number
  lifecycle: string
  phase: string
  sources: Array<{ assetId: string }>
  history: Array<{
    operation: string
    toolId: string
    output?: { outputId: string }
  }>
  historyPosition: number
  preview?: { previewId: string; operation: string; toolId: string }
  failedAttempt?: { attemptId: string; checkpointId: string }
  baseImage?: unknown
}
type Workspace = { sessions: Session[]; selectedSessionId?: string }

export function ProcessView({
  sourceAssetId,
  sourceHandoff,
  sourceHandoffState,
}: {
  sourceAssetId: string | undefined
  sourceHandoff?: ProcessSourceHandoff
  sourceHandoffState?: 'loading' | 'not-found' | 'not-local' | 'unavailable'
}) {
  const [workspace, setWorkspace] = useState<Workspace>()
  const [message, setMessage] = useState('Loading Process session.')
  const load = () =>
    fetch('/api/workspaces/process')
      .then((response) => response.json())
      .then((value: Workspace) => {
        setWorkspace(value)
        setMessage('')
      })
      .catch(() => setMessage('Process service is unavailable.'))
  useEffect(() => {
    void load()
  }, [])
  const session =
    workspace?.sessions.find(
      (item) => item.sessionId === workspace.selectedSessionId,
    ) ?? workspace?.sessions.at(-1)
  const command = async (command: object) => {
    setMessage('Synchronizing Process work.')
    const response = await fetch('/api/process/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: crypto.randomUUID(), command }),
    })
    if (!response.ok)
      setMessage('The Process action was not accepted. Refresh the session.')
    else await load()
  }
  return (
    <div className="workspace process-source">
      <section
        className="process-source__surface"
        aria-label="Process workspace"
      >
        <header className="process-source__heading">
          <span>Process / durable session</span>
          <h1 tabIndex={-1}>
            {session
              ? `${session.phase === 'build' ? 'Build master' : 'Develop image'}`
              : 'Open a Library source'}
          </h1>
          <Status tone={session ? 'safe' : 'neutral'}>
            {session ? `${session.lifecycle} session` : 'No session selected'}
          </Status>
        </header>
        {sourceAssetId && !session && (
          <SourceEntry
            assetId={sourceAssetId}
            {...(sourceHandoff === undefined ? {} : { handoff: sourceHandoff })}
            {...(sourceHandoffState === undefined
              ? {}
              : { state: sourceHandoffState })}
            start={() =>
              void command({
                _tag: 'StartProcessingSession',
                sourceAssetIds: [sourceAssetId],
                idempotencyKey: crypto.randomUUID(),
              })
            }
          />
        )}
        {session && (
          <SessionSurface
            session={session}
            sessions={workspace?.sessions ?? []}
            command={command}
          />
        )}
        {message && <p role="status">{message}</p>}
      </section>
    </div>
  )
}

function SourceEntry({
  assetId,
  handoff,
  state,
  start,
}: {
  assetId: string
  handoff?: ProcessSourceHandoff
  state?: string
  start: () => void
}) {
  return (
    <section className="process-source__facts">
      <h2>Library source</h2>
      <p>
        {handoff
          ? `${handoff.role} · ${handoff.format} · ${handoff.availability}`
          : state === 'loading'
            ? 'Resolving the selected source.'
            : 'The selected source is unavailable.'}
      </p>
      <p>{assetId}</p>
      <button type="button" disabled={!handoff} onClick={start}>
        Open in Process
      </button>
    </section>
  )
}

function SessionSurface({
  session,
  sessions,
  command,
}: {
  session: Session
  sessions: Session[]
  command: (command: object) => Promise<void>
}) {
  const revision = session.revision
  const outputId =
    session.history.at(-1)?.output?.outputId ??
    (session.baseImage as { outputId?: string } | undefined)?.outputId
  const preview = () =>
    command({
      _tag: 'SyncProcessingPreview',
      sessionId: session.sessionId,
      expectedProcessingRevision: revision,
      operation: 'stretch',
      toolId: 'deterministic-compatible',
      parameters: [
        { key: 'amount', value: { _tag: 'NumberValue', value: 0.6 } },
      ],
      baseHistoryPosition: session.historyPosition,
      clientPreviewSequence: Date.now(),
    })
  const building = session.phase === 'build'
  return (
    <div className="process-session">
      <nav className="process-steps" aria-label="Process steps">
        <h2>Steps</h2>
        <ol>
          <li data-current={building || undefined}>Build master</li>
          <li data-current={!building || undefined}>Develop image</li>
        </ol>
        <p>
          {session.history.length} applied step
          {session.history.length === 1 ? '' : 's'}
        </p>
      </nav>
      <section
        className="process-canvas"
        aria-labelledby="process-canvas-heading"
      >
        <h2 id="process-canvas-heading">Image canvas</h2>
        <div
          className="preview-surface"
          role="img"
          aria-label="Processing image preview"
        >
          {building
            ? 'Linear master is building from protected Library sources.'
            : session.preview
              ? 'Preview is ready. Apply records the next linear step.'
              : 'Current developed image remains visible while you choose an operation.'}
        </div>
      </section>
      <aside
        className="process-context"
        aria-labelledby="process-operation-heading"
      >
        <h2 id="process-operation-heading">Operation</h2>
        <p>
          Sources: {session.sources.map((source) => source.assetId).join(', ')}
        </p>
        <p>Applied steps: {session.history.length}</p>
        {session.phase === 'develop' && (
          <div className="process-context__actions">
            <button
              type="button"
              className="button-primary"
              onClick={() => void preview()}
            >
              Preview Stretch
            </button>
            {session.preview && (
              <button
                type="button"
                className="button-primary"
                onClick={() =>
                  void command({
                    _tag: 'ApplyProcessingPreview',
                    sessionId: session.sessionId,
                    expectedProcessingRevision: revision,
                    previewId: session.preview?.previewId,
                    idempotencyKey: crypto.randomUUID(),
                  })
                }
              >
                Apply
              </button>
            )}
            <button
              type="button"
              disabled={session.historyPosition === 0}
              onClick={() =>
                void command({
                  _tag: 'UndoProcessingStep',
                  sessionId: session.sessionId,
                  expectedProcessingRevision: revision,
                })
              }
            >
              Undo
            </button>
            <button
              type="button"
              disabled={session.historyPosition === session.history.length}
              onClick={() =>
                void command({
                  _tag: 'RedoProcessingStep',
                  sessionId: session.sessionId,
                  expectedProcessingRevision: revision,
                })
              }
            >
              Redo
            </button>
            {outputId && (
              <button
                type="button"
                onClick={() =>
                  void command({
                    _tag: 'SaveProcessingArtifacts',
                    sessionId: session.sessionId,
                    expectedProcessingRevision: revision,
                    artifacts: [{ outputId, format: 'tiff', role: 'final' }],
                    idempotencyKey: crypto.randomUUID(),
                  })
                }
              >
                Save to Library
              </button>
            )}
            {session.failedAttempt && (
              <>
                <p className="process-context__recovery" role="status">
                  A processing stage failed. Retry resumes from its latest valid
                  checkpoint.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void command({
                      _tag: 'RetryProcessingStep',
                      sessionId: session.sessionId,
                      expectedProcessingRevision: revision,
                      failedAttemptId: session.failedAttempt?.attemptId,
                      checkpointId: session.failedAttempt?.checkpointId,
                      idempotencyKey: crypto.randomUUID(),
                    })
                  }
                >
                  Retry failed stage
                </button>
              </>
            )}
          </div>
        )}
        {sessions
          .filter(
            (item) =>
              item.sessionId !== session.sessionId &&
              item.lifecycle !== 'discarded',
          )
          .map((item) => (
            <button
              key={item.sessionId}
              type="button"
              onClick={() =>
                void command({
                  _tag: 'SwitchProcessingContext',
                  sessionId: session.sessionId,
                  expectedProcessingRevision: revision,
                  destination: {
                    _tag: 'ExistingSession',
                    sessionId: item.sessionId,
                  },
                  disposition: { _tag: 'LeaveUnfinished' },
                  idempotencyKey: crypto.randomUUID(),
                })
              }
            >
              Switch data
            </button>
          ))}
        <button
          type="button"
          className="process-context__discard"
          onClick={() =>
            void command({
              _tag: 'DiscardProcessingSession',
              sessionId: session.sessionId,
              expectedProcessingRevision: revision,
              confirmationId: `discard-${session.sessionId}`,
            })
          }
        >
          Discard unsaved work
        </button>
      </aside>
    </div>
  )
}
