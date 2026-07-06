import { WebContents, ipcMain } from 'electron'
import { Effect } from 'effect'

import { appRuntime } from '../runtime/app-runtime'
import type {
  CatalogQuery,
  ConnectRequestV2,
  PointToTargetRequest,
} from '../../../shared/api-v2'
import {
  runConnect,
  runDiscover,
  runDisconnect,
} from '../workflows/session-workflows'
import { runPointToTarget } from '../workflows/pointing-workflows'
import { runStartPreview, runStopPreview } from '../workflows/preview-workflows'
import { runStartCapture, runStopCapture } from '../workflows/capture-workflows'
import { runPark } from '../workflows/park-workflows'
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
        return yield* catalog.getById(targetId)
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
}

function getProjectedStatus() {
  return Effect.gen(function* () {
    const projector = yield* StatusProjector
    return yield* projector.snapshot
  })
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
