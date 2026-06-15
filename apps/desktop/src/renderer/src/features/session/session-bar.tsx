import { useState } from 'react'
import type { DesktopDiscoveredDeviceV2 } from '../../../../shared/api-v2'
import { selectSessionBarModel } from '../../state/projection-selectors'
import { useProjectionStore } from '../../state/projection-store'
import './session-bar.css'
import { useConnectMutation } from './use-connect-mutation'
import { useDiscoverMutation } from './use-discover-mutation'
import { useDisconnectMutation } from './use-disconnect-mutation'

export function SessionBar() {
  const { phase, host, productModel, discovering } =
    useProjectionStore(selectSessionBarModel)
  const isConnected = phase === 'connected'
  const isConnecting = phase === 'connecting'
  const isDisconnecting = phase === 'disconnecting'

  const [discoveredDevices, setDiscoveredDevices] = useState<
    DesktopDiscoveredDeviceV2[]
  >([])
  const connectMutation = useConnectMutation()
  const discoverMutation = useDiscoverMutation()
  const disconnectMutation = useDisconnectMutation()

  const selectedDevice = selectPreferredDevice(discoveredDevices)
  const isBusy =
    isConnecting ||
    isDisconnecting ||
    connectMutation.isPending ||
    disconnectMutation.isPending ||
    discoverMutation.isPending

  const handleDiscover = () => {
    discoverMutation.mutate(undefined, {
      onSuccess: (devices) => {
        setDiscoveredDevices(devices)
      },
    })
  }

  const handleConnect = () => {
    if (isConnected) {
      disconnectMutation.mutate()
      return
    }

    if (!selectedDevice) {
      return
    }

    connectMutation.mutate({
      pluginKind: selectedDevice.pluginKind,
      deviceId: selectedDevice.deviceId,
    })
  }

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
        disabled={discovering || isBusy}
        onClick={handleDiscover}
      >
        {discovering || discoverMutation.isPending ? 'Discovering...' : 'Discover'}
      </button>
      <button
        type="button"
        className="btn btn-sm primary"
        id="btnConnect"
        disabled={isConnected ? isBusy : isBusy || !selectedDevice}
        onClick={handleConnect}
      >
        {isConnecting || connectMutation.isPending
          ? 'Connecting...'
          : isDisconnecting || disconnectMutation.isPending
            ? 'Disconnecting...'
            : isConnected
              ? 'Disconnect'
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

function selectPreferredDevice(
  devices: DesktopDiscoveredDeviceV2[],
): DesktopDiscoveredDeviceV2 | undefined {
  return devices.find((device) => device.pluginKind === 'seestar') ?? devices[0]
}
