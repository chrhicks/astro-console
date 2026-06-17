import './work-area.css'

export default function WorkArea() {
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
          <strong>M42</strong> · Orion Nebula
        </span>
        <button
          type="button"
          className="btn btn-sm icon-btn"
          title="Fullscreen preview"
        >
          ⛶
        </button>
      </div>

      <div className="preview-stage" id="previewStage">
        <div className="preview-canvas"></div>
        <div className="preview-scan"></div>
        <span className="preview-badge" id="previewBadge">
          Live · RTSP
        </span>
        <div className="preview-overlay" id="previewOverlay">
          <div className="spinner"></div>
          <h3 id="overlayTitle">Slewing to M42…</h3>
          <p id="overlayDetail">Opening arm · setting filter · goto</p>
        </div>
      </div>

      <div className="metric-strip">
        <span className="metric stacking">
          Stacks <strong id="metricStacks">47</strong>
        </span>
        <span className="metric">
          Elapsed <strong id="metricElapsed">12:04</strong>
        </span>
        <span className="metric">
          Frames <strong id="metricFrames">188</strong>
        </span>
        <span className="metric">
          Tracking <strong id="metricTrack">Ready</strong>
        </span>
      </div>
    </div>
  )
}
