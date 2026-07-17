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
