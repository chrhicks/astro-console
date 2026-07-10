import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SeestarDevice } from './device.js'

// The terminal close behavior is a critical safety property: once disconnect()
// is called, queued mutations and recovery commands must reject before send,
// and ensureAuthenticated/connect must not silently reconnect the device.
// These tests create a SeestarDevice with a fake host (the client is created
// but never connected) and verify the closed flag gates all command paths.

describe('SeestarDevice terminal close', () => {
  it('rejects goto after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.goto(0, 0), /session is closed/)
  })

  it('rejects park after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.park(), /session is closed/)
  })

  it('rejects stopView after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.stopView(), /session is closed/)
  })

  it('rejects stopStack after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.stopStack(), /session is closed/)
  })

  it('rejects connect after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.connect(), /session is closed/)
    assert.equal(device.isConnected(), false)
  })

  it('rejects preflightCheck after disconnect via ensureAuthenticated', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.preflightCheck(), /session is closed/)
  })

  it('queued mutation rejects after disconnect', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    // Queue a mutation; runMutation chains on mutationChain.then(run, run).
    // disconnect() runs synchronously before the microtask, so run sees
    // closed === true and rejects.
    const gotoPromise = device.goto(0, 0)
    device.disconnect()
    await assert.rejects(gotoPromise, /session is closed/)
  })

  it('queued recovery command rejects after disconnect', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    const parkPromise = device.park()
    device.disconnect()
    // runRecovery calls fn() immediately, so ensureAuthenticated may already
    // be awaiting connect() when disconnect() destroys the socket. The command
    // rejects either with "session is closed" (closed check) or "Client
    // disconnected" (socket destruction) — both prevent the command from
    // reaching the device.
    await assert.rejects(parkPromise, /session is closed|Client disconnected/)
  })

  it('does not reconnect after disconnect when connect is called', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    // Multiple connect attempts should all fail without reconnecting
    await assert.rejects(device.connect(), /session is closed/)
    await assert.rejects(device.connectAndAuth(), /session is closed/)
    assert.equal(device.isConnected(), false)
  })

  it('rejects authenticate after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.authenticate(), /session is closed/)
  })

  it('rejects connectAndAuth after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.connectAndAuth(), /session is closed/)
  })

  it('rejects setTime after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.setTime(), /session is closed/)
  })

  it('rejects startView after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.startView('star'), /session is closed/)
  })

  it('rejects startStack after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.startStack(), /session is closed/)
  })

  it('rejects setWheelPosition after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.setWheelPosition(0), /session is closed/)
  })

  it('rejects manualMove after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(
      device.manualMove({ speed: 1, directionDeg: 0, durationSec: 1 }),
      /session is closed/,
    )
  })

  it('rejects shutdown after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.shutdown(), /session is closed/)
  })

  it('rejects reboot after disconnect with "session is closed"', async () => {
    const device = new SeestarDevice({ host: 'fake.invalid' })
    device.disconnect()
    await assert.rejects(device.reboot(), /session is closed/)
  })

  it('close during connect rejects and does not leave connected', async () => {
    // Create a device with a host that will hang on TCP connect. Use a
    // non-routable address so the TCP connect attempt times out instead of
    // refusing immediately. Call connect() and disconnect() concurrently.
    // The connect promise must reject with "session is closed" (not a
    // transport error), and the device must not be left connected.
    const device = new SeestarDevice({
      host: '192.0.2.1', // TEST-NET-1, non-routable, will hang
      port: 4700,
      timeoutMs: 10000,
    })
    const connectPromise = device.connect()
    // Give the connect a chance to start the TCP attempt
    await new Promise((resolve) => setTimeout(resolve, 50))
    device.disconnect()
    // Must reject with "session is closed" — the closed flag is checked
    // after client.connect() resolves or rejects, and disconnect() destroys
    // the socket so the connect rejects immediately.
    await assert.rejects(connectPromise, /session is closed/)
    // The device must not be left in a connected state.
    assert.equal(device.isConnected(), false)
    // The closed flag must be terminal — no reconnection possible.
    await assert.rejects(device.connect(), /session is closed/)
  })

  it('close after discovery but before configure rejects', async () => {
    // This tests the recheck-after-discovery path. A device with no host
    // triggers discovery. Disconnect must be called before discovery
    // completes so the recheck-after-discovery sees closed === true.
    // Use a longer discovery timeout so disconnect happens while discovery
    // is still in progress.
    const device = new SeestarDevice({
      discoveryTimeoutMs: 500,
    })
    const connectPromise = device.connect()
    // Disconnect immediately — before discovery completes
    device.disconnect()
    // The connect must reject. After discovery completes (or is aborted by
    // the closed flag), the recheck sees closed === true and throws
    // "session is closed" before configureClient/connect. If discovery
    // completes first with no devices, the error is "No Seestar devices
    // discovered" — but the closed recheck should still fire. Either way,
    // the device must not be left connected.
    await assert.rejects(connectPromise, /session is closed|No Seestar devices/)
    assert.equal(device.isConnected(), false)
    // Terminal: no reconnection
    await assert.rejects(device.connect(), /session is closed/)
  })
})
