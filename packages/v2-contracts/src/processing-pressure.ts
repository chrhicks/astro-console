import { Data, Schema } from 'effect'

export const HostPressure = Schema.Struct({
  memoryUsedFraction: Schema.Finite,
  storageFreeGiB: Schema.Finite,
  thermalCelsius: Schema.Finite,
  acquisitionWriteBacklogMiB: Schema.Finite,
  captureActive: Schema.Boolean,
})

export type ProcessingPressureDecision = Data.TaggedEnum<{
  Continue: {}
  Throttle: {
    readonly reason: 'MemoryPressure' | 'StoragePressure' | 'WriteBacklog'
  }
  Pause: { readonly reason: 'ThermalProtection' | 'StorageReserveProtected' }
}>

export const ProcessingPressureDecision =
  Data.taggedEnum<ProcessingPressureDecision>()

export const evaluateProcessingPressure = (
  pressure: typeof HostPressure.Type,
): ProcessingPressureDecision => {
  if (pressure.storageFreeGiB < 10)
    return ProcessingPressureDecision.Pause({
      reason: 'StorageReserveProtected',
    })
  if (pressure.thermalCelsius >= 95)
    return ProcessingPressureDecision.Pause({ reason: 'ThermalProtection' })
  if (pressure.memoryUsedFraction >= 0.92)
    return ProcessingPressureDecision.Throttle({ reason: 'MemoryPressure' })
  if (pressure.storageFreeGiB < 50)
    return ProcessingPressureDecision.Throttle({ reason: 'StoragePressure' })
  if (pressure.acquisitionWriteBacklogMiB >= 512)
    return ProcessingPressureDecision.Throttle({ reason: 'WriteBacklog' })
  return ProcessingPressureDecision.Continue()
}
