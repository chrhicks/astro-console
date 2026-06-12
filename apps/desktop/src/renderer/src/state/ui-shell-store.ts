import { useSyncExternalStore } from "react"

export type UIShellState = {
  settings: 'open' | 'closed'
  leftPanel: 'expanded' | 'collapsed'
  filmstrip: 'expanded' | 'collapsed'
  workMode: 'live' | 'point' | 'view'
}

let uiShellState: UIShellState = {
  settings: 'closed',
  leftPanel: 'expanded',
  filmstrip: 'expanded',
  workMode: 'live',
}

const listeners = new Set<() => void>()

function setState(next: UIShellState) {
  uiShellState = next
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

function getState(): UIShellState {
  return uiShellState
}

export function useShellStore<T>(
  selector: (state: UIShellState) => T
): T {
  const snapshot = useSyncExternalStore(subscribe, getState, getState)
  return selector(snapshot)
}

export function setSettings(next: 'open' | 'closed') {
  setState({ ...uiShellState, settings: next })
}

export function setLeftPanel(next: 'expanded' | 'collapsed') {
  setState({ ...uiShellState, leftPanel: next })
}

export function setFilmstrip(next: 'expanded' | 'collapsed') {
  setState({ ...uiShellState, filmstrip: next })
}

export function setWorkMode(next: 'live' | 'point' | 'view') {
  setState({ ...uiShellState, workMode: next })
}