import { readFileSync, statSync } from "node:fs"
import * as Schema from "effect/Schema"
import { saveProcessOutputs, type ProcessSaveResult } from "./process-save.ts"
import { processorConfig, type ProcessorConfig } from "./processor-config.ts"
import { openProcessorDatabase } from "./server.ts"

const Manifest = Schema.Struct({ sessionId: Schema.Literal("process-m27-001"), expectedRevision: Schema.Literal(4), idempotencyKey: Schema.NonEmptyString.check(Schema.isMaxLength(128)), outputs: Schema.Array(Schema.Struct({ sourceId: Schema.NonEmptyString, representation: Schema.Literals(["linearMaster", "final"]) })), sources: Schema.Unknown })
const Membership = Schema.Struct({ person_id: Schema.String, role: Schema.Literal("owner") })
type ProcessorResult = ProcessSaveResult | { readonly outcome: "disabled" } | { readonly outcome: "rejected"; readonly reason: "ManifestUnavailable" | "InvalidManifest" | "OwnerUnavailable" }

export function createProcessorService(config: ProcessorConfig, options: { readonly databaseOpener?: (path: string) => ReturnType<typeof openProcessorDatabase> } = {}) {
  if (config.mode === "disabled") return { runOnce: (): ProcessorResult => ({ outcome: "disabled" }), close: () => undefined }
  const database = (options.databaseOpener ?? openProcessorDatabase)(config.databasePath)
  const runOnce = (): ProcessorResult => {
    let raw: unknown
    let text: string
    try { if (statSync(config.manifestPath).size > 65_536) return { outcome: "rejected", reason: "InvalidManifest" }; text = readFileSync(config.manifestPath, "utf8") } catch { return { outcome: "rejected", reason: "ManifestUnavailable" } }
    try { raw = Schema.decodeUnknownSync(Manifest)(JSON.parse(text)) } catch { return { outcome: "rejected", reason: "InvalidManifest" } }
    const sources = sourceMapping(raw.sources)
    if (sources === undefined) return { outcome: "rejected", reason: "InvalidManifest" }
    const membershipRaw: unknown = database.prepare("SELECT person_id,role FROM memberships WHERE person_id=? AND role='owner' LIMIT 1").get(config.ownerPersonId)
    if (Schema.decodeUnknownSync(Schema.optional(Membership))(membershipRaw) === undefined) return { outcome: "rejected", reason: "OwnerUnavailable" }
    return saveProcessOutputs(database, { sourcesRoot: config.sourcesRoot, outputsRoot: config.outputsRoot, sources }, raw, { personId: config.ownerPersonId, clientId: "processor-manifest", role: "owner", capability: "controlCapable" })
  }
  return { runOnce, close: () => database.close() }
}

export function runProcessorFromEnvironment(env: Record<string, string | undefined> = process.env) { const processor = createProcessorService(processorConfig(env)); try { return processor.runOnce() } finally { processor.close() } }

function sourceMapping(raw: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined
  const entries = Object.entries(raw)
  if (entries.length === 0 || entries.length > 32 || entries.some(([sourceId, path]) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sourceId) || typeof path !== "string" || !path || path.startsWith("/") || /(?:^|\/)\.\.(?:\/|$)|[\r\n]/.test(path))) return undefined
  return Object.fromEntries(entries)
}

if (process.argv[1]?.endsWith("processor-service.ts")) console.log(JSON.stringify(runProcessorFromEnvironment()))
