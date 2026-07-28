import { createHash, randomUUID } from "node:crypto"
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { basename, relative, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import * as Schema from "effect/Schema"
import type { LocalIdentity } from "./server.ts"

const SaveInput = Schema.Struct({ sessionId: Schema.NonEmptyString, expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), idempotencyKey: Schema.NonEmptyString.check(Schema.isMaxLength(128)), outputs: Schema.Array(Schema.Struct({ sourceId: Schema.NonEmptyString, representation: Schema.Literals(["linearMaster", "final"]) })), metadata: Schema.optionalKey(Schema.Struct({ comparisonGroupId: Schema.NonEmptyString, sourceAssetIds: Schema.Array(Schema.String), runId: Schema.NonEmptyString, solveAttemptId: Schema.NonEmptyString })) })
const Existing = Schema.Struct({ semantic_key: Schema.String, response: Schema.String })
const DurableOriginal = Schema.Struct({ asset_id: Schema.String, role: Schema.Literal("original"), comparison_group_id: Schema.String, detail: Schema.String })
const DurableOriginalDetail = Schema.Struct({ lineage: Schema.Struct({ runId: Schema.String, solveAttemptId: Schema.String }) })
export type ProcessSaveStorage = { readonly sourcesRoot: string; readonly outputsRoot: string; readonly sources: Readonly<Record<string, string>> }
export type ProcessSaveResult = { readonly outcome: "accepted"; readonly assetIds: ReadonlyArray<string> } | { readonly outcome: "rejected"; readonly reason: "OwnerRequired" | "ClientReadOnly" | "InvalidInput" | "MaterializationFailed" | "OrphanRecordingFailed" }

export function saveProcessOutputs(database: DatabaseSync, storage: ProcessSaveStorage, raw: unknown, identity: LocalIdentity): ProcessSaveResult {
  if (identity.role !== "owner") return { outcome: "rejected", reason: "OwnerRequired" }
  if (identity.capability !== "controlCapable") return { outcome: "rejected", reason: "ClientReadOnly" }
  let input: typeof SaveInput.Type
  try { input = Schema.decodeUnknownSync(SaveInput)(raw) } catch { return { outcome: "rejected", reason: "InvalidInput" } }
  if (input.outputs.length === 0 || input.outputs.length > 8 || new Set(input.outputs.map((output) => output.representation)).size !== input.outputs.length) return { outcome: "rejected", reason: "InvalidInput" }
  if (input.metadata !== undefined && !matchesDurableSourceMetadata(database, input.metadata)) return { outcome: "rejected", reason: "InvalidInput" }
  const semanticKey = createHash("sha256").update(JSON.stringify({ version: 2, sessionId: input.sessionId, expectedRevision: input.expectedRevision, outputs: input.outputs, metadata: input.metadata, personId: identity.personId })).digest("hex")
  const existingRaw: unknown = database.prepare("SELECT semantic_key,response FROM process_save_receipts WHERE idempotency_key=? AND owner_person_id=?").get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(Schema.optional(Existing))(existingRaw)
  if (existing !== undefined) return existing.semantic_key === semanticKey ? Schema.decodeUnknownSync(Schema.Struct({ outcome: Schema.Literal("accepted"), assetIds: Schema.Array(Schema.String) }))(JSON.parse(existing.response)) : { outcome: "rejected", reason: "InvalidInput" }
  const staged: Array<{ readonly assetId: string; readonly representation: "linearMaster" | "final"; readonly finalPath: string; readonly checksum: string }> = []
  let temporary: string | undefined
  try {
    mkdirSync(storage.outputsRoot, { recursive: true })
    for (const output of input.outputs) {
      const sourcePath = selectedSource(storage, output.sourceId)
      const assetId = `asset-process-${randomUUID()}`
      const finalPath = appPath(storage.outputsRoot, `${assetId}.${output.representation === "final" ? "tiff" : "fits"}`)
      temporary = appPath(storage.outputsRoot, `.${assetId}.tmp`)
      copyFileSync(sourcePath, temporary)
      const checksum = checksumFile(temporary)
      if (checksum.length !== 64) throw new Error("checksum failed")
      renameSync(temporary, finalPath)
      temporary = undefined
      staged.push({ assetId, representation: output.representation, finalPath, checksum })
    }
  } catch {
    if (temporary !== undefined && existsSync(temporary)) rmSync(temporary)
    if (!recordOrphans(database, staged)) return { outcome: "rejected", reason: "OrphanRecordingFailed" }
    return { outcome: "rejected", reason: "MaterializationFailed" }
  }
  try {
    database.exec("BEGIN IMMEDIATE")
    const result: ProcessSaveResult = { outcome: "accepted", assetIds: staged.map((output) => output.assetId) }
    for (const output of staged) {
      const detail = { assetId: output.assetId, revision: 1, role: output.representation, format: output.representation === "final" ? "tiff" : "fits", availability: "availableLocally", capturedAt: new Date().toISOString(), comparisonGroupId: input.metadata?.comparisonGroupId ?? "m27-stack-1", lineage: { sourceAssetIds: input.metadata?.sourceAssetIds ?? ["asset-m27-001"], runId: input.metadata?.runId ?? "run-m27-001", solveAttemptId: input.metadata?.solveAttemptId ?? "solve-m27-001" }, representations: [{ label: "Permanent local output retained", state: "available" }] }
      database.prepare("INSERT INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)").run(output.assetId, 1, output.representation, detail.format, "availableLocally", detail.comparisonGroupId, detail.capturedAt, detail.capturedAt, 0, JSON.stringify(detail))
      database.prepare("INSERT INTO process_asset_events (asset_id,event_type,checksum) VALUES (?,?,?)").run(output.assetId, "ProcessSaved", output.checksum)
      database.prepare("INSERT INTO outbox (id,kind,payload,state) VALUES (?,?,?,?)").run(randomUUID(), "PublishAsset", JSON.stringify({ assetId: output.assetId, checksum: output.checksum }), "pending")
    }
    database.prepare("INSERT INTO process_save_receipts VALUES (?,?,?,?)").run(input.idempotencyKey, identity.personId, semanticKey, JSON.stringify(result))
    database.exec("COMMIT")
    return result
  } catch {
    database.exec("ROLLBACK")
    if (!recordOrphans(database, staged)) return { outcome: "rejected", reason: "OrphanRecordingFailed" }
    return { outcome: "rejected", reason: "MaterializationFailed" }
  }
}

