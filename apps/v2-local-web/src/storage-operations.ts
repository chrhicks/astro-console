import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, rmSync, statfsSync, unlinkSync, writeSync } from "node:fs"
import { relative, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import * as Schema from "effect/Schema"

const CleanupRow = Schema.Struct({ path: Schema.String, kind: Schema.Literals(["orphan", "scratch", "sourceOrphan"]) })
export type StorageThresholds = { readonly noticeFreeBytes: number; readonly blockFreeBytes: number; readonly criticalFreeBytes: number; readonly noticeFreeInodes: number; readonly blockFreeInodes: number; readonly criticalFreeInodes: number; readonly noticeWriteLatencyMs: number; readonly blockWriteLatencyMs: number; readonly criticalWriteLatencyMs: number }
export type StorageProbe = { readonly freeBytes: (root: string) => number; readonly freeInodes: (root: string) => number; readonly writeLatencyMs: (root: string) => number }
export type StorageOperationsConfig = { readonly scratchRoot: string; readonly outputsRoot: string; readonly originalsRoot?: string; readonly thresholds: StorageThresholds; readonly probe?: StorageProbe; readonly cleanupBatchSize?: number }

export function createStorageOperations(database: DatabaseSync, config: StorageOperationsConfig) {
  const batchSize = config.cleanupBatchSize ?? 32
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Storage cleanup batch size must be between 1 and 100")
  const probe = config.probe ?? localStorageProbe
  const health = () => {
    const measured = { freeBytes: probe.freeBytes(config.scratchRoot), freeInodes: probe.freeInodes(config.scratchRoot), writeLatencyMs: probe.writeLatencyMs(config.scratchRoot) }
    const state = storageState(measured, config.thresholds)
    return { ...measured, state, capture: state === "critical" ? "throttleOptionalDerivedWrites" as const : state === "blockNewLongWork" ? "blockNewLongWork" as const : "allow" as const }
  }
  const cleanup = () => Schema.decodeUnknownSync(Schema.Array(CleanupRow))(database.prepare("SELECT path,kind FROM (SELECT path,'orphan' AS kind FROM process_save_orphans UNION ALL SELECT path,'scratch' AS kind FROM storage_scratch_entries WHERE eligible_at<=? UNION ALL SELECT path,'sourceOrphan' AS kind FROM source_ingest_orphans) ORDER BY kind,path LIMIT ?").all(new Date().toISOString(), batchSize)).reduce((result, row) => {
    const root = row.kind === "orphan" ? config.outputsRoot : row.kind === "sourceOrphan" ? config.originalsRoot : config.scratchRoot
    if (root === undefined) return { ...result, refused: result.refused + 1 }
    try { const path = containedPath(root, row.path); if (lstatSync(path).isSymbolicLink()) return { ...result, refused: result.refused + 1 }; rmSync(path, { force: true }); removeRecord(database, row); return { ...result, removed: result.removed + 1 } } catch (error) { if (isMissing(error)) { removeRecord(database, row); return { ...result, missing: result.missing + 1 } } return { ...result, refused: result.refused + 1 } }
  }, { removed: 0, missing: 0, refused: 0 })
  return { health, cleanup }
}

export function storageState(measured: { readonly freeBytes: number; readonly freeInodes: number; readonly writeLatencyMs: number }, thresholds: StorageThresholds) {
  validateThresholds(thresholds)
  if (measured.freeBytes <= thresholds.criticalFreeBytes || measured.freeInodes <= thresholds.criticalFreeInodes || measured.writeLatencyMs >= thresholds.criticalWriteLatencyMs) return "critical" as const
  if (measured.freeBytes <= thresholds.blockFreeBytes || measured.freeInodes <= thresholds.blockFreeInodes || measured.writeLatencyMs >= thresholds.blockWriteLatencyMs) return "blockNewLongWork" as const
  if (measured.freeBytes <= thresholds.noticeFreeBytes || measured.freeInodes <= thresholds.noticeFreeInodes || measured.writeLatencyMs >= thresholds.noticeWriteLatencyMs) return "notice" as const
  return "healthy" as const
}

function validateThresholds(thresholds: StorageThresholds) { for (const value of Object.values(thresholds)) if (!Number.isFinite(value) || value < 0) throw new Error("Storage thresholds must be finite non-negative numbers"); if (thresholds.criticalFreeBytes > thresholds.blockFreeBytes || thresholds.blockFreeBytes > thresholds.noticeFreeBytes || thresholds.criticalFreeInodes > thresholds.blockFreeInodes || thresholds.blockFreeInodes > thresholds.noticeFreeInodes || thresholds.criticalWriteLatencyMs < thresholds.blockWriteLatencyMs || thresholds.blockWriteLatencyMs < thresholds.noticeWriteLatencyMs) throw new Error("Storage thresholds must become stricter from notice to critical") }
function containedPath(root: string, recorded: string) { const resolvedRoot = resolve(root); if (lstatSync(resolvedRoot).isSymbolicLink()) throw new Error("Cleanup root must not be a symlink"); const path = resolve(recorded); const pathRelative = relative(resolvedRoot, path); if (pathRelative === "" || pathRelative.startsWith("..") || pathRelative.includes("../")) throw new Error("Recorded cleanup path escapes its owned root"); return path }
function removeRecord(database: DatabaseSync, row: typeof CleanupRow.Type) { database.prepare(row.kind === "orphan" ? "DELETE FROM process_save_orphans WHERE path=?" : row.kind === "sourceOrphan" ? "DELETE FROM source_ingest_orphans WHERE path=?" : "DELETE FROM storage_scratch_entries WHERE path=?").run(row.path) }
function isMissing(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT" }
const localStorageProbe: StorageProbe = { freeBytes: (root) => { const stat = statfsSync(root); return Number(stat.bavail) * Number(stat.bsize) }, freeInodes: (root) => Number(statfsSync(root).ffree), writeLatencyMs: (root) => { mkdirSync(root, { recursive: true }); const path = resolve(root, `.storage-health-${process.pid}-${Date.now()}`); const startedAt = performance.now(); const descriptor = openSync(path, "wx", 0o600); try { writeSync(descriptor, Buffer.alloc(4_096)); fsyncSync(descriptor) } finally { closeSync(descriptor); unlinkSync(path) } return performance.now() - startedAt } }
