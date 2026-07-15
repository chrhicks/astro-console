import { WebContents, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Effect, Result, Schema } from 'effect'

import { appRuntime } from '../runtime/app-runtime'
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
  MAX_EXPOSURE_DURATION_SEC,
} from '../workflows/capture-workflows'
import { runPark } from '../workflows/park-workflows'
import {
  runConfigureExternalSequence,
  runContinueExternalSequence,
  runFinishExternalSequence,
  runStartExternalSequence,
  MAX_SEQUENCE_DARKS,
  MAX_SEQUENCE_LIGHTS,
} from '../workflows/external-sequence'
import { resolveExternalFramesRoot } from '../storage/frame-storage'
import { getManagedAssetPath } from '../storage/asset-registry'
import { CatalogStore } from '../catalog/catalog-store'
import { LogSink } from '../log/log-sink'
import { LogStream } from '../log/log-stream'
import { StatusProjector } from '../state/status-projector'
import { StatusStream } from '../event/status-stream'
import { ownedIpcHandle } from './owned-ipc'

export function registerIpcV2Handlers(allowed: WebContents) {
  const handle = ownedIpcHandle(allowed)

  handle('seestar:v2:get-status', () =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const projector = yield* StatusProjector
        return yield* projector.snapshot
      }),
    ),
  )

  handle('seestar:v2:discover', () => appRuntime.runPromise(runDiscover))

  handle('seestar:v2:connect', (_event, input) =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const decoded = yield* decodeIpc(ConnectRequestSchema, input)
        return yield* withProjectedStatus(runConnect(decoded))
      }),
    ),
  )

  handle('seestar:v2:disconnect', () =>
    appRuntime.runPromise(withProjectedStatus(runDisconnect)),
  )

  handle('seestar:v2:get-logs', () =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const sink = yield* LogSink
        return yield* sink.list
      }),
    ),
  )

  handle('seestar:v2:browse-targets', (_event, query) =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const decoded = yield* decodeIpc(CatalogQuerySchema, query ?? {})
        const catalog = yield* CatalogStore
        return yield* catalog.browse(decoded)
      }),
    ),
  )

  handle('seestar:v2:get-target-by-id', (_event, targetId) =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const decoded = yield* decodeIpc(Schema.String, targetId)
        const catalog = yield* CatalogStore
        return yield* catalog.getDetailsById(decoded)
      }),
    ),
  )

  handle('seestar:v2:point-to-target', (_event, input) =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const decoded = yield* decodeIpc(PointToTargetRequestSchema, input)
        return yield* withProjectedStatus(runPointToTarget(decoded.targetId))
      }),
    ),
  )

  handle('seestar:v2:start-preview', () =>
    appRuntime.runPromise(withProjectedStatus(runStartPreview)),
  )

  handle('seestar:v2:stop-preview', () =>
    appRuntime.runPromise(withProjectedStatus(runStopPreview)),
  )

  handle('seestar:v2:start-capture', () =>
    appRuntime.runPromise(withProjectedStatus(runStartCapture)),
  )

  handle('seestar:v2:stop-capture', () =>
    appRuntime.runPromise(withProjectedStatus(runStopCapture)),
  )

  handle('seestar:v2:park', () =>
    appRuntime.runPromise(withProjectedStatus(runPark)),
  )

  handle('seestar:v2:set-exposure-duration', (_event, input) =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const decoded = yield* decodeIpc(
          SetExposureDurationRequestSchema,
          input,
        )
        return yield* withProjectedStatus(
          runSetExposureDuration(decoded.durationSec),
        )
      }),
    ),
  )

  handle('seestar:v2:configure-external-sequence', (_event, input) =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const decoded = yield* decodeIpc(ExternalSequencePlanSchema, input)
        return yield* withProjectedStatus(runConfigureExternalSequence(decoded))
      }),
    ),
  )
  handle('seestar:v2:start-external-sequence', () =>
    appRuntime.runPromise(withProjectedStatus(runStartExternalSequence)),
  )
  handle('seestar:v2:continue-external-sequence', () =>
    appRuntime.runPromise(withProjectedStatus(runContinueExternalSequence)),
  )
  handle('seestar:v2:finish-external-sequence', () =>
    appRuntime.runPromise(withProjectedStatus(runFinishExternalSequence)),
  )

  handle('seestar:v2:open-saved-asset', (_event, assetId) =>
    openSavedAsset(requireAssetId(assetId)),
  )

  handle('seestar:v2:reveal-saved-asset', (_event, assetId) =>
    revealSavedAsset(requireAssetId(assetId)),
  )

  handle('seestar:v2:get-saved-asset-preview', (_event, assetId) =>
    readSavedAssetPreview(requireAssetId(assetId)),
  )
}

