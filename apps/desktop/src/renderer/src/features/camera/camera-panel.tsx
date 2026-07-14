import { useEffect, useState } from 'react'
import type {
  CaptureDeviceState,
  CaptureProjection,
} from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import {
  isCaptureInFlight,
  isExternalSequenceActive,
  isExternalSequenceTerminal,
} from '../../../../shared/lifecycle'
import { selectCameraPanelModel } from '../../state/projection-selectors'
import { useElapsedSeconds } from '../../hooks/use-elapsed-seconds'
import { useConfigureExternalSequenceMutation, useContinueExternalSequenceMutation, useFinishExternalSequenceMutation, useSetExposureDurationMutation, useStartExternalSequenceMutation } from '../../mutations/use-workspace-mutations'
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
  const { available, camera, capture, sequence, currentTarget, supportsDarkExposure } = useProjectionStore(selectCameraPanelModel)
  const setExposureMutation = useSetExposureDurationMutation()
  const configureSequence = useConfigureExternalSequenceMutation()
  const startSequence = useStartExternalSequenceMutation()
  const continueSequence = useContinueExternalSequenceMutation()
  const finishSequence = useFinishExternalSequenceMutation()
  const [draftSec, setDraftSec] = useState<string>(
    String(camera?.exposureSec ?? DEFAULT_EXPOSURE_SEC),
  )
  const [lightCount, setLightCount] = useState('1')
  const [darkCount, setDarkCount] = useState('0')

  useEffect(() => {
    setDraftSec(String(camera?.exposureSec ?? DEFAULT_EXPOSURE_SEC))
  }, [camera?.exposureSec])

  useEffect(() => {
    if (!sequence.plan) return
    setDraftSec(String(sequence.plan.durationSec))
    setLightCount(String(sequence.plan.lightCount))
    setDarkCount(String(sequence.plan.darkCount))
  }, [sequence.plan?.darkCount, sequence.plan?.durationSec, sequence.plan?.lightCount])

  const elapsed = useElapsedSeconds(capture)

  if (!available) return null

  const isExposing = isCaptureInFlight(capture.phase)
  const configuredSec = camera?.exposureSec ?? DEFAULT_EXPOSURE_SEC
  const parsedDraft = Number(draftSec)
  const draftValid =
    Number.isFinite(parsedDraft) && parsedDraft > 0 && parsedDraft <= 3600
  const dirty = draftValid && parsedDraft !== configuredSec
  const canSubmit = dirty && !setExposureMutation.isPending && !isExposing
  const plan = { lightCount: Number(lightCount), durationSec: parsedDraft, darkCount: Number(darkCount) }
  const planValid = Number.isInteger(plan.lightCount) && plan.lightCount >= 1 && plan.lightCount <= 360 && Number.isInteger(plan.darkCount) && plan.darkCount >= 0 && plan.darkCount <= 360 && draftValid
  const canStartSequence = planValid && (plan.darkCount === 0 || supportsDarkExposure)
  const lightSeconds = plan.lightCount * plan.durationSec
  const darkSeconds = plan.darkCount * plan.durationSec
  const estimatedStorageMiB = Math.ceil((plan.lightCount + plan.darkCount) * 50 * 1.25)
  const sequenceActive = isExternalSequenceActive(sequence.phase)
  const sequenceError = [configureSequence, startSequence, continueSequence, finishSequence].find((mutation) => mutation.isError)?.error

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
              disabled={isExposing || sequenceActive}
              onChange={(event) => setDraftSec(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm primary"
              id="btnSetExposure"
              disabled={!canSubmit || sequenceActive}
              onClick={() => setExposureMutation.mutate(parsedDraft)}
            >
              {setExposureMutation.isPending ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </div>

        <div className="control-block">
          <div className="field-label">Manual sequence</div>
          <div className="kv">
            <span>Target</span><strong>{(sequence.target ?? currentTarget) ? `${(sequence.target ?? currentTarget)!.short} · ${(sequence.target ?? currentTarget)!.name}` : 'Point to a target first'}</strong>
            <span>Lights</span><input type="number" min={1} max={360} value={lightCount} disabled={sequenceActive} onChange={(event) => setLightCount(event.target.value)} />
            <span>Darks</span><input type="number" min={0} max={360} value={darkCount} disabled={sequenceActive || !supportsDarkExposure} onChange={(event) => setDarkCount(event.target.value)} />
            <span>Plan</span><strong>{planValid ? `${formatDuration(lightSeconds)} lights · ${formatDuration(darkSeconds)} darks · ~${estimatedStorageMiB} MiB` : 'Invalid plan'}</strong>
          </div>
          {!supportsDarkExposure ? <p className="help-line">This camera cannot start dark exposures.</p> : null}
          {isExternalSequenceTerminal(sequence.phase) ? <button type="button" className="btn btn-sm primary" disabled={!canStartSequence || !currentTarget || isExposing || configureSequence.isPending || startSequence.isPending} onClick={() => configureSequence.mutate(plan, { onSuccess: () => startSequence.mutate() })}>Start sequence</button> : null}
          {sequenceActive ? <p className="help-line">{sequence.frameKind} {sequence.currentIndex} · {sequence.completed} completed · {sequence.failed} failed · {capture.deviceState ?? capture.phase}</p> : null}
          {sequence.phase === 'awaiting-darks' ? <><p className="help-line">Cover the lens, then start darks. Sony darks also send Light=false.</p><button type="button" className="btn btn-sm primary" disabled={continueSequence.isPending || finishSequence.isPending} onClick={() => continueSequence.mutate()}>Start darks</button><button type="button" className="btn btn-sm" disabled={continueSequence.isPending || finishSequence.isPending} onClick={() => finishSequence.mutate()}>Finish without darks</button></> : null}
          {isExternalSequenceTerminal(sequence.phase) && sequence.phase !== 'idle' ? <p className="help-line">{sequence.phase}: {sequence.completed} completed, {sequence.failed} failed{sequence.lastError ? ` · ${sequence.lastError}` : ''}</p> : null}
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
        {sequenceError ? (
          <p className="camera-error">
            {sequenceError instanceof Error
              ? sequenceError.message
              : 'Failed to update sequence.'}
          </p>
        ) : null}
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
