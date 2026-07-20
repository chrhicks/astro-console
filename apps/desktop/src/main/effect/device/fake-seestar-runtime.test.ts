import assert from 'node:assert/strict'
import { after, it } from 'node:test'
import { Effect } from 'effect'
import { projectRigSupport, projectWorkspaceActions } from '../state/status-projector'
import { createFakeSeestarPlugin } from './fake-seestar-plugin'
import { fakeSeestarRuntime } from './fake-seestar-runtime'

after(() => {
  fakeSeestarRuntime.loadScenario('clean-connect')
})

it('provides a safe simulated slew fixture with abort capability', () => {
  fakeSeestarRuntime.loadScenario('abort-slew-available')
  const scenario = fakeSeestarRuntime.getActiveScenario()

  assert.equal(scenario.supportsStopMotion, true)
  assert.equal(scenario.connectedPointing?.phase, 'slewing')
  assert.equal(scenario.connectedPointing?.targetId, 'fake-m42')
})

it('projects an enabled abort slew action without sending a motion command', async () => {
  fakeSeestarRuntime.loadScenario('abort-slew-available')
  const plugin = createFakeSeestarPlugin()
  const session = await Effect.runPromise(
    plugin.connect({ pluginKind: 'fake-seestar', deviceId: 'fake-seestar-s30' }),
  )

  assert.equal(session.rig.connect.pointing?.phase, 'slewing')
  assert.ok(session.rig.mount?.stopMotion)
  assert.deepEqual(
    projectWorkspaceActions('slewing', projectRigSupport(session.rig)),
    [{ id: 'abort-slew', label: 'Abort slew', enabled: true }],
  )
})

it('exposes fail-closed generic focuser and filter-wheel controls only for the control scenario', async () => {
  fakeSeestarRuntime.loadScenario('clean-connect')
  const plugin = createFakeSeestarPlugin()
  const cleanSession = await Effect.runPromise(
    plugin.connect({ pluginKind: 'fake-seestar', deviceId: 'fake-seestar-s30' }),
  )

  assert.equal(cleanSession.rig.focuser, undefined)
  assert.equal(cleanSession.rig.filterWheel, undefined)

  fakeSeestarRuntime.loadScenario('generic-controls')
  const session = await Effect.runPromise(
    plugin.connect({ pluginKind: 'fake-seestar', deviceId: 'fake-seestar-s30' }),
  )
  const focuser = session.rig.focuser
  const filterWheel = session.rig.filterWheel

  assert.ok(focuser)
  assert.ok(filterWheel)
  assert.deepEqual(focuser.state, {
    absolute: true,
    maxStep: 2600,
    position: 1300,
    moving: false,
  })
  assert.deepEqual(filterWheel.state, {
    names: ['Clear', 'IR', 'LP'],
    focusOffsets: [0, 18, -12],
    position: 0,
  })

  await assert.rejects(Effect.runPromise(focuser.moveTo(2601)))
  await assert.rejects(Effect.runPromise(filterWheel.setPosition(3)))
  assert.equal(focuser.state.position, 1300)
  assert.equal(filterWheel.state.position, 0)

  await Effect.runPromise(focuser.moveTo(1314))
  await Effect.runPromise(filterWheel.setPosition(2))
  await Effect.runPromise(session.rig.refresh)

  assert.equal(focuser.state.position, 1314)
  assert.equal(filterWheel.state.position, 2)
  assert.deepEqual(session.rig.controls?.(), {
    focuser: { position: 1314, maxStep: 2600, moving: false },
    filterWheel: { names: ['Clear', 'IR', 'LP'], focusOffsets: [0, 18, -12], position: 2 },
  })
})
