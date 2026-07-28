import { openPublisherDatabase } from "./server.ts"
import { publisherConfig } from "./publisher-config.ts"
import { createR2Provider } from "./r2-provider.ts"
import { createPublisherWorker } from "./publisher-worker.ts"

export async function runPublisherFromEnvironment(env: Record<string, string | undefined> = process.env) {
  const config = publisherConfig(env); const database = openPublisherDatabase(config.databasePath); const worker = createPublisherWorker(database, { outputsRoot: config.outputsRoot }, createR2Provider(config)); const controller = new AbortController(); const stop = () => controller.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop)
  try { while (!controller.signal.aborted) { await worker.pass(); await new Promise((resolve) => setTimeout(resolve, 1_000)) } } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); database.close() }
}

if (process.argv[1]?.endsWith("publisher-service.ts")) runPublisherFromEnvironment().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "publisher failed"); process.exitCode = 1 })
