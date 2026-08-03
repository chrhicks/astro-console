import type { ObserveView as View } from '../presentation'
import { Evidence, Status } from './shared'

export function ObserveView({ view }: { view: View }) {
  return (
    <div className="workspace observe-workspace">
      <header className="workspace-heading">
        <div>
          <span>
            {view.detailAvailable
              ? 'Current verified evidence'
              : 'Detailed evidence unavailable'}
          </span>
          <h1 tabIndex={-1}>{view.target}</h1>
        </div>
        <Status tone={view.tone}>{view.status}</Status>
      </header>
      <section className="observe-image">
        {view.detailAvailable ? (
          <>
            <Evidence label={view.evidence} />
            <span>{view.annotation}</span>
          </>
        ) : (
          <p className="unavailable-evidence">{view.evidence}</p>
        )}
      </section>
      <aside className="observe-decision">
        <span>Decision now</span>
        <h2>{view.heading}</h2>
        <p>{view.trace.join(' ')}</p>
        <dl>
          {view.facts.map((fact, index) => (
            <div key={fact}>
              <dt>{index === 0 ? 'Evidence' : 'Assessment'}</dt>
              <dd>{fact}</dd>
            </div>
          ))}
        </dl>
        {view.recovery && (
          <p className="recovery">
            <b>Recovery:</b> {view.recovery}
          </p>
        )}
      </aside>
      <footer className="lifecycle">
        {view.lifecycle.map((phase) => (
          <span key={phase} data-current={phase === view.phase || undefined}>
            {phase}
          </span>
        ))}
        <p>Lifecycle is current service truth, not navigation.</p>
      </footer>
    </div>
  )
}
