export interface SessionAggregate {
  session: SessionState
  pointing: PointingState
  capture: CaptureState
  preview: PreviewState
  device: DeviceState
  library: LibraryState
  currentTarget: TargetSummary | null
  runner: RunnerState
  diagnostics: DiagnosticsState
}