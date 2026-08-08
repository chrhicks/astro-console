import type { ReactNode } from 'react'
import type { StatusTone } from '../../presentation'
import './style.css'

/**
 * Semantic status — the only status grammar. Text plus shape plus tone,
 * never color alone. `role="status"` announces changes to assistive tech.
 */
export function Status({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`semantic-status${className ? ` ${className}` : ''}`}
      data-tone={tone}
      role="status"
    >
      {children}
    </span>
  )
}
