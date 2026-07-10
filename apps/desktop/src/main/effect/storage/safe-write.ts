import { promises as fs } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'

// Residual risk: a same-user process can replace a validated directory
// segment with a symlink between the lstat check and the file write (a
// classic ancestor-directory TOCTOU). Node lacks openat-style
// directory-relative creation to close this gap, and the storage tree lives
// under app-owned userData with no renderer API for creating entries, so the
// attack surface is limited to the same OS user. The segment validation
// below plus exclusive O_NOFOLLOW final creation are the strongest practical
// measures without false security checks; a true fix requires
// directory-relative open APIs not available in Node.

// Creates a directory path beneath a trusted real root, validating each
// segment so a symlink or non-directory placed inside the tree cannot
// redirect writes outside the root. The root itself is expected to already
// exist and be realpath'd by the caller. Each child segment is created with
// mkdir if absent, then lstat'd to reject symlinks and non-directories. This
// avoids recursive mkdir traversing unverified symlink components.
export async function ensureDirBeneathRoot(
  dir: string,
  realRoot: string,
): Promise<string> {
  const relative = path.relative(realRoot, dir)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Target directory escapes external frames root')
  }
  const segments = relative.split(path.sep).filter((s) => s.length > 0)
  let current = realRoot
  for (const segment of segments) {
    current = path.join(current, segment)
    await fs.mkdir(current, { recursive: false }).catch((error) => {
      // EEXIST is expected when the segment already exists; validate it below.
      if (error.code !== 'EEXIST') throw error
    })
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Path component ${current} is not a directory`)
    }
  }
  return current
}

// Atomically and exclusively creates a file at the given path without
// following the final symlink. Uses O_CREAT|O_EXCL|O_WRONLY with O_NOFOLLOW
// so an existing symlink at the target name is rejected rather than
// traversed. Writes the data and closes the handle. Returns the number of
// bytes written.
export async function writeFileExclusive(
  filePath: string,
  data: Uint8Array,
): Promise<number> {
  const flags =
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_WRONLY |
    fsConstants.O_NOFOLLOW
  const handle = await fs.open(filePath, flags)
  try {
    await handle.writeFile(data)
    return data.byteLength
  } finally {
    await handle.close()
  }
}

// Retries writeFileExclusive with an incrementing sequence suffix when the
// target name already exists (EEXIST). This handles the predictable-filename
// collision case without overwriting an existing file. Up to maxAttempts
// tries; throws on exhaustion.
export async function writeFileExclusiveWithSequence(
  dir: string,
  baseName: string,
  extension: string,
  data: Uint8Array,
  startSequence: number,
  maxAttempts = 9999,
): Promise<{ absolutePath: string; fileSize: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sequence = (startSequence + attempt).toString().padStart(4, '0')
    const fileName = `${baseName}_${sequence}${extension}`
    const absolutePath = path.join(dir, fileName)
    try {
      const fileSize = await writeFileExclusive(absolutePath, data)
      return { absolutePath, fileSize }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code !== 'EEXIST'
      ) {
        throw error
      }
    }
  }
  throw new Error(`Sequence exhausted after ${maxAttempts} attempts in ${dir}`)
}
