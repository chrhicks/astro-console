import type { ProcessSourceHandoff } from '../library-client'
import { Status } from './shared'

export function ProcessView({
  sourceAssetId,
  sourceHandoff,
  sourceHandoffState,
}: {
  sourceAssetId: string | undefined
  sourceHandoff?: ProcessSourceHandoff
  sourceHandoffState?: 'loading' | 'not-found' | 'not-local' | 'unavailable'
}) {
  if (sourceAssetId !== undefined)
    return (
      <ProcessSourceHandoffView
        sourceAssetId={sourceAssetId}
        handoff={sourceHandoff}
        state={sourceHandoffState}
      />
    )
  return <ProcessUnavailableView />
}

export function ProcessSourceHandoffView({
  sourceAssetId,
  handoff,
  state,
}: {
  sourceAssetId: string
  handoff: ProcessSourceHandoff | undefined
  state: 'loading' | 'not-found' | 'not-local' | 'unavailable' | undefined
}) {
  return (
    <div className="workspace process-source">
      <section
        className="process-source__surface"
        aria-label="Process unavailable"
      >
        <header className="process-source__heading">
          <span>Library / source handoff</span>
          <h1 tabIndex={-1}>Interactive processing unavailable</h1>
          <Status tone="neutral">No processing service installed</Status>
        </header>
        {handoff ? (
          <SourceFacts handoff={handoff} />
        ) : (
          <SourceFailure state={state} sourceAssetId={sourceAssetId} />
        )}
        <p className="process-source__protection">
          Interactive processing is not installed. This is a read-only Library
          handoff: no processing session, image preview, or saved output has
          been created; the source remains protected in the Library.
        </p>
      </section>
    </div>
  )
}

function SourceFacts({ handoff }: { handoff: ProcessSourceHandoff }) {
  return (
    <div className="process-source__facts">
      <section aria-labelledby="source-identity-heading">
        <h2 id="source-identity-heading">Source identity</h2>
        <dl>
          <div>
            <dt>Stable asset</dt>
            <dd>{handoff.sourceAssetId}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{handoff.revision}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{`${handoff.role} · ${handoff.format} · ${handoff.availability}`}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="source-lineage-heading">
        <h2 id="source-lineage-heading">Lineage</h2>
        <dl>
          <div>
            <dt>Source assets</dt>
            <dd>{handoff.lineage.sourceAssetIds.join(' · ')}</dd>
          </div>
          <div>
            <dt>Observing run</dt>
            <dd>{handoff.lineage.runId}</dd>
          </div>
          <div>
            <dt>Solve attempt</dt>
            <dd>{handoff.lineage.solveAttemptId}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}

function SourceFailure({
  state,
  sourceAssetId,
}: {
  state: 'loading' | 'not-found' | 'not-local' | 'unavailable' | undefined
  sourceAssetId: string
}) {
  return (
    <div className="process-source__failure" role="status">
      <p>{sourceMessage(state)}</p>
      <dl>
        <div>
          <dt>Requested source</dt>
          <dd>{sourceAssetId}</dd>
        </div>
        <div>
          <dt>Processing</dt>
          <dd>Unavailable; no session was opened</dd>
        </div>
      </dl>
    </div>
  )
}

function ProcessUnavailableView() {
  return (
    <div className="workspace process-source">
      <section
        className="process-source__surface"
        aria-label="Process unavailable"
      >
        <header className="process-source__heading">
          <span>Process</span>
          <h1 tabIndex={-1}>Interactive processing unavailable</h1>
          <Status tone="neutral">No processing service installed</Status>
        </header>
        <p className="process-source__summary">
          Interactive processing is not installed. Open a Library source to
          review its stable identity, availability, and lineage.
        </p>
        <p className="process-source__protection">
          No processing session, image preview, checkpoint, or controls are
          available. Library sources remain unchanged.
        </p>
      </section>
    </div>
  )
}

function sourceMessage(
  state: 'loading' | 'not-found' | 'not-local' | 'unavailable' | undefined,
) {
  if (state === 'loading') return 'Resolving source handoff.'
  if (state === 'not-found')
    return 'This source asset is unknown or missing from the Library.'
  if (state === 'not-local')
    return 'This source asset is not available locally.'
  return 'The Library service is unavailable.'
}
