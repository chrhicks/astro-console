import { DatabaseSync } from "node:sqlite"
import { existsSync } from "node:fs"

const [command, databasePath, targetPath] = process.argv.slice(2)
if ((command !== "backup" && command !== "verify") || !databasePath) throw new Error("Usage: backup-preflight.ts backup <database> <target> | verify <database>")
if (!existsSync(databasePath)) throw new Error("Database path does not exist")
const database = new DatabaseSync(databasePath)
try {
  if (command === "backup") { if (!targetPath) throw new Error("Backup target is required"); database.exec(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`) }
  const integrity: unknown = database.prepare("PRAGMA integrity_check").get()
  if (JSON.stringify(integrity) !== JSON.stringify({ integrity_check: "ok" })) throw new Error("SQLite integrity check failed")
  console.log(command === "backup" ? "SQLite backup and integrity preflight passed." : "SQLite restore-source integrity preflight passed.")
} finally { database.close() }
