import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  ensureDirBeneathRoot,
  writeFileExclusive,
  writeFileExclusiveWithSequence,
} from './safe-write'

// Each test gets a fresh temp root so symlink/escape scenarios are isolated.
let root: string

async function makeRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-write-test-'))
  // realpath the temp dir so tests compare against the true filesystem path
  // (macOS /var → /private/var symlink).
  return fs.realpath(dir)
}

beforeEach(async () => {
  root = await makeRoot()
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('ensureDirBeneathRoot', () => {
  it('creates nested directories beneath root', async () => {
    const dir = path.join(root, '2024-01-15', 'm31', 'lights')
    const result = await ensureDirBeneathRoot(dir, root)
    assert.equal(result, dir)
    const stat = await fs.stat(dir)
    assert.ok(stat.isDirectory())
  })

  it('returns existing directory without error', async () => {
    const dir = path.join(root, 'sub')
    await fs.mkdir(dir)
    const result = await ensureDirBeneathRoot(dir, root)
    assert.equal(result, dir)
  })

  it('rejects a path escaping root', async () => {
    const outside = path.join(path.dirname(root), 'escape')
    await assert.rejects(
      ensureDirBeneathRoot(outside, root),
      /escapes external frames root/,
    )
  })

  it('rejects a symlink component inside the tree', async () => {
    const linkDir = path.join(root, 'link')
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'escape-target-'))
    await fs.symlink(target, linkDir)
    const victim = path.join(linkDir, 'sub')
    await assert.rejects(
      ensureDirBeneathRoot(victim, root),
      /not a directory/,
    )
    await fs.rm(target, { recursive: true, force: true })
  })

  it('rejects a non-directory component', async () => {
    const file = path.join(root, 'file')
    await fs.writeFile(file, 'x')
    const victim = path.join(file, 'sub')
    await assert.rejects(
      ensureDirBeneathRoot(victim, root),
      /not a directory/,
    )
  })
})

describe('writeFileExclusive', () => {
  it('creates a new file exclusively', async () => {
    const filePath = path.join(root, 'test.fits')
    const data = new Uint8Array([1, 2, 3])
    const written = await writeFileExclusive(filePath, data)
    assert.equal(written, 3)
    const read = await fs.readFile(filePath)
    assert.deepEqual(new Uint8Array(read), data)
  })

  it('rejects overwriting an existing file', async () => {
    const filePath = path.join(root, 'test.fits')
    await fs.writeFile(filePath, 'existing')
    await assert.rejects(
      writeFileExclusive(filePath, new Uint8Array([1])),
      /EEXIST/,
    )
  })

  it('rejects following a symlink at the target name', async () => {
    const target = path.join(root, 'real.fits')
    await fs.writeFile(target, 'real')
    const link = path.join(root, 'link.fits')
    await fs.symlink(target, link)
    // O_NOFOLLOW on the final component prevents following the symlink.
    // With O_EXCL, the existing symlink triggers EEXIST (not ELOOP), but
    // either way the target file is not written through the link.
    await assert.rejects(
      writeFileExclusive(link, new Uint8Array([1])),
      (error: Error & { code?: string }) =>
        error.code === 'EEXIST' || error.code === 'ELOOP',
    )
    // Confirm the target was not overwritten.
    const read = await fs.readFile(target, 'utf8')
    assert.equal(read, 'real')
  })
})

describe('writeFileExclusiveWithSequence', () => {
  it('writes at the starting sequence when no collision', async () => {
    const data = new Uint8Array([1, 2])
    const result = await writeFileExclusiveWithSequence(
      root,
      '2024-01-15_m31_light',
      '.fits',
      data,
      1,
    )
    assert.equal(path.basename(result.absolutePath), '2024-01-15_m31_light_0001.fits')
    assert.equal(result.fileSize, 2)
  })

  it('increments sequence on collision', async () => {
    const existing = path.join(root, '2024-01-15_m31_light_0001.fits')
    await fs.writeFile(existing, 'old')
    const data = new Uint8Array([3, 4])
    const result = await writeFileExclusiveWithSequence(
      root,
      '2024-01-15_m31_light',
      '.fits',
      data,
      1,
    )
    assert.equal(path.basename(result.absolutePath), '2024-01-15_m31_light_0002.fits')
    const read = await fs.readFile(result.absolutePath)
    assert.deepEqual(new Uint8Array(read), data)
  })

  it('preserves existing file content on collision', async () => {
    const existing = path.join(root, '2024-01-15_m31_light_0001.fits')
    await fs.writeFile(existing, 'old-content')
    await writeFileExclusiveWithSequence(
      root,
      '2024-01-15_m31_light',
      '.fits',
      new Uint8Array([1]),
      1,
    )
    const read = await fs.readFile(existing, 'utf8')
    assert.equal(read, 'old-content')
  })
})
