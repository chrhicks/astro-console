import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveNextSequence } from './frame-storage'

let root: string

describe('resolveNextSequence', () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-storage-test-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('uses existing dark frames when assigning the next dark sequence', async () => {
    await fs.writeFile(path.join(root, '2026-07-13_target_dark_0007.fits'), '')
    await fs.writeFile(path.join(root, '2026-07-13_target_light_0099.fits'), '')

    assert.equal(await resolveNextSequence(root, 'dark'), '0008')
  })
})
