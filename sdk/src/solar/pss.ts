import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { createOrReplaceSymlink } from './files.js'
import type { SolarPssConfig } from './jobs.js'

const execFileAsync = promisify(execFile)

export async function runPssStack(
  sourceVideoPath: string,
  stackedDir: string,
  config: SolarPssConfig,
): Promise<string> {
  const linkedInput = join(stackedDir, basename(sourceVideoPath))
  await createOrReplaceSymlink(sourceVideoPath, linkedInput)

  const before = new Set(await listPssTiffs(stackedDir))
  const env = {
    ...process.env,
    QT_QPA_PLATFORM: 'offscreen',
    PYTHONPATH: config.pssSourcePath,
  }

  const args = [
    '-m',
    'planetary_system_stacker.planetary_system_stacker',
    '--out_format',
    'tiff',
    '--debayering',
    config.debayering,
    '--debayer_method',
    config.debayerMethod,
    '-m',
    config.stabilizationMode,
    '-s',
    String(config.stackPercent),
    '--rf_percent',
    String(config.referenceFramePercent),
    '--name_add_p',
    '--name_add_f',
    linkedInput,
  ]

  await execFileAsync(config.pythonBin, args, {
    cwd: config.pssSourcePath,
    env,
  })

  const after = await listPssTiffs(stackedDir)
  const created = after.filter((file) => !before.has(file))
  if (created.length > 0) {
    return created.sort().at(-1)!
  }

  const latest = await latestModified(after)
  if (!latest) {
    throw new Error('PSS did not produce a TIFF output')
  }

  return latest
}

async function listPssTiffs(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath)
  return entries
    .filter(
      (entry) =>
        entry.includes('_pss_') && extname(entry).toLowerCase() === '.tiff',
    )
    .map((entry) => join(dirPath, entry))
}

async function latestModified(paths: string[]): Promise<string | null> {
  if (paths.length === 0) {
    return null
  }

  const withStats = await Promise.all(
    paths.map(async (path) => ({ path, stat: await stat(path) })),
  )
  withStats.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
  return withStats.at(-1)?.path ?? null
}
