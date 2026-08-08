import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultManifestPath = fileURLToPath(
  new URL('../simulation/alpaca-corpus-manifest.json', import.meta.url),
)

export async function collectSelectableScenarioSequence({
  simulatorOrigin,
  scenarios,
  launchScenario,
  fetchImplementation = fetch,
}) {
  if (
    !Array.isArray(scenarios) ||
    scenarios.length === 0 ||
    !scenarios.includes(launchScenario)
  )
    throw new Error('The selectable simulator scenario set is invalid.')

  const sequence = []
  let selectionFailure
  try {
    for (const scenario of scenarios)
      sequence.push(
        ...(await selectScenario(
          simulatorOrigin,
          scenario,
          fetchImplementation,
        )),
      )
  } catch (cause) {
    selectionFailure = cause
  }

  try {
    await selectScenario(simulatorOrigin, launchScenario, fetchImplementation)
  } catch (cause) {
    const restoreMessage = `Could not restore launch scenario ${launchScenario}: ${errorMessage(cause)}`
    if (selectionFailure !== undefined)
      throw new Error(`${errorMessage(selectionFailure)} ${restoreMessage}`)
    throw new Error(restoreMessage)
  }
  if (selectionFailure !== undefined) throw selectionFailure

  return [
    ...new Map(
      sequence.map((frame) => [evidenceFilename(frame), frame]),
    ).values(),
  ]
}

export async function verifyScenarioCorpus({
  corpusRoot,
  sequence,
  manifestPath = defaultManifestPath,
}) {
  if (!Array.isArray(sequence) || sequence.length === 0)
    throw new Error('The simulator did not declare an evidence sequence.')

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !Array.isArray(manifest.entries)
  )
    throw new Error('The committed simulation corpus manifest is invalid.')

  const filenames = [...new Set(sequence.map(evidenceFilename))]
  for (const filename of filenames) {
    if (basename(filename) !== filename || filename === '.')
      throw new Error(`The simulator declared an unsafe filename: ${filename}`)
    const matches = manifest.entries.filter(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        entry.copiedFilename === filename,
    )
    if (matches.length !== 1)
      throw new Error(
        `The simulator file is not uniquely checksum-pinned: ${filename}`,
      )
    const expected = matches[0].sha256
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
      throw new Error(`The manifest checksum is invalid for ${filename}.`)

    let received
    try {
      received = await sha256(join(corpusRoot, filename))
    } catch (cause) {
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        cause.code === 'ENOENT'
      )
        throw new Error(
          `Simulation corpus file is missing: ${filename}. Run npm run sim:corpus first.`,
        )
      throw cause
    }
    if (received !== expected)
      throw new Error(
        `Simulation corpus checksum mismatch for ${filename}: expected ${expected}, received ${received}.`,
      )
  }

  return filenames
}

function evidenceFilename(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('filename' in value) ||
    typeof value.filename !== 'string' ||
    value.filename.length === 0
  )
    throw new Error('The simulator evidence sequence contains no filename.')
  return value.filename
}

async function selectScenario(simulatorOrigin, scenario, fetchImplementation) {
  const response = await fetchImplementation(
    `${simulatorOrigin}/__sim/scenario`,
    {
      method: 'POST',
      body: JSON.stringify({ scenario }),
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
    },
  )
  if (!response.ok)
    throw new Error(`Scenario ${scenario} returned HTTP ${response.status}.`)
  const state = await response.json()
  if (
    typeof state !== 'object' ||
    state === null ||
    !('evidence' in state) ||
    typeof state.evidence !== 'object' ||
    state.evidence === null ||
    !('sequence' in state.evidence) ||
    !Array.isArray(state.evidence.sequence)
  )
    throw new Error(`Scenario ${scenario} returned no evidence sequence.`)
  return state.evidence.sequence
}

async function sha256(path) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : 'Unknown error.'
}
