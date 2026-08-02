import { Effect } from 'effect'
import { createLocalWebService } from './server.ts'
import { solarCliConfig, type SolarCliConfig } from './environment-config.ts'
import { runExecutable } from './executable.ts'

export function runSolarTestIntent(config: SolarCliConfig) {
  const service = createLocalWebService(config.databasePath)
  try {
    const identity = service.resolveSolarTestCliIdentity(config.subject)
    if (identity === undefined)
      return { outcome: 'rejected' as const, reason: 'OwnerRequired' as const }
    if (config.command.action === 'stop')
      return {
        outcome: service.requestSolarTestStop(config.command.intentId)
          ? ('accepted' as const)
          : ('rejected' as const),
      }
    return service.submitSolarTestIntent(config.command, identity)
  } finally {
    service.close()
  }
}

if (process.argv[1]?.endsWith('solar-test.ts')) {
  runExecutable('Solar CLI', async () =>
    console.log(
      JSON.stringify(
        runSolarTestIntent(await Effect.runPromise(solarCliConfig)),
      ),
    ),
  )
}
