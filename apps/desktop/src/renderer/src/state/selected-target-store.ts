import { useSyncExternalStore } from 'react'
import type { TargetSummary } from '../../../shared/api-v2'

export type SelectedTargetState = {
  target: TargetSummary | null
}

let state: SelectedTargetState = { target: null }

const listeners = new Set<() => void>()

function setState(next: SelectedTargetState) {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getState(): SelectedTargetState {
  return state
}

export function setSelectedTarget(target: TargetSummary | null) {
  setState({ target })
}

export function useSelectedTarget<T>(
  selector: (state: SelectedTargetState) => T,
): T {
  const snapshot = useSyncExternalStore(subscribe, getState, getState)
  return selector(snapshot)
}
