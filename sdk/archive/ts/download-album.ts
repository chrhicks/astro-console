import { SeestarDevice } from './device.js'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as path from 'node:path'

/**
 * Helper to download an HTTP resource to a local file.
 */
export async function downloadFile(
  url: string,
  destPath: string,
): Promise<void> {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`)
  }
  if (!resp.body) {
    throw new Error('No response body')
  }
  const nodeStream = Readable.fromWeb(resp.body as any)
  await pipeline(nodeStream, createWriteStream(destPath))
}

async function main() {
  const HOST = process.env.SEESTAR_HOST || '192.168.4.23'
  const PEM = process.env.SEESTAR_PEM || '../seestar_3.1.2_fw_7.32_interop.pem'
  const OUT_DIR = process.env.OUT_DIR || './downloads'

  console.log(`Connecting to ${HOST}...`)
  const device = new SeestarDevice({
    host: HOST,
    port: 4700,
    pemPath: PEM,
    timeoutMs: 15000,
  })

  const ok = await device.connectAndAuth()
  if (!ok) {
    console.error('Authentication failed')
    process.exit(1)
  }
  console.log('Authenticated successfully.')

  const albums = await device.getAlbums()
  if (!albums) {
    console.error('Failed to get albums')
    process.exit(1)
  }

  console.log(`Album path: ${albums.path}`)
  for (const entry of albums.list) {
    console.log(
      `\nEntry: ${entry.name || '(unnamed)'} — ${entry.files.length} files`,
    )
    for (const file of entry.files.slice(0, 10)) {
      console.log(`  - ${file.name}`)
    }
  }

  // Collect all solar files across entries
  const solarFiles = albums.list
    .flatMap((e) => e.files)
    .filter((f) => f.name.toLowerCase().includes('solar'))

  if (solarFiles.length === 0) {
    console.log('No solar files found.')
    device.disconnect()
    return
  }

  const fs = await import('node:fs')
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true })
  }

  for (const file of solarFiles) {
    const isVideo =
      file.name.toLowerCase().includes('video') ||
      file.name.toLowerCase().includes('timelapse')
    const extension = isVideo ? '.mp4' : '.jpg'
    const fullUrl = device.resolveImageUrl(file.thn, false, extension)
    const filename = path.basename(fullUrl)
    const dest = path.join(OUT_DIR, filename)
    console.log(`\nDownloading ${fullUrl} -> ${dest}`)
    try {
      await downloadFile(fullUrl, dest)
      console.log('  Saved.')
    } catch (err) {
      // Fallback: try .jpg if .mp4 failed, or vice versa
      const fallbackExt = extension === '.mp4' ? '.jpg' : '.mp4'
      const fallbackUrl = device.resolveImageUrl(file.thn, false, fallbackExt)
      const fallbackDest = path.join(OUT_DIR, path.basename(fallbackUrl))
      console.log(
        `  Primary failed, trying fallback ${fallbackUrl} -> ${fallbackDest}`,
      )
      try {
        await downloadFile(fallbackUrl, fallbackDest)
        console.log('  Saved (fallback).')
      } catch (fallbackErr) {
        console.error(`  Fallback also failed: ${fallbackErr}`)
      }
    }
  }

  device.disconnect()
  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
