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
          <span>
            {view.detailAvailable ? 'Tonight / 25 July' : 'Plan availability'}
          </span>
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
        {view.detailAvailable ? (
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
        ) : (
          <div className="sky-field plan-unavailable" role="status">
            Sky and observing-window evidence are unavailable from bootstrap.
          </div>
        )}
        <p className="plan-readiness">{view.readiness}</p>
      </section>
      <aside className="plan-inspector">
        <span>Selected sequence</span>
        <h2>{sequence?.target ?? 'No sequence available'}</h2>
        {view.detailAvailable ? (
          <Evidence
            label={`${sequence?.target ?? 'Selected target'} evidence`}
          />
        ) : (
          <p>Selected-sequence evidence is unavailable from bootstrap.</p>
        )}
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
        <p>{view.detail}</p>
      </aside>
      <footer className="plan-timeline">
        {view.detailAvailable ? (
          <>
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
          </>
        ) : (
          <p>Schedule detail is unavailable from bootstrap.</p>
        )}
      </footer>
    </div>
  )
}
