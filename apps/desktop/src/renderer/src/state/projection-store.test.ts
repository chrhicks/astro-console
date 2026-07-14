import { afterEach, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DesktopStatus } from '../../../shared/api-v2'
import { applyDesktopStatusToProjectionStore, disposeProjectionStore, getProjectionState, initializeProjectionStore } from './projection-store'

const originalWindow = globalThis.window

afterEach(() => {
  disposeProjectionStore()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

it('does not let an older status response regress a newer pushed status', async () => {
  let listener: ((status: DesktopStatus) => void) | undefined
  let resolveStatus: ((status: DesktopStatus) => void) | undefined
  const older = status('2026-07-13T00:00:00.000Z', 'older', 1)
  const newer = status('2026-07-13T00:00:00.000Z', 'newer', 2)
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      seestarV2: {
        onStatus: (next: (status: DesktopStatus) => void) => {
          listener = next
          return () => {}
        },
        getStatus: () => new Promise<DesktopStatus>((resolve) => { resolveStatus = resolve }),
      },
    },
  })

  const initialized = initializeProjectionStore()
  listener?.(newer)
  resolveStatus?.(older)
  await initialized

  assert.equal(getProjectionState().status?.session.host, 'newer')
})

it('applies a newer configured sequence response', () => {
  applyDesktopStatusToProjectionStore(status('2026-07-13T00:00:00.000Z', 'current', 1))
  const configured = status('2026-07-13T00:00:01.000Z', 'configured', 2)
  configured.sequence = {
    phase: 'idle',
    plan: { lightCount: 1, durationSec: 2, darkCount: 1 },
    completed: 0,
    failed: 0,
  }

  applyDesktopStatusToProjectionStore(configured)

  assert.deepEqual(getProjectionState().status?.sequence.plan, {
    lightCount: 1,
    durationSec: 2,
    darkCount: 1,
  })
  assert.equal(getProjectionState().status?.statusRevision, 2)
})

function status(lastUpdatedAt: string, sessionId: string, statusRevision: number): DesktopStatus {
  return {
    session: { phase: 'connected', discovering: false, host: sessionId },
    pointing: { phase: 'idle', target: null },
    capture: { phase: 'idle' },
    preview: { phase: 'none', source: 'none', active: false },
    device: {},
    library: { scope: 'current_target', assets: [], polling: false },
    workspace: {
      state: 'idle_no_target',
      stateLabel: 'Idle',
      surface: { kind: 'idle', label: 'Idle' },
      capabilities: { preview: 'unsupported', capture: 'unsupported', darkExposure: 'no', autofocus: 'no', filterWheel: 'no', storage: 'no' },
      actions: [],
    },
    sequence: { phase: 'idle', completed: 0, failed: 0 },
    currentTarget: null,
    statusRevision,
    lastUpdatedAt,
  }
}
