import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from './import-openngc-parse.js'
import {
  mergeCatalog,
  OPENNGC_PROVENANCE,
  transformRows,
} from './import-openngc-transform.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rawNgcPath = path.join(scriptDir, 'ngc/raw/NGC.csv')
const rawAddendumPath = path.join(scriptDir, 'ngc/raw/addendum.csv')
const outputPath = path.join(
  scriptDir,
  '../src/shared/catalog/catalog-data.json',
)

function formatProvenanceFile(
  file: (typeof OPENNGC_PROVENANCE.files)[number],
): string {
  return `${file.path} sha256=${file.sha256}`
}

async function verifyPinnedFileHash(
  file: (typeof OPENNGC_PROVENANCE.files)[number],
  absolutePath: string,
): Promise<void> {
  const actualSha256 = createHash('sha256')
    .update(await readFile(absolutePath))
    .digest('hex')

  if (actualSha256 !== file.sha256) {
    throw new Error(
      `Pinned hash mismatch for ${file.path}: expected ${file.sha256}, got ${actualSha256}`,
    )
  }
}

async function main(): Promise<void> {
  console.log(`Importing ${OPENNGC_PROVENANCE.upstreamRepo}`)
  console.log(`Using ${OPENNGC_PROVENANCE.snapshot}`)
  console.log(
    `Pinned inputs: ${formatProvenanceFile(OPENNGC_PROVENANCE.files[0])}`,
  )
  console.log(
    `Pinned inputs: ${formatProvenanceFile(OPENNGC_PROVENANCE.files[1])}`,
  )
  console.log(`Reading ${rawNgcPath}`)
  console.log(`Reading ${rawAddendumPath}`)

  await Promise.all([
    verifyPinnedFileHash(OPENNGC_PROVENANCE.files[0], rawNgcPath),
    verifyPinnedFileHash(OPENNGC_PROVENANCE.files[1], rawAddendumPath),
  ])

  console.log('Verified pinned input hashes')

  const [ngcRows, addendumRows] = await Promise.all([
    parseCsv(rawNgcPath),
    parseCsv(rawAddendumPath),
  ])

  const ngcTargets = transformRows(ngcRows)
  const addendumTargets = transformRows(addendumRows)
  const catalog = mergeCatalog(ngcTargets, addendumTargets)

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')

  const ngcIds = new Set(ngcTargets.map((target) => target.id))
  const newAddendumCount = addendumTargets.filter(
    (target) => !ngcIds.has(target.id),
  ).length

  console.log(`Wrote ${catalog.length} DeepSkyTarget records to ${outputPath}`)
  console.log(
    `Filtered ${ngcRows.length + addendumRows.length - catalog.length} NonEx/Dup/star rows`,
  )
  console.log(`Merged ${newAddendumCount} addendum-only targets`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
