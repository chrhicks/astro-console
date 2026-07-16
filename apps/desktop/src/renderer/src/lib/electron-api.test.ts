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
