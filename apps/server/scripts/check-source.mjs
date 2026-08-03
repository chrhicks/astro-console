import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const sourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [path]
        : []
    })

const serverImports = new Map([
  ['src/rig-worker.ts', ['createLocalWebService']],
  ['src/solar-test.ts', ['createLocalWebService']],
])

const importedServerNames = (source) =>
  [
    ...source.matchAll(
      /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]\.\/server\.ts['"]/g,
    ),
  ]
    .flatMap((match) => match[1]?.split(',') ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
    .sort()

const assertCurrentServerImportBoundary = () => {
  for (const source of sourceFiles('src')) {
    const names = importedServerNames(readFileSync(source, 'utf8'))
    const expected = serverImports.get(source)
    if (expected === undefined && names.length > 0)
      throw new Error(
        `${source} must not import server.ts; add an owned boundary instead`,
      )
    if (
      expected !== undefined &&
      (names.length !== expected.length ||
        names.some((name, index) => name !== expected[index]))
    )
      throw new Error(
        `${source} server.ts imports changed; move the dependency to its owned boundary`,
      )
  }
}

assertCurrentServerImportBoundary()

for (const source of [...sourceFiles('src'), ...sourceFiles('scripts')]) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--check', source],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    const diagnostic = result.error?.message ?? result.stderr.trim()
    throw new Error(
      `Node syntax validation failed for ${source}${diagnostic ? `\n${diagnostic}` : ''}`,
    )
  }
}
