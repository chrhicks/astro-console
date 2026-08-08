import type { MouseEventHandler, ReactNode } from 'react'
import './style.css'

/**
 * Destructive actions name their scope; disabled actions name their reason.
 * Both are enforced by the type system: `tone: 'danger'` cannot be written
 * without `scope`, and `disabled: true` cannot be written without
 * `disabledReason`. "Disabled is insufficient" is a compile error here.
 */
export type ActionBarAction = {
  label: string
  /** Client-route link props from the app's link() helper, or a plain href. */
  href?: string
  onClick?: MouseEventHandler
} & (
  | { tone?: 'primary' | 'secondary'; scope?: undefined }
  | { tone: 'danger'; scope: string }
) &
  (
    | { disabled?: false; disabledReason?: undefined }
    | { disabled: true; disabledReason: string }
  )

/**
 * ActionBar — the decision strip for a region. At most one primary action
 * (the current authorized step); destructive actions carry their scope in
 * the accessible name; `note` states the bound in plain sight.
 *
 * Mutation renders as <button>; navigation renders as <a>. The phone
 * read-only rule hides buttons, so never render a mutation as a link.
 */
export function ActionBar({
  summary,
  actions,
  note,
  className,
}: {
  summary?: ReactNode
  actions: readonly ActionBarAction[]
  note?: string
  className?: string
}) {
  return (
    <div className={`action-bar${className ? ` ${className}` : ''}`}>
      {summary ? <div className="action-bar__summary">{summary}</div> : null}
      <div className="action-bar__actions">
        {actions.map((action) => {
          const classNames = [
            'action-bar__action',
            `action-bar__action--${action.tone ?? 'secondary'}`,
          ].join(' ')
          const content = (
            <>
              {action.label}
              {action.disabled ? (
                <span className="action-bar__reason">
                  {action.disabledReason}
                </span>
              ) : null}
            </>
          )
          const named =
            action.tone === 'danger'
              ? { 'aria-label': `${action.label} — ${action.scope}` }
              : {}
          if (action.href !== undefined && !action.disabled) {
            return (
              <a
                key={action.label}
                className={classNames}
                href={action.href}
                {...named}
                {...(action.onClick === undefined
                  ? {}
                  : { onClick: action.onClick })}
              >
                {content}
              </a>
            )
          }
          return (
            <button
              key={action.label}
              type="button"
              className={classNames}
              disabled={action.disabled ?? false}
              {...named}
              {...(action.onClick === undefined
                ? {}
                : { onClick: action.onClick })}
            >
              {content}
            </button>
          )
        })}
      </div>
      {note ? <p className="action-bar__note">{note}</p> : null}
    </div>
  )
}
