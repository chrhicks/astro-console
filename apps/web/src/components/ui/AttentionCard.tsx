import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import type { Tone } from './foundations/types'
import { classes } from './foundations/utils'
import { VisuallyHidden } from './VisuallyHidden'
import { StatusIndicator } from './StatusIndicator'
import './AttentionCard.css'

export interface AttentionCardProps
  extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'action'> {
  action?: never
  tone?: Tone
  statusLabel: ReactNode
  title: ReactNode
  description?: ReactNode
  evidence?: ReactNode
  actions?: ReactNode
}
export const AttentionCard = forwardRef<HTMLElement, AttentionCardProps>(
  function AttentionCard(
    {
      tone = 'warning',
      statusLabel,
      title,
      description,
      evidence,
      actions,
      action: ignoredAction,
      className,
      ...props
    },
    ref,
  ) {
    void ignoredAction
    return (
      <article
        ref={ref}
        className={classes('ui-attention', `ui-attention--${tone}`, className)}
        {...props}
      >
        <StatusIndicator tone={tone} label={statusLabel} />
        <h3>{title}</h3>
        {description !== undefined && description !== null && (
          <div className="ui-attention-description">{description}</div>
        )}
        {evidence !== undefined && evidence !== null && (
          <div className="ui-attention-evidence">{evidence}</div>
        )}
        {actions !== undefined && actions !== null && (
          <div className="ui-attention-actions">{actions}</div>
        )}
      </article>
    )
  },
)

export interface AttemptItem {
  id: string
  label: ReactNode
  detail?: ReactNode
  meta?: ReactNode
  state?: 'complete' | 'current' | 'failed'
}
export interface AttemptTrailProps
  extends Omit<HTMLAttributes<HTMLOListElement>, 'label'> {
  items: AttemptItem[]
  label: string
}
export const AttemptTrail = forwardRef<HTMLOListElement, AttemptTrailProps>(
  function AttemptTrail({ items, label, className, ...props }, ref) {
    return (
      <ol
        ref={ref}
        className={classes('ui-attempt-trail', className)}
        aria-label={label}
        {...props}
      >
        {items.map((item) => {
          const state = item.state ?? 'complete'
          return (
            <li key={item.id} data-state={state}>
              <i aria-hidden="true" />
              <div>
                <b>{item.label}</b>
                <VisuallyHidden>
                  {state === 'failed'
                    ? 'Failed'
                    : state === 'current'
                      ? 'Current'
                      : 'Complete'}
                </VisuallyHidden>
                {item.detail !== undefined && item.detail !== null && (
                  <span>{item.detail}</span>
                )}
              </div>
              {item.meta !== undefined && item.meta !== null && (
                <small>{item.meta}</small>
              )}
            </li>
          )
        })}
      </ol>
    )
  },
)
