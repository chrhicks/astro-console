import { Effect } from 'effect'
import { openOriginDatabase } from './database.ts'
import { solarCliConfig, type SolarCliConfig } from './environment-config.ts'
import { runExecutable } from './executable.ts'
import { createSolarWorkService } from './solar-work-service.ts'

export function runSolarTestIntent(config: SolarCliConfig) {
  const database = openOriginDatabase(config.databasePath)
  const service = createSolarWorkService(database)
  try {
    const identity = Effect.runSync(service.resolveCliIdentity(config.subject))
    if (identity === undefined)
      return { outcome: 'rejected' as const, reason: 'OwnerRequired' as const }
    if (config.command.action === 'stop')
      return {
        outcome: Effect.runSync(service.requestStop(config.command.intentId))
          ? ('accepted' as const)
          : ('rejected' as const),
      }
    return Effect.runSync(service.submitIntent(config.command, identity))
  } finally {
    database.close()
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
