import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  collectSelectableScenarioSequence,
  verifyScenarioCorpus,
} from './simulation-corpus-verifier.mjs'

test('simulation launch collects every selectable scenario then restores launch state', async () => {
  const selected = []
  const sequence = await collectSelectableScenarioSequence({
    simulatorOrigin: 'http://127.0.0.1:43210',
    scenarios: ['ready-rig', 'exposure-success', 'target-evidence-progression'],
    launchScenario: 'exposure-success',
    fetchImplementation: async (_url, request) => {
      const { scenario } = JSON.parse(request.body)
      selected.push(scenario)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          evidence: {
            sequence:
              scenario === 'target-evidence-progression'
                ? [
                    { filename: 'ngc7000-first-light.fits' },
                    { filename: 'ngc7000-dithered-light.fits' },
                  ]
                : [{ filename: 'm101-good-light.fits' }],
          },
        }),
      }
    },
  })

  assert.deepEqual(selected, [
    'ready-rig',
    'exposure-success',
    'target-evidence-progression',
    'exposure-success',
  ])
  assert.deepEqual(
    sequence.map((frame) => frame.filename),
    [
      'm101-good-light.fits',
      'ngc7000-first-light.fits',
      'ngc7000-dithered-light.fits',
    ],
  )
})

test('simulation launch verifies the copied scenario bytes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'astro-sim-corpus-valid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = 'real selected frame bytes'
  const filename = 'selected-frame.fits'
  const manifestPath = await writeManifest(root, filename, digest(bytes))
  await writeFile(join(root, filename), bytes)

  assert.deepEqual(
    await verifyScenarioCorpus({
      corpusRoot: root,
      manifestPath,
      sequence: [{ filename }, { filename }],
    }),
    [filename],
  )
})

test('simulation launch rejects a missing copied scenario file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'astro-sim-corpus-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filename = 'missing-frame.fits'
  const manifestPath = await writeManifest(root, filename, digest('expected'))

  await assert.rejects(
    verifyScenarioCorpus({
      corpusRoot: root,
      manifestPath,
      sequence: [{ filename }],
    }),
    /Simulation corpus file is missing: missing-frame\.fits/,
  )
})

test('simulation launch rejects tampered copied scenario bytes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'astro-sim-corpus-tampered-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filename = 'tampered-frame.fits'
  const manifestPath = await writeManifest(root, filename, digest('expected'))
  await writeFile(join(root, filename), 'tampered')

  await assert.rejects(
    verifyScenarioCorpus({
      corpusRoot: root,
      manifestPath,
      sequence: [{ filename }],
    }),
    /Simulation corpus checksum mismatch for tampered-frame\.fits/,
  )
})

async function writeManifest(root, copiedFilename, sha256) {
  const path = join(root, 'manifest.json')
  await writeFile(
    path,
    JSON.stringify({ entries: [{ copiedFilename, sha256 }] }),
  )
  return path
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}
