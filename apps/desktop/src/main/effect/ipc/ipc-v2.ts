import { WebContents, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Effect } from 'effect'

import { appRuntime } from '../runtime/app-runtime'
import type {
  CatalogQuery,
  ConnectRequestV2,
  PointToTargetRequest,
  SetExposureDurationRequest,
} from '../../../shared/api-v2'
import {
  runConnect,
  runDiscover,
  runDisconnect,
} from '../workflows/session-workflows'
import { runPointToTarget } from '../workflows/pointing-workflows'
import { runStartPreview, runStopPreview } from '../workflows/preview-workflows'
import {
  runSetExposureDuration,
  runStartCapture,
  runStopCapture,
} from '../workflows/capture-workflows'
import { runPark } from '../workflows/park-workflows'
import { resolveExternalFramesRoot } from '../storage/frame-storage'
import { CatalogStore } from '../catalog/catalog-store'
import { LogSink } from '../log/log-sink'
import { LogStream } from '../log/log-stream'
import { StatusProjector } from '../state/status-projector'
import { StatusStream } from '../event/status-stream'

export function registerIpcV2Handlers() {
  ipcMain.handle('seestar:v2:get-status', () =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const projector = yield* StatusProjector
        return yield* projector.snapshot
      }),
    ),
  )

  ipcMain.handle('seestar:v2:discover', () =>
    appRuntime.runPromise(runDiscover),
  )

  ipcMain.handle('seestar:v2:connect', (_event, input: ConnectRequestV2) =>
    appRuntime.runPromise(
      runConnect(input).pipe(Effect.flatMap(() => getProjectedStatus())),
    ),
  )

  ipcMain.handle('seestar:v2:disconnect', () =>
    appRuntime.runPromise(
      runDisconnect.pipe(Effect.flatMap(() => getProjectedStatus())),
    ),
  )

  ipcMain.handle('seestar:v2:get-logs', () =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const sink = yield* LogSink
        return yield* sink.list
      }),
    ),
  )

  ipcMain.handle(
    'seestar:v2:browse-targets',
    (_event, query: CatalogQuery = {}) =>
      appRuntime.runPromise(
        Effect.gen(function* () {
          const catalog = yield* CatalogStore
          return yield* catalog.browse(query)
        }),
      ),
  )

  ipcMain.handle('seestar:v2:get-target-by-id', (_event, targetId: string) =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogStore
        return yield* catalog.getDetailsById(targetId)
      }),
    ),
  )

  ipcMain.handle(
    'seestar:v2:point-to-target',
    (_event, input: PointToTargetRequest) =>
      appRuntime.runPromise(
        runPointToTarget(input.targetId).pipe(
          Effect.flatMap(() => getProjectedStatus()),
        ),
      ),
  )

  ipcMain.handle('seestar:v2:start-preview', () =>
    appRuntime.runPromise(
      runStartPreview.pipe(Effect.flatMap(() => getProjectedStatus())),
    ),
  )

  ipcMain.handle('seestar:v2:stop-preview', () =>
    appRuntime.runPromise(
      runStopPreview.pipe(Effect.flatMap(() => getProjectedStatus())),
    ),
  )

  ipcMain.handle('seestar:v2:start-capture', () =>
    appRuntime.runPromise(
      runStartCapture.pipe(Effect.flatMap(() => getProjectedStatus())),
    ),
  )

  ipcMain.handle('seestar:v2:stop-capture', () =>
    appRuntime.runPromise(
      runStopCapture.pipe(Effect.flatMap(() => getProjectedStatus())),
    ),
  )

  ipcMain.handle('seestar:v2:park', () =>
    appRuntime.runPromise(
      runPark.pipe(Effect.flatMap(() => getProjectedStatus())),
    ),
  )

  ipcMain.handle(
    'seestar:v2:set-exposure-duration',
    (_event, input: SetExposureDurationRequest) =>
      appRuntime.runPromise(
        runSetExposureDuration(input.durationSec).pipe(
          Effect.flatMap(() => getProjectedStatus()),
        ),
      ),
  )

  ipcMain.handle('seestar:v2:open-saved-asset', (_event, filePath: string) =>
    openSavedAsset(filePath),
  )

  ipcMain.handle('seestar:v2:reveal-saved-asset', (_event, filePath: string) =>
    revealSavedAsset(filePath),
  )

  ipcMain.handle(
    'seestar:v2:get-saved-asset-preview',
    (_event, filePath: string) => readSavedAssetPreview(filePath),
  )
}

function getProjectedStatus() {
  return Effect.gen(function* () {
    const projector = yield* StatusProjector
    return yield* projector.snapshot
  })
}

// Renderer-supplied paths are echoed back from LibraryAsset.savedFilePath, which
// the main process generated. Validate the resolved path stays under the
// external-frames root before handing it to shell so a compromised renderer
// cannot trigger openPath/showItemInFolder on arbitrary filesystem locations.
function resolveSavedAssetPath(filePath: string): string {
  const root = resolveExternalFramesRoot()
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('saved asset path is outside the library')
  }
  return resolved
}

async function openSavedAsset(filePath: string): Promise<void> {
  const error = await shell.openPath(resolveSavedAssetPath(filePath))
  if (error) throw new Error(error)
}

async function revealSavedAsset(filePath: string): Promise<void> {
  shell.showItemInFolder(resolveSavedAssetPath(filePath))
}

// Reads a saved preview JPG as a data URL for the renderer. Returns null when
// the path is outside the library or the file is unreadable (e.g. preview
// generation failed for that frame) so the UI can show a no-preview fallback.
async function readSavedAssetPreview(filePath: string): Promise<string | null> {
  const root = resolveExternalFramesRoot()
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(root + path.sep)) return null
  try {
    const bytes = await fs.readFile(resolved)
    return 'data:image/jpeg;base64,' + bytes.toString('base64')
  } catch {
    return null
  }
}

export function attachIpcV2StatusListener(webContents: WebContents) {
  appRuntime.runPromise(
    Effect.gen(function* () {
      const stream = yield* StatusStream
      const unsubscribe = yield* stream.subscribe((status) => {
        if (!webContents.isDestroyed()) {
          webContents.send('seestar:v2:status', status)
        }
      })

      webContents.once('destroyed', unsubscribe)
    }),
  )
}

export function attachIpcV2LogListener(webContents: WebContents) {
  appRuntime.runPromise(
    Effect.gen(function* () {
      const stream = yield* LogStream
      const unsubscribe = yield* stream.subscribe((entry) => {
        if (!webContents.isDestroyed()) {
          webContents.send('seestar:v2:log', entry)
        }
      })

      webContents.once('destroyed', unsubscribe)
    }),
  )
}
