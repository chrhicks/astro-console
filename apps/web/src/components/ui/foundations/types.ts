import type { ReactNode } from 'react'

export type Tone = 'neutral' | 'positive' | 'warning' | 'danger' | 'info'

export interface ActionDescriptor {
  id: string
  label: ReactNode
  onSelect?: () => void
  tone?: 'primary' | 'secondary' | 'danger' | 'quiet'
  disabled?: boolean
  description?: ReactNode
}
