import type { DeviceProjection } from '../../../../shared/api-v2'

export interface WorkAreaTelemetry {
  readonly label: string
  readonly title: string
}

export function workAreaTelemetry(device: DeviceProjection): readonly WorkAreaTelemetry[] {
  const telemetry: WorkAreaTelemetry[] = []
  if (device.deviceTempC !== undefined) {
    telemetry.push({ label: `Temp ${formatTemperature(device.deviceTempC)}°C`, title: 'Device temperature' })
  }
  if (device.batteryTempC !== undefined) {
    telemetry.push({ label: `Batt ${formatTemperature(device.batteryTempC)}°C`, title: 'Battery temperature' })
  }
  if (device.storageFreeMb !== undefined && device.storageTotalMb !== undefined) {
    telemetry.push({
      label: `Storage ${formatMegabytes(device.storageFreeMb)} / ${formatMegabytes(device.storageTotalMb)}`,
      title: 'Free / total device storage',
    })
    return telemetry
  }
  if (device.storageFreeMb !== undefined) {
    telemetry.push({
      label: `Free ${formatMegabytes(device.storageFreeMb)}`,
      title: 'Free device storage',
    })
    return telemetry
  }
  if (device.storageTotalMb !== undefined) {
    telemetry.push({
      label: `Storage ${formatMegabytes(device.storageTotalMb)}`,
      title: 'Total device storage',
    })
  }
  return telemetry
}

function formatMegabytes(value: number): string {
  if (value < 1024) return `${value} MiB`
  return `${Math.round((value / 1024) * 10) / 10} GiB`
}

function formatTemperature(value: number): string {
  return String(Math.round(value * 10) / 10)
}
