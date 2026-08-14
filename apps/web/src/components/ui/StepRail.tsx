import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { classes } from './foundations/utils'
import { VisuallyHidden } from './VisuallyHidden'
import './StepRail.css'

export interface StepItem {
  id: string
  label: ReactNode
  description?: ReactNode
  status?: 'complete' | 'current' | 'pending' | 'failed'
}
export interface StepRailProps
  extends Omit<HTMLAttributes<HTMLOListElement>, 'onChange'> {
  items: StepItem[]
  activeId?: string
  onActiveChange?: (id: string) => void
  label: string
  orientation?: 'horizontal' | 'vertical'
}

export const StepRail = forwardRef<HTMLOListElement, StepRailProps>(
  function StepRail(
    {
      items,
      activeId,
      onActiveChange,
      label,
      orientation = 'vertical',
      className,
      ...props
    },
    ref,
  ) {
    return (
      <ol
        ref={ref}
        aria-label={label}
        data-orientation={orientation}
        className={classes('ui-step-rail', className)}
        {...props}
      >
        {items.map((item, index) => {
          const status =
            item.id === activeId ? 'current' : (item.status ?? 'pending')
          const stateLabel =
            status === 'complete'
              ? 'Complete'
              : status === 'failed'
                ? 'Failed'
                : status === 'current'
                  ? 'Current'
                  : 'Pending'
          const content = (
            <>
              <span aria-hidden="true">
                {status === 'complete'
                  ? '✓'
                  : status === 'failed'
                    ? '×'
                    : String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <b>{item.label}</b>
                {item.description && <small>{item.description}</small>}
                <VisuallyHidden>{stateLabel}</VisuallyHidden>
              </div>
            </>
          )
          return (
            <li key={item.id} data-status={status}>
              {onActiveChange ? (
                <button
                  type="button"
                  aria-current={status === 'current' ? 'step' : undefined}
                  onClick={() => onActiveChange(item.id)}
                >
                  {content}
                </button>
              ) : (
                <div aria-current={status === 'current' ? 'step' : undefined}>
                  {content}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    )
  },
)
