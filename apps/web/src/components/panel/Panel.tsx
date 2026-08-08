import { useId, type ReactNode } from 'react'
import './style.css'

/**
 * Panel — an owned working region with a title that names its fact or
 * decision, plus an optional note for the bound or qualifier. Not a card:
 * do not use one per datum.
 */
export function Panel({
  title,
  note,
  as,
  className,
  children,
}: {
  title: string
  note?: string
  as?: 'section' | 'aside' | 'div'
  className?: string
  children: ReactNode
}) {
  const Tag = as ?? 'section'
  const headingId = useId()
  return (
    <Tag
      className={`panel${className ? ` ${className}` : ''}`}
      aria-labelledby={headingId}
    >
      <header className="panel__header">
        <span className="panel__title" id={headingId}>
          {title}
        </span>
        {note ? <span className="panel__note">{note}</span> : null}
      </header>
      {children}
    </Tag>
  )
}
