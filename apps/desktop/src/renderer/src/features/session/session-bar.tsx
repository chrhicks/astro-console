import { useState } from 'react'
import type { DesktopDiscoveredDeviceV2 } from '../../../../shared/api-v2'
import { selectSessionBarModel } from '../../state/projection-selectors'
import { useProjectionStore } from '../../state/projection-store'
import { useParkMountMutation } from '../../mutations/use-workspace-mutations'
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
    mountClosed,
    canPark,
    pluginKind,
    location,
    locationSource,
    deviceTimeLooksStale,
    warnings,
    lastError,
  } = useProjectionStore(selectSessionBarModel)
  const isConnected = phase === 'connected'
  const isConnecting = phase === 'connecting'
  const isDisconnecting = phase === 'disconnecting'
  const parkSupported = canPark !== false

  const [discoveredDevices, setDiscoveredDevices] = useState<
    DesktopDiscoveredDeviceV2[]
  >([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  const connectMutation = useConnectMutation()
  const discoverMutation = useDiscoverMutation()
  const disconnectMutation = useDisconnectMutation()
  const parkMutation = useParkMountMutation()

  const selectedDevice = selectPreferredDevice(
    discoveredDevices,
    selectedDeviceId,
    deviceId,
  )
  const isBusy =
    isConnecting ||
    isDisconnecting ||
    connectMutation.isPending ||
    disconnectMutation.isPending ||
    discoverMutation.isPending ||
    parkMutation.isPending

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
      {location ? (
        <span
          className="chip"
          title={
            locationSource === 'geoip'
              ? 'Approximate location from IP lookup'
              : 'Device-reported location'
          }
        >
          {locationSource === 'geoip' ? 'Approx Loc ' : 'Loc '}
          {location.lat.toFixed(2)}, {location.lon.toFixed(2)}
        </span>
      ) : null}
      {deviceTimeLooksStale ? (
        <span className="chip warn" title="Device clock looks out of date">
          Device time stale
        </span>
      ) : null}
      {warnings && warnings.length > 0 ? (
        <span className="chip warn" title={warnings.join('\n')}>
          {warnings.length} warning{warnings.length > 1 ? 's' : ''}
        </span>
      ) : null}
      {pluginKind ? (
        <span className={`chip${pluginKind.startsWith('fake-') ? ' warn' : ''}`}>
          {describePluginKind(pluginKind)}
        </span>
      ) : null}
      {lastError && !isConnected ? (
        <span
          className="chip danger"
          title={lastError}
        >
          {lastError.length > 48 ? `${lastError.slice(0, 48)}…` : lastError}
        </span>
      ) : null}

      <span className="spacer"></span>
      <button
        type="button"
        className="btn btn-sm"
        id="btnPark"
        disabled={!isConnected || !parkSupported || mountClosed || parkMutation.isPending}
        onClick={() => parkMutation.mutate()}
      >
        {parkMutation.isPending
          ? 'Parking...'
          : !parkSupported
            ? 'Park N/A'
            : mountClosed
              ? 'Parked'
              : 'Park'}
      </button>
    </header>
  )
}

function formatDeviceOptionLabel(device: DesktopDiscoveredDeviceV2): string {
  return [
    device.displayName,
    describePluginKind(device.pluginKind),
    device.host,
    device.serialNumber,
  ]
    .filter(Boolean)
    .join(' · ')
}

function selectPreferredDevice(
  devices: DesktopDiscoveredDeviceV2[],
  selectedDeviceId: string | null,
  connectedDeviceId: string | undefined,
): DesktopDiscoveredDeviceV2 | undefined {
  return (
    devices.find((device) => device.deviceId === connectedDeviceId) ??
    devices.find((device) => device.deviceId === selectedDeviceId) ??
    devices.find((device) => device.pluginKind !== 'fake-seestar') ??
    devices[0]
  )
}

function describePluginKind(pluginKind: DesktopDiscoveredDeviceV2['pluginKind']) {
  switch (pluginKind) {
    case 'alpaca-rig':
      return 'Alpaca rig'
    case 'fake-seestar':
      return 'Simulator'
    case 'seestar':
      return 'Seestar'
  }
}
