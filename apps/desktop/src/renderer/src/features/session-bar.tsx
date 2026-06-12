import { selectSessionBarModel } from '../state/projection-selectors'
import { useProjectionStore } from '../state/projection-store'
import './session-bar.css'

export function SessionBar() {
  const { phase, host, productModel, discovering } =
    useProjectionStore(selectSessionBarModel)
  const isConnected = phase === 'connected'
  const isConnecting = phase === 'connecting'
  const isDisconnecting = phase === 'disconnecting'

  return (
    <header className="session-bar">
      <span className="status-led" id="statusLed" title="Connection"></span>
      <span className="brand">
        Astro <span>Console</span>
      </span>
      <button
        type="button"
        className="btn btn-sm"
        id="btnDiscover"
        disabled={discovering}
      >
        {discovering ? 'Discovering...' : 'Discover'}
      </button>
      <button
        type="button"
        className="btn btn-sm primary"
        id="btnConnect"
        disabled={isConnecting || isDisconnecting}
      >
        {isConnecting
          ? 'Connecting...'
          : isDisconnecting
            ? 'Disconnecting...'
            : isConnected
              ? 'Connected'
              : 'Connect'}
      </button>
      <span className="chip">{productModel ?? 'Device: Unknown'}</span>
      <span className="chip" id="chipHost">
        {host ?? 'Host: Unknown'}
      </span>
      {/* TODO: Add battery and temperature and tracking status later */}
      {/* <span className="chip ok" id="chipBatt">
        Battery 78%
      </span>
      <span className="chip" id="chipTemp">
        28°C
      </span> 
      <span className="chip ok" id="chipTrack" style={{ display: 'none' }}>
        Tracking on
      </span>*/}
      <span className="spacer"></span>
      <button type="button" className="btn btn-sm" id="btnPark">
        Park
      </button>
      <button
        type="button"
        className="btn btn-sm icon-btn"
        id="btnSettings"
        title="Settings"
      >
        ⚙
      </button>
    </header>
  )
}
