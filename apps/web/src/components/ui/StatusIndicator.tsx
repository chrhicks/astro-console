import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import type { Tone } from './foundations/types'
import { classes } from './foundations/utils'
import './StatusIndicator.css'

export interface StatusIndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  label: ReactNode
  tone?: Tone
  detail?: ReactNode
  marker?: 'dot' | 'none'
}

export const StatusIndicator = forwardRef<
  HTMLSpanElement,
  StatusIndicatorProps
>(function StatusIndicator(
  { label, tone = 'neutral', detail, marker = 'dot', className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={classes('ui-status', `ui-status--${tone}`, className)}
      {...props}
    >
      {marker === 'dot' && <i aria-hidden="true" />}
      <b>{label}</b>
      {detail !== undefined && detail !== null && <small>{detail}</small>}
    </span>
  )
})
