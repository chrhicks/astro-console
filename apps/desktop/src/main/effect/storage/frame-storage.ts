import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Context, Effect, Layer } from 'effect'

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
  // Sibling JPG preview written alongside the FITS file. Absent when preview
  // generation failed; the FITS file still exists in that case.
  readonly previewFilePath?: string
  readonly previewFileSize?: number
}

export interface FrameStorageSaveInput {
  readonly capturedAt: string
  readonly durationSec: number
  readonly data: Uint8Array
  // Target short designation (e.g. "M31") used to organize frames under a
  // date/target/lights tree. Omit when no target is selected; frames then
  // land in an "untargeted" bucket.
  readonly targetShort?: string
  // Parsed frame descriptor used to serialise the pixels as a FITS primary
  // HDU. When the element type or rank cannot be represented safely the save
  // fails honestly instead of writing a misleading file.
  readonly frame: FrameDescriptor
}

export interface FrameStorage {
  // Persists an external frame as a FITS primary HDU under
  // userData/library/external-frames/<date>/<target>/lights/ with a
  // deterministic, readable filename. Returns the absolute path and byte
  // size so the capture workflow can thread them into a LibraryAsset.
  readonly saveExternalFrame: (
    input: FrameStorageSaveInput,
  ) => Effect.Effect<SavedFrame, unknown>
}

export const FrameStorage =
  Context.GenericTag<FrameStorage>('FrameStorage')

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

// Scans the lights directory for existing sequence numbers and returns the
// next zero-padded 4-digit index. Starts at 0001 for a new/empty folder.
async function resolveNextSequence(dir: string): Promise<string> {
  let max = 0
  try {
    const entries = await fs.readdir(dir)
    for (const entry of entries) {
      const match = entry.match(/_light_(\d+)\.fits$/)
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

export const FrameStorageLive = Layer.succeed(
  FrameStorage,
  {
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
        const root = resolveExternalFramesRoot()
        // Resolve the root through realpath so the trusted anchor is the true
        // filesystem location. The root may not exist yet on first run; create
        // it before realpath so the anchor is always concrete.
        yield* Effect.tryPromise(() => fs.mkdir(root, { recursive: true }))
        const realRoot = yield* Effect.tryPromise(() => fs.realpath(root))
        const dir = path.join(realRoot, date, targetDir, 'lights')
        const realDir = yield* Effect.tryPromise(() =>
          ensureDirBeneathRoot(dir, realRoot),
        )
        const sequence = yield* Effect.tryPromise(() => resolveNextSequence(realDir))
        const dateTime = time ? `${date}-${time}` : date
        const baseName = `${dateTime}_${targetDir.toLowerCase()}_light`
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
          if (!jpg) return null
          await writeFileExclusive(previewPath, jpg)
          return { previewFilePath: previewPath, previewFileSize: jpg.byteLength }
        }).pipe(
          // Best-effort: preview failure must not invalidate the saved FITS.
          Effect.catchAll(() => Effect.succeed(null)),
        )
        return {
          absolutePath: fits.absolutePath,
          fileSize: fits.fileSize,
          previewFilePath: preview?.previewFilePath,
          previewFileSize: preview?.previewFileSize,
        }
      }),
  } satisfies FrameStorage,
)
