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
    if (names.length > 0)
      throw new Error(
        `${source} must not import server.ts; add an owned boundary instead`,
      )
  }
}

assertCurrentServerImportBoundary()

const serverSource = readFileSync('./src/server.ts', 'utf8')
if (/^export\s/m.test(serverSource))
  throw new Error(
    'src/server.ts must be an executable composition root with no exports',
  )

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
