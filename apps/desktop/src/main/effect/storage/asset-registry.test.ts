import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { getManagedAssetPath, registerManagedAsset } from './asset-registry'

describe('managed asset registry', () => {
  let root = ''
  let file = ''

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'astro-assets-'))
    file = path.join(root, 'frame.fits')
    await writeFile(file, 'fits')
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('uses unforgeable IDs and resolves only registered files', async () => {
    const id = registerManagedAsset(file)
    assert.match(id, /^[0-9a-f-]{36}$/)
    assert.equal(getManagedAssetPath(id), await realpath(file))
    assert.equal(getManagedAssetPath('forged'), undefined)
  })
})
