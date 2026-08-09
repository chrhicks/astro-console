import { createInterface } from 'node:readline'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { alpacaSimulationScenarios } from '../src/simulator/alpaca-simulator.ts'

const clients = ['owner', 'friend', 'phone']
export const devSimInspectFixture = 'plan-draft'

export function parseDevSimInspectArguments(arguments_) {
  const values = new Map()
  for (const argument of arguments_) {
    const match = argument.match(/^--(scenario|client|path)=(.*)$/)
    if (match === null) throw new Error(`Unknown argument: ${argument}`)
    if (values.has(match[1]))
      throw new Error(`Duplicate argument: --${match[1]}`)
    values.set(match[1], match[2])
  }

  const scenario = values.get('scenario') ?? 'exposure-success'
  if (!alpacaSimulationScenarios.includes(scenario))
    throw new Error(
      `--scenario must be one of: ${alpacaSimulationScenarios.join(', ')}`,
    )

  const client = values.get('client') ?? 'owner'
  if (!clients.includes(client))
    throw new Error('--client must be owner, friend, or phone')

  const path = values.get('path') ?? '/observe?ui=beta'
  if (!path.startsWith('/') || /[\r\n\\]/.test(path))
    throw new Error('--path must be a local path that starts with /')

  return { scenario, client, path }
}

export function observeOutputLines(stream, onLine) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  lines.on('line', onLine)
  return lines
}

export function createDevSimInspectState(appRoot, client, scenario) {
  const stateRoot = resolve(appRoot, '.astro-server')
  mkdirSync(stateRoot, { recursive: true })
  const runRoot = mkdtempSync(
    resolve(stateRoot, `sim-inspect-${client}-${scenario}-`),
  )
  return {
    runRoot,
    database: resolve(runRoot, 'state.sqlite'),
    originalsRoot: resolve(runRoot, 'originals'),
    previewRoot: resolve(runRoot, 'previews'),
    profile: resolve(runRoot, 'chrome-profile'),
  }
}
