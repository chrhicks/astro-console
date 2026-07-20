import { afterEach, it } from 'node:test'
import assert from 'node:assert/strict'
import { electronApi } from './electron-api'

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

it('forwards all external sequence actions to the preload API', async () => {
  const calls: string[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      seestarV2: {
        configureExternalSequence: () => {
          calls.push('configure')
          return Promise.resolve(undefined)
        },
        startExternalSequence: () => {
          calls.push('start')
          return Promise.resolve(undefined)
        },
        continueExternalSequence: () => {
          calls.push('continue')
          return Promise.resolve(undefined)
        },
        finishExternalSequence: () => {
          calls.push('finish')
          return Promise.resolve(undefined)
        },
      },
    },
  })

  await electronApi.configureExternalSequence({ lightCount: 1, darkCount: 0, durationSec: 1 })
  await electronApi.startExternalSequence()
  await electronApi.continueExternalSequence()
  await electronApi.finishExternalSequence()

  assert.deepEqual(calls, ['configure', 'start', 'continue', 'finish'])
})

it('forwards unpark to the preload API', async () => {
  const calls: string[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      seestarV2: {
        unparkMount: () => {
          calls.push('unpark')
          return Promise.resolve(undefined)
        },
      },
    },
  })

  await electronApi.unparkMount()

  assert.deepEqual(calls, ['unpark'])
})

it('forwards abort slew to the preload API', async () => {
  const calls: string[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      seestarV2: {
        abortSlew: () => {
          calls.push('abort-slew')
          return Promise.resolve(undefined)
        },
      },
    },
  })

  await electronApi.abortSlew()

  assert.deepEqual(calls, ['abort-slew'])
})

it('forwards manual optical controls to the preload API', async () => {
  const calls: unknown[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      seestarV2: {
        moveFocuser: (input: unknown) => {
          calls.push(['focus', input])
          return Promise.resolve(undefined)
        },
        setFilterPosition: (input: unknown) => {
          calls.push(['filter', input])
          return Promise.resolve(undefined)
        },
      },
    },
  })

  await electronApi.moveFocuser({ position: 1314 })
  await electronApi.setFilterPosition({ position: 2 })

  assert.deepEqual(calls, [
    ['focus', { position: 1314 }],
    ['filter', { position: 2 }],
  ])
})

it('forwards a manual observer location to the preload API', async () => {
  const calls: unknown[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      seestarV2: {
        setObserverLocation: (input: unknown) => {
          calls.push(input)
          return Promise.resolve(undefined)
        },
      },
    },
  })

  await electronApi.setObserverLocation({ location: { lat: 39.755, lon: -74.2679 } })

  assert.deepEqual(calls, [{ location: { lat: 39.755, lon: -74.2679 } }])
})
