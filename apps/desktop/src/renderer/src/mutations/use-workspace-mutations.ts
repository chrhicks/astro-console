import { useMutation } from '@tanstack/react-query'
import { electronApi } from '../lib/electron-api'

export function usePointToTargetMutation() {
  return useMutation({
    mutationKey: ['pointing', 'point-to-target'],
    mutationFn: (targetId: string) =>
      electronApi.pointToTarget({ targetId }),
  })
}

export function useStartPreviewMutation() {
  return useMutation({
    mutationKey: ['preview', 'start'],
    mutationFn: () => electronApi.startPreview(),
  })
}

export function useStopPreviewMutation() {
  return useMutation({
    mutationKey: ['preview', 'stop'],
    mutationFn: () => electronApi.stopPreview(),
  })
}

export function useStartCaptureMutation() {
  return useMutation({
    mutationKey: ['capture', 'start'],
    mutationFn: () => electronApi.startCapture(),
  })
}

export function useStopCaptureMutation() {
  return useMutation({
    mutationKey: ['capture', 'stop'],
    mutationFn: () => electronApi.stopCapture(),
  })
}

export function useParkMountMutation() {
  return useMutation({
    mutationKey: ['mount', 'park'],
    mutationFn: () => electronApi.parkMount(),
  })
}
