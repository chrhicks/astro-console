import type {
  CaptureProjection,
  DeepSkyTarget,
  PointingProjection,
  PreviewProjection,
  SolarSystemTarget,
} from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import { selectInspectorModel } from '../../state/projection-selectors'
import {
  setSelectedTarget,
  useSelectedTarget,
} from '../../state/selected-target-store'
import { useTargetDetailsQuery } from './use-target-details-query'
import { usePointToTargetMutation } from '../../mutations/use-workspace-mutations'
import './inspector-panel.css'

const POINTING_PHASE_LABELS: Record<PointingProjection['phase'], string> = {
  idle: 'Idle',
  slewing: 'Slewing',
  arrived: 'Arrived',
  failed: 'Failed',
}

const CAPTURE_PHASE_LABELS: Record<CaptureProjection['phase'], string> = {
  idle: 'Idle',
  starting: 'Starting',
  capturing: 'Capturing',
  stopped: 'Stopped',
  failed: 'Failed',
}

const PREVIEW_PHASE_LABELS: Record<PreviewProjection['phase'], string> = {
  none: 'None',
  starting: 'Starting',
  active: 'Active',
  error: 'Error',
}

export default function InspectorPanel() {
  const target = useSelectedTarget((state) => state.target)
  const { isConnected, pointing, currentTarget, capture, preview, device } =
    useProjectionStore(selectInspectorModel)
  const details = useTargetDetailsQuery(target?.id ?? null)
  const pointMutation = usePointToTargetMutation()

  if (!target) {
    return (
      <div>
        <div className="panel-header">
          <span>Inspector</span>
        </div>
        <div className="panel-body inspector-panel-body">
          <p className="inspector-empty">Select a target to inspect.</p>
        </div>
      </div>
    )
  }

  const isSlewing = pointing.phase === 'slewing'
  const isSlewPending = isSlewing || pointMutation.isPending
  const isBelowHorizon = target.visibility === 'blocked'
  const isParked = device.mountClosed === true
  const isAtTarget = !isParked && currentTarget?.id === target.id
  const canSlew = isConnected && !isSlewPending && !isBelowHorizon && !isParked

  return (
    <div>
      <div className="panel-header">
        <span>Inspector</span>
        <button
          type="button"
          className="btn btn-sm icon-btn"
          title="Clear selection"
          onClick={() => setSelectedTarget(null)}
        >
          ✕
        </button>
      </div>
      <div className="panel-body inspector-panel-body">
        <section className="inspector-target">
          <div className="inspector-target-heading">
            <strong>{target.short}</strong>
            <span className="inspector-target-type">{target.type}</span>
          </div>
          <p className="inspector-target-name">{target.name}</p>
          {target.visibility ? (
            <p className="inspector-target-visibility">
              {target.visibilityLabel ?? target.visibility}
            </p>
          ) : null}
          {details.data ? <TargetDetails target={details.data} /> : null}
          {details.isError ? (
            <p className="inspector-pointing-error">
              Failed to load target details.
            </p>
          ) : null}
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-sm primary"
              disabled={!canSlew}
              onClick={() => pointMutation.mutate(target.id)}
            >
              {isSlewPending
                ? 'Slewing…'
                : isAtTarget
                  ? 'At target'
                  : 'Slew to target'}
            </button>
          </div>
          {isSlewing ? (
            <p className="help-line">
              Slew cannot be cancelled from the console.
            </p>
          ) : null}
          {device.mountClosed && !isSlewPending ? (
            <p className="inspector-pointing-error">
              Mount is currently parked/closed.
            </p>
          ) : null}
          {pointing.phase === 'failed' && pointing.lastError ? (
            <p className="inspector-pointing-error">{pointing.lastError}</p>
          ) : null}
          {pointing.phase !== 'idle' ? (
            <p className="inspector-pointing-phase">
              Pointing: {POINTING_PHASE_LABELS[pointing.phase]}
              {pointing.step ? ` · ${pointing.step}` : null}
              {isSlewing && pointing.target && pointing.target.id !== target.id
                ? ` · moving to ${pointing.target.short}`
                : null}
              {currentTarget && currentTarget.id !== target.id
                ? ` · hardware at ${currentTarget.short}`
                : null}
            </p>
          ) : null}
        </section>

        <details className="inspector-acc" open>
          <summary>Capture</summary>
          <div className="acc-body">
            <div className="kv">
              <span>Capture</span>
              <strong id="capturePhase">
                {CAPTURE_PHASE_LABELS[capture.phase]}
              </strong>
              <span>Stacks</span>
              <strong id="captureStacks">{capture.stacks ?? '—'}</strong>
              <span>Frames</span>
              <strong id="captureFrames">{capture.frames ?? '—'}</strong>
              <span>Elapsed</span>
              <strong id="captureElapsed">
                {formatElapsed(capture.elapsedSec)}
              </strong>
            </div>
            {capture.phase === 'failed' && capture.lastError ? (
              <p className="inspector-pointing-error">{capture.lastError}</p>
            ) : null}
            <div className="control-block">
              <div className="field-label">Mode</div>
              <select id="captureMode" defaultValue="dso" disabled>
                <option value="dso">Deep-sky stack</option>
                <option value="planet">Planet stack</option>
                <option value="moon">Moon stack</option>
                <option value="sun">Sun stack</option>
                <option value="video">Video</option>
              </select>
            </div>
            <div className="control-block">
              <div className="field-label">Filter (recommended)</div>
              <select
                id="filterSelect"
                value={target.recommendedFilter ?? 'lp'}
                disabled
              >
                <option value="lp">Light pollution (auto)</option>
                <option value="clear">Clear</option>
                <option value="ir">IR cut</option>
              </select>
            </div>
            <div className="control-block">
              <div className="field-label">Stop when</div>
              <select id="stopRule" defaultValue="manual" disabled>
                <option value="manual">I press Stop</option>
                <option value="set">Target sets below horizon</option>
              </select>
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-sm primary"
                id="btnStartStack"
                disabled
              >
                Start stack
              </button>
              <button
                type="button"
                className="btn btn-sm"
                id="btnStopStack"
                disabled
              >
                Stop
              </button>
            </div>
            <p className="help-line">
              Capture controls are not yet connected to the device.
            </p>
          </div>
        </details>
        <details className="inspector-acc">
          <summary>Mount &amp; pointing</summary>
          <div className="acc-body">
            <div className="kv">
              <span>Pointing</span>
              <strong>{POINTING_PHASE_LABELS[pointing.phase]}</strong>
              <span>Current target</span>
              <strong>{currentTarget?.short ?? 'None'}</strong>
              <span>Mount</span>
              <strong id="mountStatus">
                {device.mountClosed ? 'Parked' : 'Ready'}
              </strong>
              <span>Filter wheel</span>
              <strong id="filterWheel">—</strong>
              <span>View mode</span>
              <strong id="viewMode">{device.viewMode ?? '—'}</strong>
              <span>Preview</span>
              <strong id="previewPhase">
                {PREVIEW_PHASE_LABELS[preview.phase]}
              </strong>
            </div>
          </div>
        </details>
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

function TargetDetails({
  target,
}: {
  target: DeepSkyTarget | SolarSystemTarget
}) {
  if ('body' in target) {
    return (
      <div className="kv inspector-target-details">
        <span>Body</span>
        <strong>{target.designation}</strong>
        <span>View mode</span>
        <strong>{target.viewMode}</strong>
      </div>
    )
  }

  return (
    <div className="kv inspector-target-details">
      <span>RA</span>
      <strong>{formatRa(target.raHours)}</strong>
      <span>Dec</span>
      <strong>{formatDec(target.decDeg)}</strong>
      <span>Type</span>
      <strong>{target.objectType}</strong>
      <span>Constellation</span>
      <strong>{target.constellation}</strong>
      {target.visualMagnitude != null ? (
        <>
          <span>V-Mag</span>
          <strong>{target.visualMagnitude.toFixed(1)}</strong>
        </>
      ) : null}
      {target.surfaceBrightness != null ? (
        <>
          <span>SB</span>
          <strong>{target.surfaceBrightness.toFixed(1)}</strong>
        </>
      ) : null}
      {target.majorAxisArcmin != null ? (
        <>
          <span>Size</span>
          <strong>{target.majorAxisArcmin.toFixed(1)}′</strong>
        </>
      ) : null}
    </div>
  )
}

function formatRa(raHours: number) {
  const hours = Math.floor(raHours)
  const minutes = Math.floor((raHours - hours) * 60)
  const seconds = Math.floor(((raHours - hours) * 60 - minutes) * 60)
  return `${hours}h ${minutes}m ${seconds}s`
}

function formatDec(decDeg: number) {
  const sign = decDeg >= 0 ? '+' : '−'
  const abs = Math.abs(decDeg)
  const degrees = Math.floor(abs)
  const minutes = Math.floor((abs - degrees) * 60)
  return `${sign}${degrees}° ${minutes}′`
}
