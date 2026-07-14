import type {
  CaptureProjection,
  PointingProjection,
  WorkspaceProjection,
} from '../../../../shared/api-v2'
import type { CapturePresentation } from '../../state/projection-selectors'
import { EXTERNAL_PREVIEW_FAILURE_COPY } from './external-preview-failure-copy'

const STATUS_MESSAGES: Record<WorkspaceProjection['state'], string> = {
  disconnected: 'Connect a device to begin.',
  idle_no_target: 'Select a target to point the telescope.',
  primed: 'Ready to preview or capture.',
  ready_to_slew: 'Slew failed. Retry to try again.',
  slewing: 'Slewing to target…',
  on_target: 'Ready to preview or capture.',
  preview_starting: 'Starting live preview…',
  preview_active: 'Live preview active.',
  preview_error: 'Preview failed to start.',
  capturing: 'Stacking frames.',
  parked: 'Mount is parked. Slew or unpark before resuming.',
}

export function decideWorkAreaStatus(
  capture: CaptureProjection,
  pointing: PointingProjection,
  workspace: WorkspaceProjection,
  capturePresentation: CapturePresentation,
) {
  if (capture.phase === 'failed') {
    return capturePresentation === 'exposure'
      ? 'Exposure failed. Retry or start preview.'
      : 'Capture failed. Retry or start preview.'
  }
  if (capture.phase === 'partial') {
    return capturePresentation === 'exposure'
      ? EXTERNAL_PREVIEW_FAILURE_COPY
      : 'Capture completed but frame was not saved. Retry or start preview.'
  }
  if (pointing.phase === 'failed' && pointing.lastError) return pointing.lastError
  if (capturePresentation === 'exposure' && workspace.state === 'capturing') {
    return 'Exposure running.'
  }
  if (
    capturePresentation === 'exposure' &&
    (workspace.state === 'on_target' || workspace.state === 'primed')
  ) {
    return 'Ready to preview or expose.'
  }
  return STATUS_MESSAGES[workspace.state]
}
