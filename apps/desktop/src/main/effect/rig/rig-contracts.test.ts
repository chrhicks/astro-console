import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from 'effect'
import { resolveAvailableActions } from '../catalog/catalog-store.live'
import { projectRigSupport, projectWorkspaceActions } from '../state/status-projector'
import type { ConnectedRig, RigCamera } from './rig-model'

const base = {
  identity: {
    rigId: 'test',
    pluginKind: 'alpaca-rig' as const,
    displayName: 'Test rig',
  },
  connect: {
    device: {},
    preview: { phase: 'none' as const, source: 'none' as const, active: false },
    capture: { phase: 'idle' as const },
    library: { scope: 'current_target' as const, assets: [], polling: false },
  },
  refresh: Effect.succeed({
    device: {},
    preview: { phase: 'none' as const, source: 'none' as const, active: false },
    capture: { phase: 'idle' as const },
  }),
}

const camera: RigCamera = {
  startExposure: () => Effect.void,
  stopExposure: () => Effect.void,
  getExposureState: () => Effect.succeed({ state: 'idle', imageReady: false }),
  getLatestFrame: () => Effect.fail(new Error('No frame')),
}

describe('Rig capability projection', () => {
  it('does not project park or autofocus from mount/focuser presence alone', () => {
    const rig: ConnectedRig = {
      ...base,
      mount: { stopMotion: () => Effect.void },
      focuser: { moveTo: () => Effect.void },
    }

    assert.deepEqual(projectRigSupport(rig), {
      canPark: false,
      canUnpark: false,
      canPoint: false,
      preview: false,
      capture: 'unsupported',
      darkExposure: false,
      autofocus: false,
      filterWheel: false,
      storage: false,
    })
  })

  it('projects independently callable park and autofocus operations', () => {
    const rig: ConnectedRig = {
      ...base,
      mount: { park: () => Effect.void },
      autofocus: { run: () => Effect.void },
    }

    const support = projectRigSupport(rig)
    assert.equal(support.canPark, true)
    assert.equal(support.autofocus, true)
  })

  it('offers unpark only for a parked rig with a callable unpark operation', () => {
    const rig: ConnectedRig = {
      ...base,
      mount: { unpark: () => Effect.void },
    }

    assert.deepEqual(
      projectWorkspaceActions('parked', projectRigSupport(rig)),
      [{ id: 'unpark', label: 'Unpark mount', enabled: true }],
    )
    assert.deepEqual(
      projectWorkspaceActions('parked', projectRigSupport({ ...rig, mount: {} })),
      [],
    )
    assert.deepEqual(
      projectWorkspaceActions('primed', projectRigSupport(rig)),
      [],
    )
  })

  it('projects dark exposure from the callable camera surface', () => {
    const rig: ConnectedRig = {
      ...base,
      camera: { ...camera, startDarkExposure: () => Effect.void },
      captureStop: { mode: 'external', stop: camera.stopExposure },
    }

    assert.equal(projectRigSupport(rig).darkExposure, true)
    assert.equal(projectRigSupport({ ...rig, camera }).darkExposure, false)
  })
})

describe('Catalog capture actions', () => {
  it('offers stack only for native capture, not generic camera exposure', () => {
    const native: ConnectedRig = {
      ...base,
      capture: { start: () => Effect.void },
      captureStop: { mode: 'native', stop: () => Effect.void },
    }
    const external: ConnectedRig = {
      ...base,
      camera,
      captureStop: { mode: 'external', stop: camera.stopExposure },
    }

    assert.deepEqual(resolveAvailableActions('dso', native, false), ['stack'])
    assert.deepEqual(resolveAvailableActions('dso', external, false), [])
  })
})
