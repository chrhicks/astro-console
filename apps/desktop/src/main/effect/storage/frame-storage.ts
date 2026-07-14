import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Context, Effect, Layer, Result } from 'effect'

import { generatePreviewJpeg } from './frame-preview'
import { writeFits, type FrameDescriptor } from './fits-writer'
import { parseCapturedAt } from './timestamp'
import {
  ensureDirBeneathRoot,
  writeFileExclusive,
  writeFileExclusiveWithSequence,
} from './safe-write'

export type { FrameDescriptor } from './fits-writer'

export interface SavedFrame {
  readonly absolutePath: string
  readonly fileSize: number
  // Sibling JPG preview written alongside the FITS file. The FITS still exists
  // when preview persistence fails; previewError describes that partial result.
  readonly previewFilePath?: string
  readonly previewFileSize?: number
  readonly previewError?: string
}

export interface FrameStorageSaveInput {
  readonly capturedAt: string
  readonly durationSec: number
  readonly data: Uint8Array
  // Target short designation (e.g. "M31") used to organize frames under a
  // date/target/lights tree. Omit when no target is selected; frames then
  // land in an "untargeted" bucket.
  readonly targetShort?: string
  readonly frameKind?: 'light' | 'dark'
  // Parsed frame descriptor used to serialise the pixels as a FITS primary
  // HDU. When the element type or rank cannot be represented safely the save
  // fails honestly instead of writing a misleading file.
  readonly frame: FrameDescriptor
}

export interface FrameStorage {
  readonly preflightExternalFrameStorage: (frameCount?: number) => Effect.Effect<void, unknown>
  // Persists an external frame as a FITS primary HDU under
  // userData/library/external-frames/<date>/<target>/lights/ with a
  // deterministic, readable filename. Returns the absolute path and byte
  // size so the capture workflow can thread them into a LibraryAsset.
  readonly saveExternalFrame: (
    input: FrameStorageSaveInput,
  ) => Effect.Effect<SavedFrame, unknown>
}

// A full-resolution frame from the known camera is about 46 MiB. Require
// 512 MiB rather than trying to reserve an exact future frame count.
const KNOWN_EXTERNAL_FRAME_BYTES = 50 * 1024 * 1024
const MINIMUM_EXTERNAL_FRAME_FREE_BYTES = 512 * 1024 * 1024

export const FrameStorage =
  Context.Service<FrameStorage>('FrameStorage')

// Root for externally retrieved frames, organized as <date>/<target>/lights/
// under app-owned userData storage. Exported so the IPC layer can validate
// renderer-supplied saved asset paths against the same root without duplicating
// the path layout.
export function resolveExternalFramesRoot(): string {
  return path.join(app.getPath('userData'), 'library', 'external-frames')
}

// Sanitizes a target designation for filesystem safety and stable naming.
// Non-alphanumeric runs collapse to a single hyphen; case is preserved so the
// directory stays readable (e.g. "M31", "NGC-7000"). Returns "untargeted" when
// the input is empty or sanitizes to nothing.
function sanitizeTargetDir(raw: string | undefined): string {
  if (!raw) return 'untargeted'
  const sanitized = raw.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized || 'untargeted'
}

// Scans a frame directory for existing sequence numbers and returns the
// next zero-padded 4-digit index. Starts at 0001 for a new/empty folder.
export async function resolveNextSequence(dir: string, frameKind: 'light' | 'dark'): Promise<string> {
  let max = 0
  try {
    const entries = await fs.readdir(dir)
    for (const entry of entries) {
      const match = entry.match(new RegExp(`_${frameKind}_(\\d+)\\.fits$`))
      if (match) {
        const n = Number.parseInt(match[1], 10)
        if (n > max) max = n
      }
    }
  } catch {
    // Directory does not exist yet; start at 0001.
  }
  return (max + 1).toString().padStart(4, '0')
}

async function prepareExternalFramesRoot(): Promise<string> {
  const root = resolveExternalFramesRoot()
  await fs.mkdir(root, { recursive: true })
  return fs.realpath(root)
}

async function preflightExternalFrameStorage(frameCount = 1): Promise<void> {
  const root = await prepareExternalFramesRoot()
  const stats = await fs.statfs(root)
  const freeBytes = stats.bavail * stats.bsize
  const requiredBytes = Math.max(
    MINIMUM_EXTERNAL_FRAME_FREE_BYTES,
    Math.ceil(KNOWN_EXTERNAL_FRAME_BYTES * frameCount * 1.25),
  )
  if (freeBytes < requiredBytes) {
    throw new Error(
        `External frame storage has insufficient free space (${freeBytes} bytes available; requires at least ${requiredBytes} bytes)`,
    )
  }

  const probePath = path.join(root, `.storage-probe-${randomUUID()}`)
  await writeFileExclusive(probePath, new Uint8Array(1))
  await fs.unlink(probePath)
}

export const FrameStorageLive = Layer.succeed(
  FrameStorage,
  {
    preflightExternalFrameStorage: (frameCount) => Effect.tryPromise(() => preflightExternalFrameStorage(frameCount)),
    saveExternalFrame: (input) =>
      Effect.gen(function* () {
        const capturedAt = parseCapturedAt(input.capturedAt)
        if (!capturedAt) {
          return yield* Effect.fail(
            new Error(
              `Invalid capturedAt timestamp: ${input.capturedAt}`,
            ),
          )
        }
        const targetDir = sanitizeTargetDir(input.targetShort)
        const date = capturedAt.date
        const time = capturedAt.time
        // Resolve the root through realpath so the trusted anchor is the true
        // filesystem location. The root may not exist yet on first run; create
        // it before realpath so the anchor is always concrete.
        const realRoot = yield* Effect.tryPromise(prepareExternalFramesRoot)
        const frameKind = input.frameKind ?? 'light'
        const dir = path.join(realRoot, date, targetDir, frameKind === 'dark' ? 'darks' : 'lights')
        const realDir = yield* Effect.tryPromise(() =>
          ensureDirBeneathRoot(dir, realRoot),
        )
        const sequence = yield* Effect.tryPromise(() => resolveNextSequence(realDir, frameKind))
        const dateTime = time ? `${date}-${time}` : date
        const baseName = `${dateTime}_${targetDir.toLowerCase()}_${frameKind}`
        const bytes = yield* writeFits(input.data, input.frame)
        // Atomically and exclusively create the FITS file without following
        // a final symlink, retrying sequence collisions so a predictable name
        // cannot overwrite an existing file.
        const fits = yield* Effect.tryPromise(() =>
          writeFileExclusiveWithSequence(realDir, baseName, '.fits', bytes, Number.parseInt(sequence, 10)),
        )
        const previewPath = fits.absolutePath.replace(/\.fits$/, '.preview.jpg')
        const preview = yield* Effect.tryPromise(async () => {
          const jpg = generatePreviewJpeg(input.data, input.frame)
          if (!jpg) {
            throw new Error('Preview generation is unavailable for this frame layout')
          }
          await writeFileExclusive(previewPath, jpg)
          return { previewFilePath: previewPath, previewFileSize: jpg.byteLength }
        }).pipe(Effect.result)
        return {
          absolutePath: fits.absolutePath,
          fileSize: fits.fileSize,
          previewFilePath: Result.isSuccess(preview)
            ? preview.success.previewFilePath
            : undefined,
          previewFileSize: Result.isSuccess(preview)
            ? preview.success.previewFileSize
            : undefined,
          previewError:
            Result.isFailure(preview)
              ? preview.failure instanceof Error
                ? preview.failure.message
                : String(preview.failure)
              : undefined,
        }
      }),
  } satisfies FrameStorage,
)
