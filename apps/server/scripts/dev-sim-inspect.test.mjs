import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import {
  createDevSimInspectState,
  devSimInspectFixture,
  observeOutputLines,
  parseDevSimInspectArguments,
} from './dev-sim-inspect-config.mjs'

describe('dev simulation inspector arguments', () => {
  it('uses the beta Observe exposure-success defaults', () => {
    assert.equal(devSimInspectFixture, 'preflight')
    assert.deepEqual(parseDevSimInspectArguments([]), {
      scenario: 'exposure-success',
      client: 'owner',
      path: '/observe?ui=beta',
    })
  })

  it('accepts bounded simulator, client, and local path values', () => {
    assert.deepEqual(
      parseDevSimInspectArguments([
        '--scenario=focus-quality-degradation',
        '--client=phone',
        '--path=/library?ui=beta',
      ]),
      {
        scenario: 'focus-quality-degradation',
        client: 'phone',
        path: '/library?ui=beta',
      },
    )
  })

  it('rejects values outside the bounded runner contract', () => {
    assert.throws(
      () => parseDevSimInspectArguments(['--scenario=live-rig']),
      /--scenario must be one of/,
    )
    assert.throws(
      () => parseDevSimInspectArguments(['--client=admin']),
      /--client must be owner, friend, or phone/,
    )
    assert.throws(
      () => parseDevSimInspectArguments(['--path=https:\/\/example.com']),
      /--path must be a local path/,
    )
    assert.throws(
      () => parseDevSimInspectArguments(['--fixture=m27']),
      /Unknown argument/,
    )
  })

  it('recognizes a startup URL split across stdout chunks', async () => {
    const output = new PassThrough()
    const lines = []
    const reader = observeOutputLines(output, (line) => lines.push(line))
    output.write('Alpaca simulator: http://127.')
    output.end('0.0.1:43210\nScenario: exposure-success\n')
    await once(reader, 'close')

    assert.deepEqual(lines, [
      'Alpaca simulator: http://127.0.0.1:43210',
      'Scenario: exposure-success',
    ])
  })

  it('creates fresh ignored state for every inspection launch', async (t) => {
    const appRoot = await mkdtemp(join(tmpdir(), 'astro-sim-inspect-state-'))
    t.after(() => rm(appRoot, { recursive: true, force: true }))

    const first = createDevSimInspectState(appRoot, 'owner', 'exposure-success')
    const second = createDevSimInspectState(
      appRoot,
      'owner',
      'exposure-success',
    )

    assert.notEqual(first.runRoot, second.runRoot)
    assert.match(first.runRoot, /\.astro-server\/sim-inspect-owner-/)
    assert.equal(first.database.endsWith('/state.sqlite'), true)
    assert.equal(first.originalsRoot.endsWith('/originals'), true)
    assert.equal(first.previewRoot.endsWith('/previews'), true)
    assert.equal(first.profile.endsWith('/chrome-profile'), true)
  })
})
