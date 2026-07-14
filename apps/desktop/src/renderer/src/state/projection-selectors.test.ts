import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { DesktopStatus } from '../../../shared/api-v2'
import { selectCapturePresentation, selectWorkAreaModel } from './projection-selectors'

it('does not select an older preview when the newest frame has none', () => {
  const status: DesktopStatus = {
    session: { phase: 'connected', discovering: false },
    pointing: { phase: 'idle', target: null },
    capture: { phase: 'idle', mode: 'external' },
    preview: { phase: 'none', source: 'none', active: false },
    device: {},
    library: {
      scope: 'current_target',
      polling: false,
      assets: [
        { id: 'newest', name: 'newest', capturedAt: '2026-07-13T00:00:00.000Z', kind: 'exposure', saved: true, hasPreview: false },
        { id: 'older', name: 'older', capturedAt: '2026-07-12T00:00:00.000Z', kind: 'exposure', saved: true, hasPreview: true },
      ],
    },
    workspace: {
      state: 'primed',
      stateLabel: 'Primed',
      surface: { kind: 'idle', label: 'Idle' },
      capabilities: { preview: 'unsupported', capture: 'external', darkExposure: 'yes', autofocus: 'no', filterWheel: 'no', storage: 'no' },
      actions: [],
    },
    sequence: { phase: 'idle', completed: 0, failed: 0 },
    currentTarget: null,
    statusRevision: 1,
    lastUpdatedAt: '2026-07-13T00:00:00.000Z',
  }

  const model = selectWorkAreaModel({ status, hydrated: true, error: null })

  assert.equal(model.latestPreviewPath, null)
  assert.equal(model.latestPreviewUnavailable, true)
})

it('classifies capture presentation from the stable workspace capability', () => {
  assert.equal(selectCapturePresentation({
    ...DEFAULT_WORKSPACE,
    capabilities: { ...DEFAULT_WORKSPACE.capabilities, capture: 'external' },
  }), 'exposure')
  assert.equal(selectCapturePresentation({
    ...DEFAULT_WORKSPACE,
    capabilities: { ...DEFAULT_WORKSPACE.capabilities, capture: 'native' },
  }), 'capture')
})

const DEFAULT_WORKSPACE = {
  state: 'primed' as const,
  stateLabel: 'Primed',
  surface: { kind: 'idle' as const, label: 'Idle' },
  capabilities: { preview: 'unsupported' as const, capture: 'unsupported' as const, darkExposure: 'no' as const, autofocus: 'no' as const, filterWheel: 'no' as const, storage: 'no' as const },
  actions: [],
}
