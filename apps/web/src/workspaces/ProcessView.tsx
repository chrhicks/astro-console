import { useState } from 'react'
import type { ProcessView as View } from '../presentation'
import { Evidence, Status } from './shared'

export function ProcessView({
  view,
  sessionId,
  sourceAssetId,
}: {
  view: View
  sessionId: string | undefined
  sourceAssetId: string | undefined
}) {
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
