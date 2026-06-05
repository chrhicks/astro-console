import { SeestarDevice } from './device.js'

async function main() {
  const HOST = process.env.SEESTAR_HOST || '192.168.4.23'
  const PEM = process.env.SEESTAR_PEM || '../seestar_3.1.2_fw_7.32_interop.pem'

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

  const albums = await device.getAlbums()
  if (!albums) {
    console.error('Failed to get albums')
    process.exit(1)
  }

  console.log(`Album path: ${albums.path}\n`)
  console.log('=== ALL ENTRIES ===')
  for (const entry of albums.list) {
    console.log(
      `\nEntry: ${entry.name || '(unnamed)'} — ${entry.files.length} files`,
    )
    for (const file of entry.files) {
      console.log(`  - ${file.name}`)
      console.log(`    thn: ${file.thn}`)
    }
  }

  console.log('\n\n=== VIDEO FILES ===')
  const videoFiles = albums.list
    .flatMap((e) => e.files)
    .filter(
      (f) =>
        f.name.toLowerCase().includes('video') ||
        f.thn.toLowerCase().includes('timelapse') ||
        f.thn.toLowerCase().endsWith('.mp4') ||
        f.name.toLowerCase().includes('timelapse'),
    )

  for (const file of videoFiles) {
    const mp4Url = device.resolveImageUrl(file.thn, false, '.mp4')
    const jpgUrl = device.resolveImageUrl(file.thn, false, '.jpg')
    console.log(`\n  Name: ${file.name}`)
    console.log(`  Thumbnail: ${file.thn}`)
    console.log(`  MP4 URL:   ${mp4Url}`)
    console.log(`  JPG URL:   ${jpgUrl}`)
  }

  device.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
