import type { DeviceProjection, PointingProjection, PreviewProjection, TargetDetails } from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import { capturePhaseLabel, selectInspectorModel } from '../../state/projection-selectors'
import {
  setSelectedTarget,
  useSelectedTarget,
} from '../../state/selected-target-store'
import { useElapsedSeconds } from '../../hooks/use-elapsed-seconds'
import { useTargetDetailsQuery } from './use-target-details-query'
import { usePointToTargetMutation } from '../../mutations/use-workspace-mutations'
import './inspector-panel.css'

const POINTING_PHASE_LABELS: Record<PointingProjection['phase'], string> = {
  idle: 'Idle',
  slewing: 'Slewing',
  arrived: 'Arrived',
  failed: 'Failed',
}

const PREVIEW_PHASE_LABELS: Record<PreviewProjection['phase'], string> = {
  none: 'None',
  starting: 'Starting',
  active: 'Active',
  error: 'Error',
}

const ACTIVITY_LABELS: Record<
  NonNullable<DeviceProjection['activity']>,
  string
> = {
  idle: 'Idle',
  previewing: 'Previewing',
  capturing: 'Capturing',
}

export default function InspectorPanel() {
  const target = useSelectedTarget((state) => state.target)
  const {
    isConnected,
    pointing,
    currentTarget,
    capture,
    preview,
    device,
    workspace,
    capturePresentation,
  } = useProjectionStore(selectInspectorModel)
  const details = useTargetDetailsQuery(target?.id ?? null)
  const pointMutation = usePointToTargetMutation()
  const startedElapsed = useElapsedSeconds(capture)

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
  const canSlew =
    isConnected &&
    device.canPoint !== false &&
    !isSlewPending &&
    !isBelowHorizon
  const isExternalCapture = capturePresentation === 'exposure'
  const elapsedSec = startedElapsed ?? capture.elapsedSec
  const captureCapability = workspace.capabilities.capture
  const hasNativeCapture = captureCapability === 'native'
  const hasExternalCapture = captureCapability === 'external'
  const hasFilterWheel = workspace.capabilities.filterWheel === 'yes'

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
                  ? 'Re-slew to target'
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
              Mount is parked. Slew or unpark before resuming.
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
          <summary>{isExternalCapture ? 'Exposure' : 'Capture'}</summary>
          <div className="acc-body">
            <div className="kv">
              <span>{isExternalCapture ? 'Exposure' : 'Capture'}</span>
              <strong id="capturePhase">
                {capturePhaseLabel(capture.phase, capturePresentation)}
              </strong>
              {hasNativeCapture ? (
                <>
                  <span>Stacks</span>
                  <strong id="captureStacks">{capture.stacks ?? '—'}</strong>
                  <span>Frames</span>
                  <strong id="captureFrames">{capture.frames ?? '—'}</strong>
                </>
              ) : null}
              <span>Elapsed</span>
              <strong id="captureElapsed">{formatElapsed(elapsedSec)}</strong>
            </div>
            {(capture.phase === 'failed' || capture.phase === 'partial') &&
            capture.lastError ? (
              <p className="inspector-pointing-error">{capture.lastError}</p>
            ) : null}
            {hasNativeCapture ? (
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
            ) : null}
            {hasFilterWheel && target.recommendedFilter ? (
              <div className="control-block">
                <div className="field-label">Recommended filter</div>
                <strong id="filterSelect">
                  {formatFilterLabel(target.recommendedFilter)}
                </strong>
              </div>
            ) : (
              <p className="help-line" id="filterSelect">
                {hasFilterWheel
                  ? 'No recommended filter for this target.'
                  : 'No filter wheel on this rig.'}
              </p>
            )}
            {hasNativeCapture ? (
              <>
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
                  Capture runs from the work area action bar. These inspector
                  settings are not yet wired.
                </p>
              </>
            ) : hasExternalCapture ? (
              <p className="help-line">
                Exposure runs from the work area action bar. This rig does not
                expose Seestar stacking controls.
              </p>
            ) : (
              <p className="help-line">
                This rig does not expose capture controls.
              </p>
            )}
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
              <strong id="filterWheel">{hasFilterWheel ? 'Yes' : 'No'}</strong>
              <span>Activity</span>
              <strong id="deviceActivity">
                {device.activity ? ACTIVITY_LABELS[device.activity] : '—'}
              </strong>
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
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const remaining = total % 60
  return `${minutes}m ${remaining}s`
}

function formatFilterLabel(filter: 'clear' | 'ir' | 'lp') {
  switch (filter) {
    case 'clear':
      return 'Clear'
    case 'ir':
      return 'IR cut'
    case 'lp':
      return 'Light pollution'
  }
}

function TargetDetails({ target }: { target: TargetDetails }) {
  if (target.kind === 'solar-system') {
    return (
      <div className="kv inspector-target-details">
        <span>Body</span>
        <strong>{target.designation}</strong>
        <span>Class</span>
        <strong>Solar system</strong>
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
