import { WebContents, ipcMain } from 'electron'
import { Effect } from 'effect'

import { appRuntime } from '../runtime/app-runtime'
import { StatusProjector } from '../state/status-projector'
import { runFakeConnect, runFakeDisconnect } from '../workflows/fake-connect-workflow'
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

  ipcMain.handle('seestar:v2:fake-connect', (_event, input) =>
    appRuntime.runPromise(
      runFakeConnect(input).pipe(
        Effect.flatMap(() => Effect.gen(function* () {
          const projector = yield* StatusProjector
          return yield* projector.snapshot
        }))
      )
    )
  )

  ipcMain.handle('seestar:v2:fake-disconnect', () =>
    appRuntime.runPromise(
      runFakeDisconnect.pipe(
        Effect.flatMap(() => Effect.gen(function* () {
          const projector = yield* StatusProjector
          return yield* projector.snapshot
        }))
      )
    )
  )
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
