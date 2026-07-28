import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

export type BackupEvidence = { readonly path: string; readonly bytes: number; readonly sha256: string; readonly integrity: "ok" }

export function assertSeparateFilesystems(sourcePath: string, backupDirectory: string, deviceId = (path: string) => statSync(path).dev) {
  if (deviceId(sourcePath) === deviceId(backupDirectory)) throw new Error("Backup destination must be on a different filesystem than the live database")
}

export function createSqliteSnapshot(sourcePath: string, targetPath: string): BackupEvidence {
  if (!existsSync(sourcePath)) throw new Error("Database path does not exist")
  if (existsSync(targetPath)) throw new Error("Snapshot target already exists")
  mkdirSync(dirname(targetPath), { recursive: true })
  const database = new DatabaseSync(sourcePath)
  try { database.exec(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`) } finally { database.close() }
  return verifySqlite(sourcePath === targetPath ? sourcePath : targetPath)
}

export function verifySqlite(path: string): BackupEvidence {
  if (!existsSync(path)) throw new Error("Database path does not exist")
  const database = new DatabaseSync(path, { readOnly: true })
  try { const integrity: unknown = database.prepare("PRAGMA integrity_check").get(); if (JSON.stringify(integrity) !== JSON.stringify({ integrity_check: "ok" })) throw new Error("SQLite integrity check failed") } finally { database.close() }
  const bytes = readFileSync(path)
  return { path: basename(path), bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), integrity: "ok" }
}

export function restoreDrill(backupPath: string, drillPath: string): { readonly source: BackupEvidence; readonly restored: BackupEvidence } {
  if (resolve(backupPath) === resolve(drillPath)) throw new Error("Restore drill target must be separate from the backup")
  if (existsSync(drillPath)) throw new Error("Restore drill target already exists")
  const source = verifySqlite(backupPath)
  mkdirSync(dirname(drillPath), { recursive: true })
  const database = new DatabaseSync(backupPath)
  try { database.exec(`VACUUM INTO '${drillPath.replaceAll("'", "''")}'`) } finally { database.close() }
  try { const restored = verifySqlite(drillPath); return { source, restored } } finally { rmSync(drillPath, { force: true }) }
}
