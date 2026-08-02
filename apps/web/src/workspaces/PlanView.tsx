import { useState } from 'react'
import type { PlanView as View } from '../presentation'
import { Evidence, Status } from './shared'

export function PlanView({ view }: { view: View }) {
  const [selected, setSelected] = useState(0)
  const sequence = view.sequences[selected]
  return (
    <div className="workspace plan-workspace">
      <header className="workspace-heading">
        <div>
          <span>Tonight / 25 July</span>
          <h1 tabIndex={-1}>{view.title}</h1>
        </div>
        <Status tone="attention" className="plan-heading__readiness">
          {view.readiness}
        </Status>
      </header>
      <aside className="sequence-list">
        <span>Ordered sequences</span>
        {view.sequences.map((item, index) => (
          <button
            key={item.id}
            data-selected={index === selected}
            onClick={() => setSelected(index)}
          >
            <strong>0{index + 1}</strong>
            <b>{item.target}</b>
            <small>
              {item.capture} · {item.window}
            </small>
          </button>
        ))}
      </aside>
      <section className="plan-evidence">
        <div
          className="sky-field"
          role="img"
          aria-label="Night sky with independent target motion arcs"
        >
          <i className="arc arc--one" />
          <i className="arc arc--two" />
          <i className="arc arc--three" />
          <span>Independent target motion, not telescope travel</span>
        </div>
        <p className="plan-readiness">{view.readiness}</p>
      </section>
      <aside className="plan-inspector">
        <span>Selected sequence</span>
        <h2>{sequence?.target ?? 'No sequence available'}</h2>
        <Evidence label={`${sequence?.target ?? 'Selected target'} evidence`} />
        <dl>
          <div>
            <dt>Window</dt>
            <dd>{sequence?.window}</dd>
          </div>
          <div>
            <dt>Capture</dt>
            <dd>{sequence?.capture}</dd>
          </div>
          <div>
            <dt>Viability</dt>
            <dd>{sequence?.readiness ?? view.readiness}</dd>
          </div>
        </dl>
        <p>Draft revision is visible. No accepted execution is available.</p>
      </aside>
      <footer className="plan-timeline">
        <span>21:00</span>
        {view.sequences.map((item, index) => (
          <button
            key={item.id}
            data-selected={index === selected}
            onClick={() => setSelected(index)}
          >
            {item.target}
            <small>{item.window}</small>
          </button>
        ))}
        <span>Dawn 04:32</span>
      </footer>
    </div>
  )
}
