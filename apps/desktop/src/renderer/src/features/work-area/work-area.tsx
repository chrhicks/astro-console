import { useProjectionStore } from '../../state/projection-store'
import { selectWorkAreaModel } from '../../state/projection-selectors'
import { useSelectedTarget } from '../../state/selected-target-store'
import './work-area.css'

export default function WorkArea() {
  const { pointing, currentTarget } = useProjectionStore(selectWorkAreaModel)
  const selectedTarget = useSelectedTarget((state) => state.target)
  const isSlewing = pointing.phase === 'slewing'
  const displayTarget = isSlewing
    ? (pointing.target ?? currentTarget)
    : (selectedTarget ?? currentTarget)

  return (
    <div>
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

      <div
        className={`preview-stage${isSlewing ? ' slewing' : ''}`}
        id="previewStage"
      >
        <div className="preview-canvas"></div>
        <div className="preview-scan"></div>
        <span className="preview-badge" id="previewBadge">
          Live · RTSP
        </span>
        <div className="preview-overlay" id="previewOverlay">
          <div className="spinner"></div>
          <h3 id="overlayTitle">
            Slewing to {displayTarget?.short ?? 'target'}…
          </h3>
          <p id="overlayDetail">Opening arm · setting filter · goto</p>
        </div>
      </div>

      <div className="metric-strip">
        <span className="metric stacking">
          Stacks <strong id="metricStacks">—</strong>
        </span>
        <span className="metric">
          Elapsed <strong id="metricElapsed">—</strong>
        </span>
        <span className="metric">
          Frames <strong id="metricFrames">—</strong>
        </span>
        <span className="metric">
          Tracking <strong id="metricTrack">—</strong>
        </span>
      </div>
    </div>
  )
}
