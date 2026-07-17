import assert from 'node:assert/strict'
import { it } from 'node:test'
import { workAreaTelemetry } from './work-area-telemetry'

it('renders available device temperature and storage telemetry compactly', () => {
  assert.deepEqual(
    workAreaTelemetry({
      deviceTempC: 42.599998,
      batteryTempC: 19,
      storageFreeMb: 8192,
      storageTotalMb: 16384,
    }),
    [
      { label: 'Temp 42.6°C', title: 'Device temperature' },
      { label: 'Batt 19°C', title: 'Battery temperature' },
      { label: 'Storage 8 GiB / 16 GiB', title: 'Free / total device storage' },
    ],
  )
})

it('omits unavailable telemetry and labels partial storage honestly', () => {
  assert.deepEqual(workAreaTelemetry({}), [])
  assert.deepEqual(workAreaTelemetry({ storageFreeMb: 512 }), [
    { label: 'Free 512 MiB', title: 'Free device storage' },
  ])
})
