import './inspector-panel.css'

export default function InspectorPanel() {
  return (
    <div>
      <div className="panel-header">
        <span>Inspector</span>
      </div>
      <div className="panel-body inspector-panel-body">
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
              <strong>Continue</strong> adds to last night’s stack on device.
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
    </div>
  )
}
