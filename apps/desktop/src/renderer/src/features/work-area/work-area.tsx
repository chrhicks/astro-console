import { useEffect, useState } from 'react'
import type { PreviewProjection, WorkspaceState } from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import { capturePhaseLabel, selectWorkAreaModel } from '../../state/projection-selectors'
import { useSelectedTarget } from '../../state/selected-target-store'
import { useElapsedSeconds } from '../../hooks/use-elapsed-seconds'
import {
  usePointToTargetMutation,
  useStartPreviewMutation,
  useStopPreviewMutation,
  useStartCaptureMutation,
  useStopCaptureMutation,
  useUnparkMountMutation,
  useAbortSlewMutation,
  useMoveFocuserMutation,
  useSetFilterPositionMutation,
} from '../../mutations/use-workspace-mutations'
import { electronApi } from '../../lib/electron-api'
import { isCaptureInFlight } from '../../../../shared/lifecycle'
import { decideWorkAreaStatus, slewOverlayMessage, STATUS_MESSAGES } from './work-area-status'
import { workAreaTelemetry } from './work-area-telemetry'
import './work-area.css'

const PREVIEW_BADGE_LABELS: Record<PreviewProjection['phase'], string> = {
  none: 'No preview',
  starting: 'Starting preview…',
  active: 'Live',
  error: 'Preview error',
}