function getProjectedStatus() {
  return Effect.gen(function* () {
    const projector = yield* StatusProjector
    return yield* projector.snapshot
  })
}

function withProjectedStatus<A, E, R>(workflow: Effect.Effect<A, E, R>) {
  return workflow.pipe(Effect.flatMap(() => getProjectedStatus()))
}

// IPC input crosses the renderer→main trust boundary. Renderer payloads are
// structurally typed on the renderer side but arrive as unknown over
// ipcMain.handle; these schemas decode them at the boundary so workflow code
// never receives an unvalidated shape.
const ConnectRequestSchema = Schema.Struct({
  pluginKind: Schema.Literals(['fake-seestar', 'seestar', 'alpaca-rig']),
  deviceId: Schema.String,
})

const CatalogQuerySchema = Schema.Struct({
  search: Schema.optional(Schema.String),
  upNowOnly: Schema.optional(Schema.Boolean),
  typeFilter: Schema.optional(
    Schema.Literals(['dso', 'sun', 'moon', 'planet']),
  ),
  offset: Schema.optional(
    Schema.Number.check(
      Schema.isFinite(),
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0),
    ),
  ),
  limit: Schema.optional(
    Schema.Number.check(
      Schema.isFinite(),
      Schema.isInt(),
      Schema.isGreaterThan(0),
    ),
  ),
})

const PointToTargetRequestSchema = Schema.Struct({
  targetId: Schema.String,
})

const SetExposureDurationRequestSchema = Schema.Struct({
  durationSec: Schema.Number.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(MAX_EXPOSURE_DURATION_SEC),
  ),
})

const ExternalSequencePlanSchema = Schema.Struct({
  lightCount: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: MAX_SEQUENCE_LIGHTS }),
  ),
  durationSec: Schema.Number.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(MAX_EXPOSURE_DURATION_SEC),
  ),
  darkCount: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 0, maximum: MAX_SEQUENCE_DARKS }),
  ),
})

function decodeIpc<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): Effect.Effect<S['Type'], Error> {
  const decoded = Schema.decodeUnknownResult(schema)(input)
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      new Error(`Invalid IPC input: ${decoded.failure.message}`),
    )
  }
  return Effect.succeed(decoded.success)
}

// Decodes the opaque renderer-supplied asset ID at the IPC boundary.
function requireAssetId(input: unknown): string {
  const decoded = Schema.decodeUnknownResult(Schema.String)(input)
  if (Result.isFailure(decoded)) {
    throw new Error('Invalid saved asset id')
  }
  return decoded.success
}

// Asset IDs have authority only when present in the main-process registry.
// Resolve the registered path and managed root through symlinks before checking
// containment so a replaced symlink cannot escape the library.
async function resolveSavedAssetPath(assetId: string): Promise<string> {
  const root = await fs.realpath(resolveExternalFramesRoot())
  const registered = getManagedAssetPath(assetId)
  if (!registered) throw new Error('Unknown saved asset id')
  const resolved = await fs.realpath(registered)
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('saved asset path is outside the library')
  }
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('saved asset is not a regular file')
  return resolved
}

async function openSavedAsset(assetId: string): Promise<void> {
  const error = await shell.openPath(await resolveSavedAssetPath(assetId))
  if (error) throw new Error(error)
}

async function revealSavedAsset(assetId: string): Promise<void> {
  shell.showItemInFolder(await resolveSavedAssetPath(assetId))
}

// Reads a saved preview JPG as a data URL for the renderer. Returns null when
// the path is outside the library, is not a .preview.jpg sibling, exceeds the
// preview size cap, or is unreadable (e.g. preview generation failed for that
// frame) so the UI can show a no-preview fallback.
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024 // 2 MB; preview JPGs are ≤1600px edge

async function readSavedAssetPreview(assetId: string): Promise<string | null> {
  try {
    const fits = await resolveSavedAssetPath(assetId)
    const resolved = fits.replace(/\.fits$/, '.preview.jpg')
    const stat = await fs.lstat(resolved)
    if (!stat.isFile() || stat.size > PREVIEW_MAX_BYTES) return null
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
