import { configuredRuntime, createLocalWebService } from "./server.ts"

export function runSolarTestIntentFromEnvironment(env: Record<string, string | undefined> = process.env) {
  if (env.ASTRO_SOLAR_TEST_CONFIRM !== "submit-solar-test") throw new Error("Solar test intent requires ASTRO_SOLAR_TEST_CONFIRM=submit-solar-test")
  const name = requiredSolarTestValue(env.ASTRO_SOLAR_TEST_NAME, "ASTRO_SOLAR_TEST_NAME")
  const subject = requiredSolarTestValue(env.ASTRO_SOLAR_TEST_SUBJECT, "ASTRO_SOLAR_TEST_SUBJECT")
  const idempotencyKey = requiredSolarTestValue(env.ASTRO_SOLAR_TEST_IDEMPOTENCY_KEY, "ASTRO_SOLAR_TEST_IDEMPOTENCY_KEY")
  const runtime = configuredRuntime(env)
  const service = createLocalWebService(runtime.databasePath)
  try {
    const identity = service.resolveSolarTestCliIdentity(subject)
    if (identity === undefined) return { outcome: "rejected" as const, reason: "OwnerRequired" as const }
    return service.submitSolarTestIntent({ name, idempotencyKey }, identity)
  } finally {
    service.close()
  }
}

function requiredSolarTestValue(value: string | undefined, name: string) {
  if (!value || /[\r\n]/.test(value)) throw new Error(`Solar test intent requires ${name}`)
  return value
}

if (process.argv[1]?.endsWith("solar-test.ts")) {
  console.log(JSON.stringify(runSolarTestIntentFromEnvironment()))
}
