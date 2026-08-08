import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  alpacaSimulationScenarios,
  createAlpacaSimulator,
  type AlpacaSimulationScenario,
} from '../src/simulator/alpaca-simulator.ts'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const arguments_ = new Map(
  process.argv
    .slice(2)
    .filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => {
      const separator = argument.indexOf('=')
      return [argument.slice(2, separator), argument.slice(separator + 1)]
    }),
)
const port = numericArgument(arguments_.get('port'), 32324)
const paceMs = numericArgument(arguments_.get('pace-ms'), 0)
const scenario = arguments_.get('scenario') ?? 'ready-rig'
if (!isScenario(scenario)) throw new Error(`Unknown scenario: ${scenario}`)
const corpusRoot = resolve(
  process.env.ASTRO_SIM_CORPUS_OUTPUT_ROOT ??
    join(repositoryRoot, '.tmp/alpaca-simulation-corpus'),
)
const simulator = createAlpacaSimulator({
  corpusRoot,
  initialScenario: scenario,
  autoAdvanceMsPerRequest: paceMs,
})
const listener = await simulator.listen(port)

console.log(`Alpaca simulator: ${listener.origin}`)
console.log(`Scenario: ${scenario}`)
console.log(`Corpus: ${corpusRoot}`)
console.log('Control: POST /__sim/scenario, /__sim/advance, or /__sim/restart')

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void listener.close().finally(() => process.exit(0))
  })

function numericArgument(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0)
    throw new Error(`Invalid numeric argument: ${value}`)
  return number
}

function isScenario(value: string): value is AlpacaSimulationScenario {
  return alpacaSimulationScenarios.some((scenario) => scenario === value)
}
