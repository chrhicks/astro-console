import {
  createElement,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { classes } from './foundations/utils'
import './Panel.css'

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'aside' | 'div'
}

export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { as: Element = 'section', className, ...props },
  ref,
) {
  return createElement(Element, {
    ...props,
    ref,
    className: classes('ui-panel', className),
  })
})

export interface PanelHeaderProps
  extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}

export const PanelHeader = forwardRef<HTMLElement, PanelHeaderProps>(
  function PanelHeader({ title, meta, actions, className, ...props }, ref) {
    return (
      <header
        ref={ref}
        className={classes('ui-panel-header', className)}
        {...props}
      >
        <strong>{title}</strong>
        {meta !== undefined && meta !== null && <span>{meta}</span>}
        {actions !== undefined && actions !== null && <div>{actions}</div>}
      </header>
    )
  },
)

export const PanelBody = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function PanelBody({ className, ...props }, ref) {
  return (
    <div ref={ref} className={classes('ui-panel-body', className)} {...props} />
  )
})
