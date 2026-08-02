import type { Action, StatusTone } from '../presentation'

export function Status({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: string
  className?: string
}) {
  return (
    <span
      className={`semantic-status${className ? ` ${className}` : ''}`}
      data-tone={tone}
      role="status"
    >
      {children}
    </span>
  )
}
export function Evidence({
  label,
  variant = 'andromeda',
}: {
  label: string
  variant?: 'andromeda' | 'nebula'
}) {
  return (
    <div
      className={`evidence-image evidence-image--${variant}`}
      role="img"
      aria-label={label}
    >
      <span className="evidence-image__core" />
      {Array.from({ length: 12 }, (_, index) => (
        <i
          key={index}
          className={`evidence-image__star evidence-image__star--${index + 1}`}
        />
      ))}
      <span className="evidence-image__frame" />
    </div>
  )
}
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
