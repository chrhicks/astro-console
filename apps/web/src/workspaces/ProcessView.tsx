import { useState } from 'react'
import type { ProcessSourceHandoff } from '../library-client'
import type { ProcessView as View } from '../presentation'
import { Evidence, Status } from './shared'

export function ProcessView({
  view,
  sessionId,
  sourceAssetId,
  sourceHandoff,
  sourceHandoffState,
}: {
  view: View
  sessionId: string | undefined
  sourceAssetId: string | undefined
  sourceHandoff?: ProcessSourceHandoff
  sourceHandoffState?: 'loading' | 'unavailable'
}) {
  if (sourceAssetId !== undefined)
    return (
      <ProcessSourceHandoffView
        sourceAssetId={sourceAssetId}
        handoff={sourceHandoff}
        state={sourceHandoffState}
      />
    )
  const identity = view.detailAvailable
    ? (sessionId ?? view.sessionId)
    : sessionId
      ? `Unresolved session address / ${sessionId}`
      : 'Session detail unavailable'
  const source = view.detailAvailable
    ? sourceAssetId
      ? `${sourceAssetId} / stable handoff`
      : view.source
    : sourceAssetId
      ? `Unresolved source address / ${sourceAssetId}`
      : view.source
  const [selected, setSelected] = useState(1)
  const step = view.steps[selected]
  return (
    <div className="workspace process-workspace">
      <aside className="process-steps">
        <span>Session / {identity}</span>
        <h2>Build & Develop</h2>
        {view.steps.map((step, index) => (
          <button
            key={step.label}
            data-selected={index === selected}
            onClick={() => setSelected(index)}
          >
            {step.label}
          </button>
        ))}
        <div>
          <Status tone={view.detailAvailable ? 'safe' : 'neutral'}>
            {view.detailAvailable
              ? 'Build complete'
              : 'Session detail unavailable'}
          </Status>
          <p>{view.checkpoint}</p>
        </div>
      </aside>
      <section className="process-canvas">
        <header>
          <span>
            {view.detailAvailable
              ? `Service-supplied projection / ${step?.status}`
              : `Detailed projection unavailable / ${step?.status}`}
          </span>
          <h1 tabIndex={-1}>{view.label}</h1>
        </header>
        <div className="process-image">
          {view.detailAvailable ? (
            <Evidence label="Current valid processing image" />
          ) : (
            <p className="unavailable-evidence">{view.preview}</p>
          )}
        </div>
        <footer>
          <span>{source}</span>
          <b>{view.preview}</b>
        </footer>
      </section>
      <aside className="process-rail">
        <span>{step?.label}</span>
        <Status
          tone={
            view.failure ? 'danger' : view.detailAvailable ? 'safe' : 'neutral'
          }
        >
          {view.failure
            ? 'Failure held'
            : view.detailAvailable
              ? 'Last valid image'
              : 'Evidence unavailable'}
        </Status>
        <h2>
          {view.failure ??
            (view.detailAvailable
              ? 'Gradient removal'
              : 'Operation unavailable')}
        </h2>
        <p>{view.preview}</p>
        <div className="policy-trace">
          {view.detailAvailable ? (
            <>
              <Status tone="neutral">Host policy healthy</Status>
              <span>Measured cause: no pressure</span>
              <span>Effect: processing remains read-only</span>
              <span>Protection: checkpoint preserved</span>
            </>
          ) : (
            <span>Host policy and checkpoint evidence are unavailable.</span>
          )}
        </div>
        <dl>
          <div>
            <dt>Checkpoint</dt>
            <dd>{view.checkpoint}</dd>
          </div>
          <div>
            <dt>Diagnostics</dt>
            <dd>{view.diagnostics}</dd>
          </div>
        </dl>
      </aside>
    </div>
  )
}

function ProcessSourceHandoffView({
  sourceAssetId,
  handoff,
  state,
}: {
  sourceAssetId: string
  handoff: ProcessSourceHandoff | undefined
  state: 'loading' | 'unavailable' | undefined
}) {
  const resolved = handoff !== undefined
  return (
    <div className="workspace process-workspace">
      <aside className="process-steps">
        <span>
          Source /{' '}
          {resolved
            ? `${handoff.sourceAssetId} / stable handoff`
            : `Unresolved source address / ${sourceAssetId}`}
        </span>
        <h2>Process source</h2>
        <Status tone="neutral">Processing unavailable</Status>
      </aside>
      <section className="process-canvas">
        <header>
          <span>Source handoff only</span>
          <h1 tabIndex={-1}>Process unavailable</h1>
        </header>
        <p className="unavailable-evidence">
          {state === 'loading'
            ? 'Resolving source handoff.'
            : resolved
              ? `Source role: ${handoff.role}. Source availability: ${handoff.availability}.`
              : 'Source handoff is unavailable.'}
        </p>
        <footer>
          <span>{resolved ? handoff.sourceAssetId : sourceAssetId}</span>
          <b>Interactive processing is unavailable.</b>
        </footer>
      </section>
      <aside className="process-rail">
        <span>Processing</span>
        <Status tone="neutral">Unavailable</Status>
        <h2>Read-only source handoff</h2>
        {resolved ? (
          handoff.processing.currentFixtureFacts.map((fact) => (
            <p key={fact}>{fact}</p>
          ))
        ) : (
          <p>Current processing facts are unavailable.</p>
        )}
      </aside>
    </div>
  )
}
