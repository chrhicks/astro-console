import { Data } from 'effect'
import type { AssetId } from './routes'

export type Workspace = 'plan' | 'observe' | 'library' | 'process'
export type StatusTone = 'safe' | 'attention' | 'danger' | 'neutral'
export type Availability = 'available' | 'unavailable' | 'protected'

export type Action = {
  label: string
  availability: Availability
  consequence: string
  reason: string
  freshness: string
  controller: string
  capability: string
  protection: string
}

export type ActionResult = Data.TaggedEnum<{
  Pending: { readonly message: string }
  Rejected: { readonly message: string }
  Unavailable: { readonly message: string }
}>

export const ActionResult = Data.taggedEnum<ActionResult>()

export function actionAvailability({
  fresh,
}: {
  fresh: boolean
}): Availability {
  return fresh ? 'unavailable' : 'protected'
}

export function actionResult(action: Action): ActionResult {
  if (action.availability === 'available') {
    return ActionResult.Pending({
      message: `${action.label} is pending. ${action.consequence}`,
    })
  }
  if (action.availability === 'protected') {
    return ActionResult.Rejected({
      message: `${action.label} is protected. ${action.reason} ${action.protection}`,
    })
  }
  return ActionResult.Unavailable({
    message: `${action.label} is unavailable. ${action.reason} ${action.protection}`,
  })
}

export type ShellView = {
  service: string
  environment: string
  attention: StatusTone
  readOnly: boolean
  activeRun: string
  phase: string
  progress: string
  progressValue: number
  progressMax: number
  sequenceProgress: string
  freshness: string
  controller: string
  capability: string
  protection: string
}
export type PlanView = {
  title: string
  readiness: string
  sequences: readonly {
    id: string
    target: string
    window: string
    capture: string
    readiness: string
  }[]
  action?: Action
}
export type ObserveView = {
  target: string
  phase: string
  status: string
  tone: StatusTone
  evidence: string
  annotation: string
  heading: string
  trace: readonly string[]
  facts: readonly string[]
  lifecycle: readonly string[]
  recovery?: string
  action?: Action
}
export type LibraryAsset = {
  id: AssetId
  name: string
  review: string
  lineage: string
  representation: string
  download: string
}
export type LibraryView = { assets: readonly LibraryAsset[]; action?: Action }
export type ProcessView = {
  sessionId: string
  label: string
  source: string
  steps: readonly { label: string; status: string }[]
  preview: string
  checkpoint: string
  diagnostics: string
  failure?: string
  action?: Action
}
export type Projection = {
  shell: ShellView
  plan: PlanView
  observe: ObserveView
  library: LibraryView
  process: ProcessView
}
