import type {
  CaptureProjection,
  PreviewProjection,
  WorkspaceState,
} from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import { selectWorkAreaModel } from '../../state/projection-selectors'
import { useSelectedTarget } from '../../state/selected-target-store'
import {
  usePointToTargetMutation,
  useStartPreviewMutation,
  useStopPreviewMutation,
  useStartCaptureMutation,
  useStopCaptureMutation,
} from '../../mutations/use-workspace-mutations'
import './work-area.css'

const PREVIEW_BADGE_LABELS: Record<PreviewProjection['phase'], string> = {
  none: 'No preview',
  starting: 'Starting preview…',
  active: 'Live · RTSP',
  error: 'Preview error',
}

const CAPTURE_PHASE_LABELS: Record<CaptureProjection['phase'], string> = {
  idle: 'Idle',
  starting: 'Starting',
  capturing: 'Capturing',
  stopped: 'Stopped',
  failed: 'Failed',
}

const STATUS_MESSAGES: Record<WorkspaceState, string> = {
  disconnected: 'Connect a device to begin.',
  idle_no_target: 'Select a target to point the telescope.',
  primed: 'Primed and ready.',
  ready_to_slew: 'Slew failed. Retry to try again.',
  slewing: 'Opening arm · setting filter · goto',
  on_target: 'Ready to preview or capture.',
  preview_starting: 'Starting live preview…',
  preview_active: 'Live preview active.',
  preview_error: 'Preview failed to start.',
  capturing: 'Stacking frames.',
  parked: 'Mount is parked.',
}

const OVERLAY_STATES: ReadonlySet<WorkspaceState> = new Set([
  'disconnected',
  'idle_no_target',
  'ready_to_slew',
  'slewing',
  'preview_starting',
  'preview_error',
  'parked',
])

const CAPABILITY_DEFS = [
  { key: 'preview', label: 'Preview' },
  { key: 'capture', label: 'Capture' },
  { key: 'autofocus', label: 'AF' },
  { key: 'filterWheel', label: 'Filter' },
  { key: 'storage', label: 'Storage' },
] as const

