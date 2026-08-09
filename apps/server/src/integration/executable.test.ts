import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, ConfigProvider } from 'effect'
import { executableErrorMessage } from '../app/executable.ts'

test('executable errors preserve bounded Error, ConfigError, and string detail', () => {
  const configError = new Config.ConfigError(
    new ConfigProvider.SourceError({
      message: 'ASTRO_SERVER_PORT must be an integer from 0 to 65535',
    }),
  )

  assert.equal(
    executableErrorMessage(configError),
    'SourceError: ASTRO_SERVER_PORT must be an integer from 0 to 65535',
  )
  assert.equal(
    executableErrorMessage('listener bind failed'),
    'listener bind failed',
  )
  assert.equal(
    executableErrorMessage(new Error('database open failed')),
    'database open failed',
  )
  assert.equal(
    executableErrorMessage({ message: 'private object detail' }),
    'failed',
  )
  assert.equal(executableErrorMessage('x'.repeat(600)), 'x'.repeat(500))
})
