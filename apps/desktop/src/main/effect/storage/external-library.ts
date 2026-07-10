import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { LibraryAsset } from '../../../shared/api-v2'
import { resolveExternalFramesRoot } from './frame-storage'

// Scans the external-frames root and rebuilds LibraryAsset entries from saved
// FITS files and their sibling preview JPGs. Best-effort: unreadable files or
// directories are skipped so connect never fails on a corrupt library. Returns
// assets newest-first so the latest preview still drives the main work area.
export async function readExternalLibraryFromDisk(): Promise<LibraryAsset[]> {
  const root = resolveExternalFramesRoot()
  const fitsFiles = await listFitsFiles(root)
  const assets: LibraryAsset[] = []
  for (const fitsPath of fitsFiles) {
    const asset = await readAssetFromDisk(root, fitsPath)
    if (asset) assets.push(asset)
  }
  assets.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  return assets
}

async function listFitsFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
  if (!entries) return []
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const sub of await listFitsFiles(full)) files.push(sub)
    } else if (entry.isFile() && entry.name.endsWith('.fits')) {
      files.push(full)
    }
  }
  return files
}

async function readAssetFromDisk(
  root: string,
  fitsPath: string,
): Promise<LibraryAsset | null> {
  const stat = await fs.stat(fitsPath).catch(() => null)
  if (!stat) return null
  const previewPath = fitsPath.replace(/\.fits$/, '.preview.jpg')
  const preview = await readPreviewSibling(previewPath)
  const dimensions = await readFitsDimensions(fitsPath)
  const relativePath = path.relative(root, fitsPath)
  return {
    id: `ext-${relativePath}`,
    name: path.basename(fitsPath, '.fits'),
    capturedAt: parseCapturedAtFromName(fitsPath, stat.mtime),
    kind: 'exposure',
    savedFilePath: fitsPath,
    savedFileSize: stat.size,
    previewFilePath: preview?.previewFilePath,
    previewFileSize: preview?.previewFileSize,
    frameWidth: dimensions?.width,
    frameHeight: dimensions?.height,
  }
}

async function readPreviewSibling(
  previewPath: string,
): Promise<{ previewFilePath: string; previewFileSize: number } | null> {
  const stat = await fs.stat(previewPath).catch(() => null)
  if (!stat || !stat.isFile()) return null
  return { previewFilePath: previewPath, previewFileSize: stat.size }
}

// Reads only the FITS primary HDU header block to recover frame dimensions.
// One 2880-byte block holds every card the save path writes; if END is not
// found there the file is not one we wrote and dimensions are omitted. Returns
// null on any read/parse failure so the asset still loads without geometry.
async function readFitsDimensions(
  fitsPath: string,
): Promise<{ width: number; height: number } | null> {
  const handle = await fs.open(fitsPath, 'r').catch(() => null)
  if (!handle) return null
  try {
    const header = Buffer.alloc(2880)
    await handle.read(header, 0, 2880, 0)
    return parseFitsDimensions(header)
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

function parseFitsDimensions(
  bytes: Buffer,
): { width: number; height: number } | null {
  const cards = Math.floor(bytes.length / 80)
  if (cards < 1) return null
  if (!bytes.toString('ascii', 0, 80).startsWith('SIMPLE')) return null
  let naxis = 0
  const axes: number[] = []
  let endFound = false
  for (let i = 0; i < cards; i++) {
    const card = bytes.toString('ascii', i * 80, i * 80 + 80)
    const keyword = card.slice(0, 8).trim()
    if (keyword === 'END') {
      endFound = true
      break
    }
    const value = fitsCardValue(card)
    if (value == null) continue
    if (keyword === 'NAXIS') naxis = Number(value)
    else if (keyword.startsWith('NAXIS') && keyword !== 'NAXIS') {
      axes[Number(keyword.slice(5)) - 1] = Number(value)
    }
  }
  if (!endFound || naxis < 2 || naxis > 3) return null
  if (naxis === 2) {
    if (!axes[0] || !axes[1]) return null
    return { width: axes[1], height: axes[0] }
  }
  if (!axes[0] || !axes[1] || !axes[2]) return null
  return { width: axes[2], height: axes[1] }
}

function fitsCardValue(card: string): string | null {
  if (card[8] !== '=' || card[9] !== ' ') return null
  const rest = card.slice(10)
  const slash = rest.indexOf('/')
  const raw = (slash >= 0 ? rest.slice(0, slash) : rest).trim()
  return raw || null
}

// Reconstructs the capturedAt ISO timestamp from the save-path filename
// (YYYY-MM-DD-HHMMSS or YYYY-MM-DD). Falls back to file mtime when the stem does
// not match so renamed or externally produced files still sort by recency.
function parseCapturedAtFromName(fitsPath: string, mtime: Date): string {
  const base = path.basename(fitsPath, '.fits')
  const head = base.split('_')[0]
  const match = head.match(/^(\d{4})-(\d{2})-(\d{2})(?:-(\d{6}))?$/)
  if (match) {
    const [, y, mo, d, time] = match
    if (time) {
      return `${y}-${mo}-${d}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`
    }
    return `${y}-${mo}-${d}T00:00:00`
  }
  return mtime.toISOString()
}
