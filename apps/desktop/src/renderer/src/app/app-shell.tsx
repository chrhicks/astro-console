import './app-shell.css'
import { SessionBar } from '../features/session/session-bar'

export function AppShell() {
  return (
    <div className="app-shell">
      <div className="app-shell-header">
        <SessionBar />
      </div>
      <div className="workspace-grid" id="grid">
        <aside className="panel panel-left" id="leftPanel">
          <div className="panel-header" style="display: flex; gap: 0.35rem">
            <span>Targets</span>
            <span className="spacer"></span>
            <button
              type="button"
              className="btn btn-sm icon-btn"
              id="collapseLeft"
              title="Collapse panel"
            >
              ◧
            </button>
          </div>
          <div className="filter-row">
            <input
              type="search"
              id="targetSearch"
              placeholder="Search catalog…"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn btn-sm icon-btn"
              id="btnFavorites"
              title="Favorites only"
            >
              ★
            </button>
            <button
              type="button"
              className="btn btn-sm"
              id="btnUpNow"
              title="Up now only"
            >
              Up now
            </button>
          </div>
          <div
            className="panel-body"
            id="targetList"
            style={{ padding: 0, overflow: 'auto' }}
          ></div>
        </aside>

        <section className="panel-center panel">
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
        </section>

        <aside className="panel panel-right">
          <div className="panel-header">
            <span>Inspector</span>
          </div>
          <div className="panel-body" style={{ padding: 0, overflow: 'auto' }}>
            <details className="inspector-acc" open>
              <summary>Capture</summary>
              <div className="acc-body">
                <div className="control-block">
                  <div className="field-label">Mode</div>
                  <select id="captureMode">
                    <option value="dso">Deep-sky stack</option>
                    <option value="planet">Planet stack</option>
                    <option value="moon">Moon stack</option>
                    <option value="sun">Sun stack</option>
                    <option value="video">Video</option>
                  </select>
                </div>
                <div className="control-block">
                  <div className="field-label">Filter (recommended)</div>
                  <select id="filterSelect">
                    <option value="lp">Light pollution (auto)</option>
                    <option value="clear">Clear</option>
                    <option value="ir">IR cut</option>
                  </select>
                </div>
                <div className="control-block">
                  <div className="field-label">Stop when</div>
                  <select id="stopRule">
                    <option value="manual">I press Stop</option>
                    <option value="set">Target sets below horizon</option>
                  </select>
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-sm primary"
                    id="btnStartStack"
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
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    id="btnRestart"
                    disabled
                  >
                    Restart stack
                  </button>
                  <button type="button" className="btn btn-sm" id="btnContinue">
                    Continue stack
                  </button>
                </div>
                <p className="help-line">
                  <strong>Restart</strong> clears the in-progress stack.{' '}
                  <strong>Continue</strong> adds to last night’s stack on
                  device.
                </p>
              </div>
            </details>
            <details className="inspector-acc">
              <summary>Mount &amp; pointing</summary>
              <div className="acc-body">
                <div className="kv">
                  <span>Pointing</span>
                  <strong id="pointingStatus">Arrived at target</strong>
                  <span>Last goto</span>
                  <strong id="lastGoto">Just now</strong>
                  <span>Mount</span>
                  <strong id="mountStatus">Open</strong>
                  <span>Filter wheel</span>
                  <strong id="filterWheel">LP</strong>
                  <span>View mode</span>
                  <strong id="viewMode">Deep-sky (star)</strong>
                  <span>Device temp</span>
                  <strong>28°C</strong>
                </div>
              </div>
            </details>
          </div>
        </aside>

        <footer className="panel panel-filmstrip">
          <div
            className="panel-header"
            style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
          >
            <span>Library</span>
            <span className="panel-collapse-hint" id="filmstripHint">
              M42 · newest subs while capturing
            </span>
            <span className="spacer"></span>
            <button type="button" className="btn btn-sm" id="expandFilm">
              Expand strip
            </button>
            <button type="button" className="btn btn-sm" id="libraryScope">
              All targets
            </button>
          </div>
          <div className="filmstrip-body" id="filmstripBody"></div>
        </footer>
      </div>
    </div>
  )
}
