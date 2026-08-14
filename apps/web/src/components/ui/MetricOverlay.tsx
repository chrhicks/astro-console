import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { classes } from './foundations/utils'
import './MetricOverlay.css'

export interface MetricOverlayItem {
  id: string
  label: ReactNode
  value: ReactNode
}

export interface MetricOverlayProps extends HTMLAttributes<HTMLDListElement> {
  label: string
  items: MetricOverlayItem[]
}

export const MetricOverlay = forwardRef<HTMLDListElement, MetricOverlayProps>(
  function MetricOverlay({ label, items, className, ...props }, ref) {
    return (
      <dl
        ref={ref}
        aria-label={label}
        className={classes('ui-metric-overlay', className)}
        {...props}
      >
        {items.map((item) => (
          <div key={item.id}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    )
  },
)
