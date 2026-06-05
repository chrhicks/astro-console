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

  console.log('=== PROBING FILE SYSTEM ===\n')

  // 1. Try get_albums with different params
  console.log('1. get_albums (default):')
  const albums = await device.getAlbums()
  if (albums) {
    console.log(`   Path: ${albums.path}`)
    for (const entry of albums.list) {
      console.log(`   Entry: ${entry.name || '(unnamed)'}`)
      console.log(`   Files count: ${entry.files.length}`)
      for (const f of entry.files) {
        console.log(`     - ${f.name} | thn: ${f.thn}`)
      }
    }
  }

  // 2. Try HTTP directory listing on album subfolders
  console.log('\n2. HTTP directory probes:')
  const probes = [
    'http://192.168.4.23/MyWorks/Solar_video/',
    'http://192.168.4.23/MyWorks/Solar_video',
    'http://192.168.4.23/MyWorks/',
    'http://192.168.4.23/albums/',
    'http://192.168.4.23/storage/',
  ]
  for (const url of probes) {
    try {
      const resp = await fetch(url, { method: 'GET' })
      const text = await resp.text()
      console.log(`   ${url} -> HTTP ${resp.status}, len=${text.length}`)
      if (text.length < 500 && !text.includes('404')) {
        console.log(`   Content: ${text.slice(0, 200)}`)
      }
    } catch (e: any) {
      console.log(`   ${url} -> ERROR: ${e.message}`)
    }
  }

  // 3. Try other JSON-RPC methods that might list files
  console.log('\n3. JSON-RPC file methods:')
  const methods = [
    'get_last_images',
    'get_last_image',
    'get_album_detail',
    'get_file_list',
    'get_storage_info',
    'get_folder_list',
  ]
  for (const method of methods) {
    try {
      const resp = await device.rawClient.sendSync(method, '')
      console.log(
        `   ${method}: code=${resp.code}, has_result=${resp.result !== undefined}`,
      )
      if (resp.result) {
        console.log(`   -> ${JSON.stringify(resp.result).slice(0, 300)}`)
      }
    } catch (e: any) {
      console.log(`   ${method}: ERROR - ${e.message}`)
    }
  }

  // 4. Try get_albums with a specific folder param if supported
  console.log('\n4. get_albums with params:')
  try {
    const resp = await device.rawClient.sendSync('get_albums', {
      folder: 'Solar_video',
    })
    console.log(
      `   code=${resp.code}, result=${JSON.stringify(resp.result).slice(0, 300)}`,
    )
  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`)
  }

  device.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
