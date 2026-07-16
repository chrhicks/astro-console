import type { CaptureProjection, ExternalSequenceProjection } from './api-v2'

export function isCaptureInFlight(phase: CaptureProjection['phase']) {
  return phase === 'starting' || phase === 'capturing'
}

export function isExternalSequenceActive(
  phase: ExternalSequenceProjection['phase'],
) {
  return phase === 'lights' || phase === 'awaiting-darks' || phase === 'darks'
}

export function isExternalSequenceTerminal(
  phase: ExternalSequenceProjection['phase'],
) {
  return phase === 'idle' || phase === 'complete' || phase === 'stopped' || phase === 'failed'
}

export function isExternalSequenceRecoveryActive(
  phase: ExternalSequenceProjection['phase'],
) {
  return isExternalSequenceActive(phase)
}