export default function WorkArea() {
  const { pointing, currentTarget, workspace, preview, capture, device, observerContext } =
    useProjectionStore(selectWorkAreaModel)
  const selectedTarget = useSelectedTarget((state) => state.target)
  const pointMutation = usePointToTargetMutation()
  const startPreviewMutation = useStartPreviewMutation()
  const stopPreviewMutation = useStopPreviewMutation()
  const startCaptureMutation = useStartCaptureMutation()
  const stopCaptureMutation = useStopCaptureMutation()
  const isCapturePending =
    startCaptureMutation.isPending || stopCaptureMutation.isPending
  const isSlewing = workspace.state === 'slewing'
  const isCapturing = capture.phase === 'capturing' || capture.phase === 'starting'
  const displayTarget = isSlewing
    ? (pointing.target ?? currentTarget)
    : (selectedTarget ?? currentTarget)
  const retryTargetId = pointing.target?.id ?? null
  const showOverlay = OVERLAY_STATES.has(workspace.state)
  const isConnected = workspace.state !== 'disconnected'
  const hasDeviceLocation = device.location != null
  const hasActiveView =
    device.viewMode != null &&
    device.viewMode !== 'idle' &&
    device.viewMode !== 'none'
  const viewLabel = [device.viewMode, device.viewStage]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
  const statusMessage =
    capture.phase === 'failed'
      ? 'Capture failed. Retry or start preview.'
      : STATUS_MESSAGES[workspace.state]

  return (
    <div className="work-area">
      <div className="work-toolbar">
        <div className="seg" id="workModeSeg" aria-label="Work mode">
          <span className="on" data-mode="live">
            Live
          </span>
          <span data-mode="point">Point</span>
          <span data-mode="view">View</span>
        </div>
        <span className="spacer"></span>
        <span className="work-target-label" id="workTargetLabel">
          {displayTarget ? (
            <>
              <strong>{displayTarget.short}</strong> · {displayTarget.name}
            </>
          ) : (
            <span className="work-target-none">No target selected</span>
          )}
        </span>
        <button
          type="button"
          className="btn btn-sm icon-btn"
          title="Fullscreen preview"
          disabled
        >
          ⛶
        </button>
      </div>

      <div className="work-state-banner" id="workStateBanner">
        <strong className="work-state-label" id="workStateLabel">
          {workspace.stateLabel}
        </strong>
        <span className="work-surface-label" id="workSurfaceLabel">
          {workspace.surface.label}
        </span>
        {displayTarget ? (
          <span className="work-state-target" id="workStateTarget">
            {displayTarget.short}
          </span>
        ) : null}
        <span className="spacer"></span>
        {showOverlay ? null : (
          <span className="work-status-message" id="workStatusMessage">
            {statusMessage}
          </span>
        )}
      </div>

      {isConnected ? (
        <div className="work-context-strip" id="workContextStrip">
          {hasActiveView ? (
            <span className="chip" title="Device view mode">
              View {viewLabel}
            </span>
          ) : null}
          {device.tracking != null ? (
            <span className={`chip${device.tracking ? ' ok' : ''}`}>
              Tracking {device.tracking ? 'On' : 'Off'}
            </span>
          ) : null}
          {observerContext ? (
            <span className="chip" title="Observer location source">
              Loc {observerContext.source}
            </span>
          ) : (
            <span className="chip warn" title="No observer location available">
              No location
            </span>
          )}
          {!hasDeviceLocation ? (
            <span className="chip warn" title="The device did not report a location">
              No device location
            </span>
          ) : null}
          {device.deviceTimeLooksStale ? (
            <span className="chip warn" title="Device clock looks out of date">
              Device time stale
            </span>
          ) : null}
          {device.warnings && device.warnings.length > 0 ? (
            <span className="chip warn" title={device.warnings.join('\n')}>
              {device.warnings.length} warning{device.warnings.length > 1 ? 's' : ''}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        className={`preview-stage${isCapturing ? ' stacking' : ''}`}
        id="previewStage"
      >
        <div className="preview-canvas"></div>
        <div className="preview-scan"></div>
        <span className="preview-badge" id="previewBadge">
          {PREVIEW_BADGE_LABELS[preview.phase]}
        </span>
        {showOverlay ? (
          <div className="preview-overlay show">
            {isSlewing ? <div className="spinner"></div> : null}
            <h3 id="overlayTitle">
              {isSlewing
                ? `Slewing to ${displayTarget?.short ?? 'target'}…`
                : workspace.stateLabel}
            </h3>
            <p id="overlayDetail">{STATUS_MESSAGES[workspace.state]}</p>
            {preview.phase === 'error' && preview.lastError ? (
              <p className="work-overlay-error">{preview.lastError}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="metric-strip">
        <span className="metric stacking">
          Stacks <strong id="metricStacks">{capture.stacks ?? '—'}</strong>
        </span>
        <span className="metric">
          Elapsed <strong id="metricElapsed">{formatElapsed(capture.elapsedSec)}</strong>
        </span>
        <span className="metric">
          Frames <strong id="metricFrames">{capture.frames ?? '—'}</strong>
        </span>
        <span className="metric">
          Capture <strong id="metricCapture">{CAPTURE_PHASE_LABELS[capture.phase]}</strong>
        </span>
      </div>

      {capture.phase === 'failed' && capture.lastError ? (
        <div className="work-error-strip" id="workCaptureError">
          {capture.lastError}
        </div>
      ) : null}

      <div className="work-info-strip">
        <div className="work-capabilities" id="workCapabilities">
          {CAPABILITY_DEFS.map(({ key, label }) => {
            const value = workspace.capabilities[key]
            const on = value === 'native' || value === 'external' || value === 'yes'
            return (
              <span key={key} className={`work-cap${on ? ' on' : ''}`}>
                {label} <strong>{value}</strong>
              </span>
            )
          })}
        </div>
        {workspace.actions.length > 0 ? (
          <div className="work-actions" id="workActions">
            {workspace.actions.map((action) => {
              if (action.id === 'retry-slew') {
                return (
                  <button
                    type="button"
                    key={action.id}
                    className={`work-action-chip${action.enabled ? '' : ' disabled'}${pointMutation.isPending ? ' pending' : ''}`}
                    disabled={
                      !action.enabled ||
                      pointMutation.isPending ||
                      retryTargetId == null
                    }
                    aria-label={`Retry slew to ${pointing.target?.short ?? 'target'}`}
                    onClick={() => {
                      if (retryTargetId) pointMutation.mutate(retryTargetId)
                    }}
                  >
                    {action.label}
                  </button>
                )
              }
              if (action.id === 'preview' || action.id === 'retry-preview') {
                return (
                  <button
                    type="button"
                    key={action.id}
                    className={`work-action-chip${action.enabled ? '' : ' disabled'}${startPreviewMutation.isPending ? ' pending' : ''}`}
                    disabled={!action.enabled || startPreviewMutation.isPending}
                    aria-label={
                      action.id === 'retry-preview'
                        ? 'Retry live preview'
                        : 'Start live preview'
                    }
                    onClick={() => startPreviewMutation.mutate()}
                  >
                    {action.label}
                  </button>
                )
              }
              if (action.id === 'stop-preview') {
                return (
                  <button
                    type="button"
                    key={action.id}
                    className={`work-action-chip${action.enabled ? '' : ' disabled'}${stopPreviewMutation.isPending ? ' pending' : ''}`}
                    disabled={!action.enabled || stopPreviewMutation.isPending}
                    aria-label="Stop live preview"
                    onClick={() => stopPreviewMutation.mutate()}
                  >
                    {action.label}
                  </button>
                )
              }
              if (action.id === 'capture') {
                return (
                  <button
                    type="button"
                    key={action.id}
                    className={`work-action-chip${action.enabled ? '' : ' disabled'}${isCapturePending ? ' pending' : ''}`}
                    disabled={!action.enabled || isCapturePending}
                    aria-label="Start capture"
                    onClick={() => startCaptureMutation.mutate()}
                  >
                    {action.label}
                  </button>
                )
              }
              if (action.id === 'stop-capture') {
                return (
                  <button
                    type="button"
                    key={action.id}
                    className={`work-action-chip${action.enabled ? '' : ' disabled'}${isCapturePending ? ' pending' : ''}`}
                    disabled={!action.enabled || isCapturePending}
                    aria-label="Stop capture"
                    onClick={() => stopCaptureMutation.mutate()}
                  >
                    {action.label}
                  </button>
                )
              }
              return (
                <span
                  key={action.id}
                  className={`work-action-chip${action.enabled ? '' : ' disabled'}`}
                >
                  {action.label}
                </span>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function formatElapsed(seconds: number | undefined): string {
  if (seconds == null) return '—'
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes}m ${remaining}s`
}
