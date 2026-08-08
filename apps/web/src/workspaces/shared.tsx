import type { Action } from '../presentation'

// The grammar components live in ../components (status, evidence-frame,
// fact-register, action-bar, ...). These re-exports keep existing workspace
// imports stable while the workspaces migrate onto the component layer.
export { Status } from '../components/status'
export { EvidenceFrame as Evidence } from '../components/evidence-frame'

export function ActionButton({
  action,
  renderActions,
  submit,
}: {
  action: Action
  renderActions: boolean
  submit: (action: Action) => void
}) {
  return (
    <div className="action-boundary">
      {renderActions && action.availability === 'available' && (
        <button
          className="button-primary"
          onClick={() => submit(action)}
          aria-describedby="action-reason"
        >
          {action.label}
        </button>
      )}
      <p id="action-reason">
        <b>
          {action.availability === 'protected' ? 'Protected' : 'Unavailable'}:
        </b>{' '}
        {action.reason}
      </p>
      <dl>
        <div>
          <dt>Freshness</dt>
          <dd>{action.freshness}</dd>
        </div>
        <div>
          <dt>Controller</dt>
          <dd>{action.controller}</dd>
        </div>
        <div>
          <dt>Capability</dt>
          <dd>{action.capability}</dd>
        </div>
        <div>
          <dt>Protection</dt>
          <dd>{action.protection}</dd>
        </div>
      </dl>
    </div>
  )
}
