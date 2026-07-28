import { configuredRuntime, createLocalWebService } from "./server.ts"

export function runSolarTestIntentFromEnvironment(env: Record<string, string | undefined> = process.env) {
  if (env.ASTRO_SOLAR_TEST_CONFIRM !== "submit-solar-test") throw new Error("Solar test intent requires ASTRO_SOLAR_TEST_CONFIRM=submit-solar-test")
  const subject = requiredSolarTestValue(env.ASTRO_SOLAR_TEST_SUBJECT, "ASTRO_SOLAR_TEST_SUBJECT")
  const action = env.ASTRO_SOLAR_TEST_ACTION ?? "submit"
  if (action !== "submit" && action !== "stop") throw new Error("ASTRO_SOLAR_TEST_ACTION must be submit or stop")
  const runtime = configuredRuntime(env)
  const service = createLocalWebService(runtime.databasePath)
  try {
    const identity = service.resolveSolarTestCliIdentity(subject)
    if (identity === undefined) return { outcome: "rejected" as const, reason: "OwnerRequired" as const }
    if (action === "stop") return { outcome: service.requestSolarTestStop(requiredSolarTestValue(env.ASTRO_SOLAR_TEST_INTENT_ID, "ASTRO_SOLAR_TEST_INTENT_ID")) ? "accepted" as const : "rejected" as const }
    const name = requiredSolarTestValue(env.ASTRO_SOLAR_TEST_NAME, "ASTRO_SOLAR_TEST_NAME")
    const idempotencyKey = requiredSolarTestValue(env.ASTRO_SOLAR_TEST_IDEMPOTENCY_KEY, "ASTRO_SOLAR_TEST_IDEMPOTENCY_KEY")
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
