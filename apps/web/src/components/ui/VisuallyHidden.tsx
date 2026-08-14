import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { classes } from './foundations/utils'
import './VisuallyHidden.css'

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
}

export const VisuallyHidden = forwardRef<HTMLSpanElement, VisuallyHiddenProps>(
  function VisuallyHidden({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        className={classes('ui-visually-hidden', className)}
        {...props}
      />
    )
  },
)