export function cleanupProcessOrphans(database: DatabaseSync, storage: ProcessSaveStorage) {
  const rows = database.prepare("SELECT path FROM process_save_orphans ORDER BY rowid LIMIT 100").all() as ReadonlyArray<{ readonly path: string }>
  return rows.reduce((removed, row) => { try { const path = appPath(storage.outputsRoot, basename(row.path)); if (existsSync(path)) rmSync(path); database.prepare("DELETE FROM process_save_orphans WHERE path=?").run(row.path); return removed + 1 } catch { return removed } }, 0)
}

function selectedSource(storage: ProcessSaveStorage, sourceId: string) { const configured = storage.sources[sourceId]; if (configured === undefined) throw new Error("unknown source") ; const path = appPath(storage.sourcesRoot, configured); if (lstatSync(path).isSymbolicLink()) throw new Error("symlink source") ; return path }
function matchesDurableSourceMetadata(database: DatabaseSync, metadata: { readonly comparisonGroupId: string; readonly sourceAssetIds: ReadonlyArray<string>; readonly runId: string; readonly solveAttemptId: string }) {
  if (metadata.sourceAssetIds.length === 0 || metadata.sourceAssetIds.length > 16 || new Set(metadata.sourceAssetIds).size !== metadata.sourceAssetIds.length) return false
  return metadata.sourceAssetIds.every((assetId) => {
    try {
      const original = Schema.decodeUnknownSync(Schema.optional(DurableOriginal))(database.prepare("SELECT asset_id,role,comparison_group_id,detail FROM library_assets WHERE asset_id=?").get(assetId))
      if (original === undefined || original.comparison_group_id !== metadata.comparisonGroupId) return false
      const detail = Schema.decodeUnknownSync(DurableOriginalDetail)(JSON.parse(original.detail))
      return detail.lineage.runId === metadata.runId && detail.lineage.solveAttemptId === metadata.solveAttemptId
    } catch { return false }
  })
}
function appPath(root: string, child: string) { const resolvedRoot = resolve(root); const candidate = resolve(resolvedRoot, child); if (relative(resolvedRoot, candidate).startsWith("..") || relative(resolvedRoot, candidate) === "") throw new Error("path escape"); return candidate }
function checksumFile(path: string) { return createHash("sha256").update(requireBytes(path)).digest("hex") }
function requireBytes(path: string) { return readFileSync(path) }
function recordOrphans(database: DatabaseSync, staged: ReadonlyArray<{ readonly finalPath: string; readonly checksum: string }>) { try { staged.forEach((output) => database.prepare("INSERT OR IGNORE INTO process_save_orphans VALUES (?,?,?)").run(output.finalPath, output.checksum, new Date().toISOString())); return true } catch { return false } }
