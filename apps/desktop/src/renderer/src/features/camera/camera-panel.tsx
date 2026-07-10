import { useEffect, useState } from 'react'
import type {
  CaptureDeviceState,
  CaptureProjection,
} from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import { selectCameraPanelModel } from '../../state/projection-selectors'
import { useElapsedSeconds } from '../../hooks/use-elapsed-seconds'
import { useSetExposureDurationMutation } from '../../mutations/use-workspace-mutations'
import './camera-panel.css'

const EXPOSURE_PHASE_LABELS: Record<CaptureProjection['phase'], string> = {
  idle: 'Idle',
  starting: 'Starting',
  capturing: 'Exposing',
  stopped: 'Stopped',
  failed: 'Failed',
  partial: 'Partial',
}

const DEVICE_STATE_LABELS: Record<CaptureDeviceState, string> = {
  idle: 'Idle',
  exposing: 'Exposing',
  reading: 'Reading',
  ready: 'Ready',
  error: 'Error',
}

const DEFAULT_EXPOSURE_SEC = 1

export function CameraPanel() {
  const { available, camera, capture } = useProjectionStore(selectCameraPanelModel)
  const setExposureMutation = useSetExposureDurationMutation()
  const [draftSec, setDraftSec] = useState<string>(
    String(camera?.exposureSec ?? DEFAULT_EXPOSURE_SEC),
  )

  useEffect(() => {
    setDraftSec(String(camera?.exposureSec ?? DEFAULT_EXPOSURE_SEC))
  }, [camera?.exposureSec])

  const elapsed = useElapsedSeconds(capture)

  if (!available) return null

  const isExposing = capture.phase === 'capturing' || capture.phase === 'starting'
  const configuredSec = camera?.exposureSec ?? DEFAULT_EXPOSURE_SEC
  const parsedDraft = Number(draftSec)
  const draftValid =
    Number.isFinite(parsedDraft) && parsedDraft > 0 && parsedDraft <= 3600
  const dirty = draftValid && parsedDraft !== configuredSec
  const canSubmit = dirty && !setExposureMutation.isPending && !isExposing

  return (
    <div className="camera-panel">
      <div className="panel-header">
        <span>Camera</span>
      </div>
      <div className="panel-body camera-panel-body">
        <div className="kv">
          <span>Exposure</span>
          <strong id="cameraExposurePhase">
            {EXPOSURE_PHASE_LABELS[capture.phase]}
          </strong>
          {capture.deviceState ? (
            <>
              <span>Device</span>
              <strong id="cameraDeviceState">
                {DEVICE_STATE_LABELS[capture.deviceState]}
              </strong>
            </>
          ) : null}
          <span>Duration</span>
          <strong id="cameraExposureDuration">
            {formatDuration(configuredSec)}
          </strong>
          {isExposing && capture.startedAt ? (
            <>
              <span>Elapsed</span>
              <strong id="cameraExposureElapsed">{formatElapsed(elapsed)}</strong>
            </>
          ) : null}
        </div>

        <div className="control-block">
          <div className="field-label">Exposure time (seconds)</div>
          <div className="camera-exposure-row">
            <input
              id="cameraExposureInput"
              type="number"
              min={0.1}
              max={3600}
              step={0.1}
              className="camera-exposure-input"
              value={draftSec}
              disabled={isExposing}
              onChange={(event) => setDraftSec(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm primary"
              id="btnSetExposure"
              disabled={!canSubmit}
              onClick={() => setExposureMutation.mutate(parsedDraft)}
            >
              {setExposureMutation.isPending ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </div>

        {(capture.phase === 'failed' || capture.phase === 'partial') &&
        capture.lastError ? (
          <p className="camera-error" id="cameraExposureError">
            {capture.lastError}
          </p>
        ) : null}
        {setExposureMutation.isError ? (
          <p className="camera-error">
            {setExposureMutation.error instanceof Error
              ? setExposureMutation.error.message
              : 'Failed to set exposure duration.'}
          </p>
        ) : null}
        <p className="help-line">
          Single exposure only. Start and stop from the work area action bar.
        </p>
      </div>
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  if (Number.isInteger(seconds)) return `${seconds}s`
  return `${seconds.toFixed(1)}s`
}

function formatElapsed(seconds: number | null): string {
  if (seconds == null) return '—'
  const whole = Math.floor(seconds)
  return `${whole}s`
}
