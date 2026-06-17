import { useState } from 'react'
import type { DesktopDiscoveredDeviceV2 } from '../../../../shared/api-v2'
import { selectSessionBarModel } from '../../state/projection-selectors'
import { useProjectionStore } from '../../state/projection-store'
import './session-bar.css'
import { useConnectMutation } from './use-connect-mutation'
import { useDiscoverMutation } from './use-discover-mutation'
import { useDisconnectMutation } from './use-disconnect-mutation'

export function SessionBar() {
  const {
    phase,
    host,
    productModel,
    discovering,
    deviceId,
    serialNumber,
    batteryPercent,
    tracking,
    pluginKind,
  } = useProjectionStore(selectSessionBarModel)
  const isConnected = phase === 'connected'
  const isConnecting = phase === 'connecting'
  const isDisconnecting = phase === 'disconnecting'

  const [discoveredDevices, setDiscoveredDevices] = useState<
    DesktopDiscoveredDeviceV2[]
  >([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  const connectedDeviceId = deviceId

  const connectMutation = useConnectMutation()
  const discoverMutation = useDiscoverMutation()
  const disconnectMutation = useDisconnectMutation()

  const selectedDevice =
    discoveredDevices.find((device) => device.deviceId === selectedDeviceId) ??
    discoveredDevices.find((device) => device.deviceId === connectedDeviceId) ??
    selectPreferredDevice(discoveredDevices)
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
        setSelectedDeviceId((current) =>
          current && devices.some((device) => device.deviceId === current)
            ? current
            : null,
        )
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
        {discovering || discoverMutation.isPending
          ? 'Discovering...'
          : 'Discover'}
      </button>
      <select
        value={selectedDevice?.deviceId ?? ''}
        disabled={isBusy || discoveredDevices.length === 0 || isConnected}
        onChange={(event) =>
          setSelectedDeviceId(event.currentTarget.value || null)
        }
      >
        {discoveredDevices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {formatDeviceOptionLabel(device)}
          </option>
        ))}
      </select>
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
      <span className="chip">
        {productModel ?? 'Device: Unknown'}
        {serialNumber ? ` · ${serialNumber}` : ''}
      </span>
      <span className="chip" id="chipHost">
        {host ?? 'Host: Unknown'}
      </span>
      {batteryPercent != null ? (
        <span className={`chip ${batteryPercent < 20 ? 'warn' : 'ok'}`}>
          Battery {batteryPercent}%
        </span>
      ) : null}
      {tracking != null ? (
        <span className={`chip ${tracking ? 'ok' : ''}`}>
          Tracking {tracking ? 'On' : 'Off'}
        </span>
      ) : null}
      {pluginKind?.startsWith('fake-') ? (
        <span className="chip warn">Fake</span>
      ) : null}

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

function formatDeviceOptionLabel(device: DesktopDiscoveredDeviceV2): string {
  const source = device.pluginKind === 'fake-seestar' ? 'fake' : 'live'
  return [device.displayName, device.host, device.serialNumber, source]
    .filter(Boolean)
    .join(' . ')
}

function selectPreferredDevice(
  devices: DesktopDiscoveredDeviceV2[],
): DesktopDiscoveredDeviceV2 | undefined {
  return devices.find((device) => device.pluginKind === 'seestar') ?? devices[0]
}
