import {
  createSqliteSnapshot,
  restoreDrill,
  verifySqlite,
} from '../src/persistence/sqlite-resilience.ts'

const [command, databasePath, targetPath] = process.argv.slice(2)
if (
  (command !== 'backup' &&
    command !== 'verify' &&
    command !== 'restore-drill') ||
  !databasePath
)
  throw new Error(
    'Usage: backup-preflight.ts backup <database> <target> | verify <database> | restore-drill <backup> <disposable-target>',
  )
if (command === 'backup') {
  if (!targetPath) throw new Error('Backup target is required')
  console.log(JSON.stringify(createSqliteSnapshot(databasePath, targetPath)))
}
if (command === 'verify')
  console.log(JSON.stringify(verifySqlite(databasePath)))
if (command === 'restore-drill') {
  if (!targetPath) throw new Error('Disposable restore target is required')
  console.log(JSON.stringify(restoreDrill(databasePath, targetPath)))
}
