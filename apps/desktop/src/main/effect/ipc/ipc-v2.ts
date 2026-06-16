import { WebContents, ipcMain } from 'electron'
import { Effect } from 'effect'

import { appRuntime } from '../runtime/app-runtime'
import type { ConnectRequestV2 } from '../../../shared/api-v2'
import { runConnect, runDiscover, runDisconnect } from '../workflows/session-workflows'
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
      })
    )
  )

  ipcMain.handle('seestar:v2:discover', () =>
    appRuntime.runPromise(
      runDiscover,
    )
  )

  ipcMain.handle('seestar:v2:connect', (_event, input: ConnectRequestV2) =>
    appRuntime.runPromise(
      runConnect(input).pipe(Effect.flatMap(() => getProjectedStatus()))
    )
  )

  ipcMain.handle('seestar:v2:disconnect', () =>
    appRuntime.runPromise(
      runDisconnect.pipe(Effect.flatMap(() => getProjectedStatus()))
    )
  )

  ipcMain.handle('seestar:v2:get-logs', () =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const sink = yield* LogSink
        return yield* sink.list
      }),
    )
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
    })
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
    })
  )
}
