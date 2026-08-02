import { readdirSync } from 'node:fs'
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
