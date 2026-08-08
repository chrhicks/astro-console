import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type ManifestEntry = {
  readonly id: string
  readonly family: string
  readonly source: string
  readonly sha256: string
  readonly scenario: string
  readonly copiedFilename: string
}

type CorpusManifest = {
  readonly version: number
  readonly sourceRoot: string
  readonly entries: ReadonlyArray<ManifestEntry>
}

const manifestPath = fileURLToPath(
  new URL('../simulation/alpaca-corpus-manifest.json', import.meta.url),
)
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const defaultOutputRoot = join(repositoryRoot, '.tmp/alpaca-simulation-corpus')

const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
const arguments_ = process.argv.slice(2)
const requestedIds = new Set(
  arguments_.flatMap((argument, index) => {
    if (argument.startsWith('--id=')) return [argument.slice('--id='.length)]
    if (argument === '--id' && arguments_[index + 1] !== undefined)
      return [arguments_[index + 1]]
    return []
  }),
)
const verifyOnly = arguments_.includes('--verify-only')
const sourceRoot = resolve(
  process.env.ASTRO_SIM_CORPUS_SOURCE_ROOT ?? manifest.sourceRoot,
)
const outputRoot = resolve(
  process.env.ASTRO_SIM_CORPUS_OUTPUT_ROOT ?? defaultOutputRoot,
)
const entries =
  requestedIds.size === 0
    ? manifest.entries
    : manifest.entries.filter((entry) => requestedIds.has(entry.id))

if (entries.length === 0)
  throw new Error('No manifest entry matched the requested corpus ID.')
for (const id of requestedIds)
  if (!entries.some((entry) => entry.id === id))
    throw new Error(`Unknown corpus manifest ID: ${id}`)

await mkdir(outputRoot, { recursive: true })
const prepared: Array<ManifestEntry & { readonly bytes: number }> = []

for (const entry of entries) {
  assertSafeRelativePath(entry.source, 'source')
  assertSafeRelativePath(entry.copiedFilename, 'copied filename')
  if (dirname(entry.copiedFilename) !== '.')
    throw new Error(`Copied filename must not contain a directory: ${entry.id}`)
  const source = join(sourceRoot, entry.source)
  const target = join(outputRoot, entry.copiedFilename)
  const sourceDigest = await sha256(source)
  if (sourceDigest !== entry.sha256)
    throw new Error(
      `Source checksum mismatch for ${entry.id}: expected ${entry.sha256}, received ${sourceDigest}`,
    )
  if (!verifyOnly) {
    const temporary = `${target}.partial`
    await rm(temporary, { force: true })
    await copyFile(source, temporary)
    const copiedDigest = await sha256(temporary)
    if (copiedDigest !== entry.sha256) {
      await rm(temporary, { force: true })
      throw new Error(`Copied checksum mismatch for ${entry.id}.`)
    }
    await rename(temporary, target)
  } else {
    const targetDigest = await sha256(target)
    if (targetDigest !== entry.sha256)
      throw new Error(`Prepared checksum mismatch for ${entry.id}.`)
  }
  const copied = await stat(target)
  prepared.push({ ...entry, bytes: copied.size })
  console.log(`${verifyOnly ? 'verified' : 'prepared'} ${entry.id}`)
}

await writeFile(
  join(outputRoot, 'prepared-manifest.json'),
  `${JSON.stringify(
    {
      manifestVersion: manifest.version,
      sourceRoot,
      outputRoot,
      entries: prepared,
    },
    null,
    2,
  )}\n`,
)

function assertSafeRelativePath(path: string, label: string) {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.split('/').some((part) => part === '..' || part === '')
  )
    throw new Error(`Manifest ${label} is not a safe relative path: ${path}`)
}

async function sha256(path: string) {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

function parseManifest(value: unknown): CorpusManifest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'number' ||
    !('sourceRoot' in value) ||
    typeof value.sourceRoot !== 'string' ||
    !('entries' in value) ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isManifestEntry)
  )
    throw new Error('The Alpaca corpus manifest is invalid.')
  return {
    version: value.version,
    sourceRoot: value.sourceRoot,
    entries: value.entries,
  }
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    'family' in value &&
    typeof value.family === 'string' &&
    'source' in value &&
    typeof value.source === 'string' &&
    'sha256' in value &&
    typeof value.sha256 === 'string' &&
    'scenario' in value &&
    typeof value.scenario === 'string' &&
    'copiedFilename' in value &&
    typeof value.copiedFilename === 'string'
  )
}
