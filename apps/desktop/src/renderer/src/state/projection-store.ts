import { useSyncExternalStore } from 'react'
import type { DesktopStatus } from '../../../shared/api-v2'
import { electronApi } from '../lib/electron-api'
import { setSelectedTarget } from './selected-target-store'

export type ProjectionState = {
  status: DesktopStatus | null
  hydrated: boolean
  error: string | null
}

let state: ProjectionState = {
  status: null,
  hydrated: false,
  error: null,
}

const listeners = new Set<() => void>()
let stopStatusSubscription: (() => void) | null = null
let initializePromise: Promise<void> | null = null

function getState(): ProjectionState {
  return state
}

function setState(next: ProjectionState) {
  state = next
  emit()
}

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function initializeProjectionStore() {
  if (initializePromise) return initializePromise

  initializePromise = (async () => {
    try {
      const status = await electronApi.getStatus()
      setState({ status, hydrated: true, error: null })

      if (stopStatusSubscription) {
        stopStatusSubscription()
        stopStatusSubscription = null
      }

      stopStatusSubscription = electronApi.onStatus((nextStatus) => {
        setState({ status: nextStatus, hydrated: true, error: null })
        if (nextStatus.session.phase === 'disconnected') {
          setSelectedTarget(null)
        }
      })
    } catch (error) {
      setState({
        status: null,
        error: toErrorMessage(error),
        hydrated: true,
      })
    }
  })()

  return initializePromise
}

export function disposeProjectionStore() {
  if (stopStatusSubscription) {
    stopStatusSubscription()
    stopStatusSubscription = null
  }
  if (initializePromise) {
    initializePromise = null
  }

  setSelectedTarget(null)
  setState({ status: null, hydrated: false, error: null })
}

export function useProjectionStore<T>(
  selector: (state: ProjectionState) => T,
): T {
  const snapshot = useSyncExternalStore(subscribe, getState, getState)
  return selector(snapshot)
}
