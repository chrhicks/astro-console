import {
  createElement,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { classes } from './foundations/utils'
import './PageHeader.css'

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface PageHeaderProps
  extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  headingLevel?: HeadingLevel
}

export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(
  function PageHeader(
    { eyebrow, title, meta, actions, headingLevel = 1, className, ...props },
    ref,
  ) {
    return (
      <header
        ref={ref}
        className={classes('ui-page-header', className)}
        {...props}
      >
        <div className="ui-page-header-copy">
          {eyebrow !== undefined && eyebrow !== null && <p>{eyebrow}</p>}
          {createElement(`h${headingLevel}`, null, title)}
          {meta !== undefined && meta !== null && <span>{meta}</span>}
        </div>
        {actions !== undefined && actions !== null && (
          <div className="ui-page-header-actions">{actions}</div>
        )}
      </header>
    )
  },
)
