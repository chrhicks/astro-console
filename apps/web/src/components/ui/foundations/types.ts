import type { CSSProperties, ReactNode } from 'react'

export type Tone = 'neutral' | 'positive' | 'warning' | 'danger' | 'info'
export type Density = 'compact' | 'comfortable'

export interface CommonComponentProps {
  className?: string
  style?: CSSProperties
}

export interface ActionDescriptor {
  id: string
  label: ReactNode
  onSelect?: () => void
  tone?: 'primary' | 'secondary' | 'danger' | 'quiet'
  disabled?: boolean
  description?: ReactNode
}
