import { useMutation } from '@tanstack/react-query'
import { electronApi } from '../lib/electron-api'
import { applyDesktopStatusToProjectionStore } from '../state/projection-store'

export function usePointToTargetMutation() {
  return useMutation({
    mutationKey: ['pointing', 'point-to-target'],
    mutationFn: (targetId: string) =>
      electronApi.pointToTarget({ targetId }),
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useStartPreviewMutation() {
  return useMutation({
    mutationKey: ['preview', 'start'],
    mutationFn: electronApi.startPreview,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useStopPreviewMutation() {
  return useMutation({
    mutationKey: ['preview', 'stop'],
    mutationFn: electronApi.stopPreview,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useStartCaptureMutation() {
  return useMutation({
    mutationKey: ['capture', 'start'],
    mutationFn: electronApi.startCapture,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useStopCaptureMutation() {
  return useMutation({
    mutationKey: ['capture', 'stop'],
    mutationFn: electronApi.stopCapture,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useParkMountMutation() {
  return useMutation({
    mutationKey: ['mount', 'park'],
    mutationFn: electronApi.parkMount,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useUnparkMountMutation() {
  return useMutation({
    mutationKey: ['mount', 'unpark'],
    mutationFn: electronApi.unparkMount,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useSetExposureDurationMutation() {
  return useMutation({
    mutationKey: ['camera', 'set-exposure-duration'],
    mutationFn: (durationSec: number) =>
      electronApi.setExposureDuration({ durationSec }),
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useConfigureExternalSequenceMutation() {
  return useMutation({
    mutationKey: ['sequence', 'configure'],
    mutationFn: electronApi.configureExternalSequence,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useStartExternalSequenceMutation() {
  return useMutation({
    mutationKey: ['sequence', 'start'],
    mutationFn: electronApi.startExternalSequence,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useContinueExternalSequenceMutation() {
  return useMutation({
    mutationKey: ['sequence', 'continue'],
    mutationFn: electronApi.continueExternalSequence,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}

export function useFinishExternalSequenceMutation() {
  return useMutation({
    mutationKey: ['sequence', 'finish'],
    mutationFn: electronApi.finishExternalSequence,
    onSuccess: applyDesktopStatusToProjectionStore,
  })
}