const ACTIVITY_LABELS: Record<'idle' | 'previewing' | 'capturing', string> = {
  idle: 'Idle',
  previewing: 'Previewing',
  capturing: 'Capturing',
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

const CAPABILITY_VALUE_LABELS = {
  native: 'yes',
  external: 'ext',
  unsupported: 'no',
  yes: 'yes',
  no: 'no',
} as const

export default function WorkArea() {
  const {
    pointing,
    currentTarget,
    workspace,
    preview,
    capture,
    capturePresentation,
    device,
    latestPreviewPath,
    latestPreviewUnavailable,
    controls,
  } = useProjectionStore(selectWorkAreaModel)
  const selectedTarget = useSelectedTarget((state) => state.target)
  const pointMutation = usePointToTargetMutation()
  const startPreviewMutation = useStartPreviewMutation()
  const stopPreviewMutation = useStopPreviewMutation()
  const startCaptureMutation = useStartCaptureMutation()
  const stopCaptureMutation = useStopCaptureMutation()
  const unparkMutation = useUnparkMountMutation()
  const abortSlewMutation = useAbortSlewMutation()
  const moveFocuserMutation = useMoveFocuserMutation()
  const setFilterPositionMutation = useSetFilterPositionMutation()
  const [focusPosition, setFocusPosition] = useState('')
  const isCapturePending =
    startCaptureMutation.isPending || stopCaptureMutation.isPending
  const isSlewing = workspace.state === 'slewing'
  const isCapturing = isCaptureInFlight(capture.phase)
  const isExternalCapture = capturePresentation === 'exposure'
  const [latestPreviewUrl, setLatestPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!latestPreviewPath) {
      setLatestPreviewUrl(null)
      return
    }
    let cancelled = false
    electronApi
      .getSavedAssetPreview(latestPreviewPath)
      .then((url) => {
        if (!cancelled) setLatestPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setLatestPreviewUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [latestPreviewPath])
  const startedElapsed = useElapsedSeconds(capture)
  const elapsedSec = startedElapsed ?? capture.elapsedSec
  const displayTarget = isSlewing
    ? (pointing.target ?? currentTarget)
    : (selectedTarget ?? currentTarget)
  const retryTargetId = pointing.target?.id ?? null
  const showOverlay = OVERLAY_STATES.has(workspace.state)
  const isConnected = workspace.state !== 'disconnected'
  const hasDeviceLocation = device.location != null
  const telemetry = workAreaTelemetry(device)
  const statusMessage = decideWorkAreaStatus(
    capture,
    pointing,
    workspace,
    capturePresentation,
  )
  const previewBadgeLabel =
    isExternalCapture && latestPreviewUnavailable && preview.phase === 'none'
      ? 'Latest frame unavailable'
      : isExternalCapture && latestPreviewUrl && preview.phase === 'none'
      ? 'Latest frame'
      : PREVIEW_BADGE_LABELS[preview.phase]
  const canFocus = workspace.actions.some((action) => action.id === 'focus' && action.enabled)
  const canFilter = workspace.actions.some((action) => action.id === 'filter' && action.enabled)

  return (
    <div className="work-area">
      <div className="work-toolbar">
        <div className="seg" id="workModeSeg" aria-label="Work mode">
          <span className="on" data-mode="live">
            Live
          </span>
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
          {device.activity && device.activity !== 'idle' ? (
            <span className="chip" title="Device activity">
              {ACTIVITY_LABELS[device.activity]}
            </span>
          ) : null}
          {device.tracking != null ? (
            <span className={`chip${device.tracking ? ' ok' : ''}`}>
              Tracking {device.tracking ? 'On' : 'Off'}
            </span>
          ) : null}
          {device.mountClosed ? (
            <span
              className="chip warn"
              title="Mount is parked or at its park position"
            >
              Mount parked
            </span>
          ) : null}
          {!hasDeviceLocation ? (
            <span
              className="chip warn"
              title="Device did not report a location and IP-based lookup failed"
            >
              No location
            </span>
          ) : null}
          {device.deviceTimeLooksStale ? (
            <span className="chip warn" title="Device clock looks out of date">
              Device time stale
            </span>
          ) : null}
          {telemetry.map((item) => (
            <span key={item.title} className="chip" title={item.title}>
              {item.label}
            </span>
          ))}
          {device.warnings && device.warnings.length > 0 ? (
            <span className="chip warn" title={device.warnings.join('\n')}>
              {device.warnings.length} warning
              {device.warnings.length > 1 ? 's' : ''}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        className={`preview-stage${isCapturing ? ' stacking' : ''}`}
        id="previewStage"
      >
        <div className="preview-canvas"></div>
        {isExternalCapture && latestPreviewUrl ? (
          <img
            className="preview-latest"
            src={latestPreviewUrl}
            alt="Latest exposure"
          />
        ) : null}
        <div className="preview-scan"></div>
        <span className="preview-badge" id="previewBadge">
          {previewBadgeLabel}
        </span>
        {showOverlay ? (
          <div className="preview-overlay show">
            {isSlewing ? <div className="spinner"></div> : null}
            <h3 id="overlayTitle">
              {isSlewing
                ? `Slewing to ${displayTarget?.short ?? 'target'}…`
                : workspace.stateLabel}
            </h3>
            <p id="overlayDetail">
              {pointing.phase !== 'idle' && pointing.step
                ? pointing.step
                : STATUS_MESSAGES[workspace.state]}
            </p>
            {isSlewing ? (
              <p>{slewOverlayMessage(workspace)}</p>
            ) : null}
            {preview.phase === 'error' && preview.lastError ? (
              <p className="work-overlay-error">{preview.lastError}</p>
            ) : null}
            {pointing.phase === 'failed' && pointing.lastError ? (
              <p className="work-overlay-error">{pointing.lastError}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="metric-strip">
        {isExternalCapture ? null : (
          <span className="metric stacking">
            Stacks <strong id="metricStacks">{capture.stacks ?? '—'}</strong>
          </span>
        )}
        <span className="metric">
          Elapsed{' '}
          <strong id="metricElapsed">{formatElapsed(elapsedSec)}</strong>
        </span>
        {isExternalCapture ? null : (
          <span className="metric">
            Frames <strong id="metricFrames">{capture.frames ?? '—'}</strong>
          </span>
        )}
        <span className="metric">
          {isExternalCapture ? 'Exposure' : 'Capture'}{' '}
          <strong id="metricCapture">
            {capturePhaseLabel(capture.phase, capturePresentation)}
          </strong>
        </span>
      </div>

      {controls?.focuser || controls?.filterWheel ? (
        <div className="work-context-strip" aria-label="Manual optical controls">
          {controls.focuser ? (
            <form onSubmit={(event) => {
              event.preventDefault()
              const position = Number(focusPosition)
              if (Number.isInteger(position)) moveFocuserMutation.mutate(position)
            }}>
              <label>
                Focus 0–{controls.focuser.maxStep}
                <input aria-label="Focus position" value={focusPosition} onChange={(event) => setFocusPosition(event.target.value)} disabled={!canFocus || controls.focuser.moving || moveFocuserMutation.isPending} />
              </label>
              <button type="submit" disabled={!canFocus || controls.focuser.moving || moveFocuserMutation.isPending}>Set focus</button>
            </form>
          ) : null}
          {controls.filterWheel ? (
            <label>
              Filter
              <select aria-label="Filter position" value={controls.filterWheel.position} disabled={!canFilter || setFilterPositionMutation.isPending} onChange={(event) => setFilterPositionMutation.mutate(Number(event.target.value))}>
                {controls.filterWheel.names.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {(capture.phase === 'failed' || capture.phase === 'partial') &&
      capture.lastError ? (
        <div className="work-error-strip" id="workCaptureError">
          {capture.lastError}
        </div>
      ) : null}

      <div className="work-info-strip">
        <div
          className="work-capabilities"
          id="workCapabilities"
          aria-label="Device capabilities"
        >
          <span className="work-cap-label">Device</span>
          {CAPABILITY_DEFS.map(({ key, label }) => {
            const value = workspace.capabilities[key]
            const on =
              value === 'native' || value === 'external' || value === 'yes'
            return (
              <span key={key} className={`work-cap${on ? ' on' : ''}`}>
                {label} <strong>{CAPABILITY_VALUE_LABELS[value]}</strong>
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
              if (action.id === 'abort-slew') {
                return (
                  <button
                    type="button"
                    key={action.id}
                    className={`work-action-chip${action.enabled ? '' : ' disabled'}${abortSlewMutation.isPending ? ' pending' : ''}`}
                    disabled={!action.enabled || abortSlewMutation.isPending}
                    aria-label="Abort slew"
                    onClick={() => abortSlewMutation.mutate()}
                  >
                    {abortSlewMutation.isPending ? 'Aborting...' : action.label}
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
                    aria-label={
                      isExternalCapture ? 'Start exposure' : 'Start capture'
                    }
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
                    aria-label={
                      isExternalCapture ? 'Stop exposure' : 'Stop capture'
                    }
                    onClick={() => stopCaptureMutation.mutate()}
                  >
                    {action.label}
                  </button>
                )
              }
              if (action.id === 'unpark') {
                return (
                  <button
                    type="button"
                    key={action.id}
                    className={`work-action-chip${action.enabled ? '' : ' disabled'}${unparkMutation.isPending ? ' pending' : ''}`}
                    disabled={!action.enabled || unparkMutation.isPending}
                    aria-label="Unpark mount"
                    onClick={() => unparkMutation.mutate()}
                  >
                    {unparkMutation.isPending ? 'Unparking...' : action.label}
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
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const remaining = total % 60
  return `${minutes}m ${remaining}s`
}
