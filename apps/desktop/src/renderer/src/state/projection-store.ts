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
// Bumped on every dispose so in-flight init results and subscription callbacks
// from a stale lifecycle can detect they are outdated and bail before writing.
let lifecycleGeneration = 0

export function getProjectionState(): ProjectionState {
  return state
}

function setState(next: ProjectionState) {
  state = next
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

export function applyDesktopStatusToProjectionStore(status: DesktopStatus) {
  const current = state.status
  if (current && (current.statusRevision > status.statusRevision || (current.statusRevision === status.statusRevision && current.lastUpdatedAt !== status.lastUpdatedAt))) return
  setState({ status, hydrated: true, error: null })
  if (status.session.phase === 'disconnected') {
    setSelectedTarget(null)
  }
}

export async function initializeProjectionStore() {
  if (initializePromise) return initializePromise

  const generation = ++lifecycleGeneration

  initializePromise = (async () => {
    // Declared outside the try block so the catch path can tell whether a
    // live event already established a healthy subscribed state.
    let receivedEvent = false
    try {
      stopStatusSubscription?.()
      stopStatusSubscription = null

      // Subscribe before fetching the snapshot so status updates pushed
      // between the snapshot and the subscription are not lost. The handler
      // stamps receivedEvent so the snapshot does not regress a newer event
      // that arrived while getStatus was in flight.
      stopStatusSubscription = electronApi.onStatus((nextStatus) => {
        if (generation !== lifecycleGeneration) return
        receivedEvent = true
        applyDesktopStatusToProjectionStore(nextStatus)
      })

      const status = await electronApi.getStatus()
      if (generation !== lifecycleGeneration) return
      if (!receivedEvent) {
        applyDesktopStatusToProjectionStore(status)
      }
    } catch (error) {
      if (generation !== lifecycleGeneration) return
      // A live event already established a healthy subscribed state; keep it
      // and let the subscription keep delivering instead of clobbering with
      // the snapshot error.
      if (receivedEvent) return
      setState({
        status: null,
        error: error instanceof Error ? error.message : String(error),
        hydrated: true,
      })
    }
  })()

  return initializePromise
}

export function disposeProjectionStore() {
  lifecycleGeneration++
  stopStatusSubscription?.()
  stopStatusSubscription = null
  initializePromise = null

  setSelectedTarget(null)
  setState({ status: null, hydrated: false, error: null })
}

export function useProjectionStore<T>(
  selector: (state: ProjectionState) => T,
): T {
  const snapshot = useSyncExternalStore(subscribe, getProjectionState, getProjectionState)
  return selector(snapshot)
}
