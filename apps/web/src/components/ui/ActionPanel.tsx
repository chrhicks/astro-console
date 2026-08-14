import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import type { ActionDescriptor } from './foundations/types'
import { classes } from './foundations/utils'
import { Button } from './Button'
import './ActionPanel.css'

export interface ActionPanelProps
  extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  primary?: ActionDescriptor | undefined
  secondary?: ActionDescriptor[] | undefined
  footer?: ReactNode
}

export const ActionPanel = forwardRef<HTMLElement, ActionPanelProps>(
  function ActionPanel(
    {
      eyebrow,
      title,
      description,
      primary,
      secondary = [],
      footer,
      className,
      ...props
    },
    ref,
  ) {
    const renderAction = (action: ActionDescriptor, primaryAction = false) => (
      <div className="ui-action-panel-action" key={action.id}>
        <Button
          tone={action.tone ?? (primaryAction ? 'primary' : 'secondary')}
          disabled={action.disabled}
          onClick={action.onSelect}
          fullWidth
        >
          {action.label}
        </Button>
        {action.description !== undefined && action.description !== null && (
          <small>{action.description}</small>
        )}
      </div>
    )
    return (
      <section
        ref={ref}
        className={classes('ui-action-panel', className)}
        {...props}
      >
        {eyebrow !== undefined && eyebrow !== null && (
          <small className="ui-action-panel-eyebrow">{eyebrow}</small>
        )}
        <h3>{title}</h3>
        {description !== undefined && description !== null && (
          <div className="ui-action-panel-description">{description}</div>
        )}
        <div className="ui-action-panel-actions">
          {primary && renderAction(primary, true)}
          {secondary.map((action) => renderAction(action))}
        </div>
        {footer !== undefined && footer !== null && <footer>{footer}</footer>}
      </section>
    )
  },
)
