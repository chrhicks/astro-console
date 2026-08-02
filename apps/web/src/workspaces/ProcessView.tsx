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
  const identity = sessionId ?? view.sessionId
  const source = sourceAssetId
    ? `${sourceAssetId} / stable handoff`
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
          <Status tone="safe">Build complete</Status>
          <p>{view.checkpoint}</p>
        </div>
      </aside>
      <section className="process-canvas">
        <header>
          <span>Service-supplied projection / {step?.status}</span>
          <h1 tabIndex={-1}>{view.label}</h1>
        </header>
        <div className="process-image">
          <Evidence label="Current valid processing image" />
        </div>
        <footer>
          <span>{source}</span>
          <b>{view.preview}</b>
        </footer>
      </section>
      <aside className="process-rail">
        <span>{step?.label}</span>
        <Status tone={view.failure ? 'danger' : 'safe'}>
          {view.failure ? 'Failure held' : 'Last valid image'}
        </Status>
        <h2>{view.failure ?? 'Gradient removal'}</h2>
        <p>{view.preview}</p>
        <div className="policy-trace">
          <Status tone="neutral">Host policy healthy</Status>
          <span>Measured cause: no pressure</span>
          <span>Effect: processing remains read-only</span>
          <span>Protection: checkpoint preserved</span>
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
