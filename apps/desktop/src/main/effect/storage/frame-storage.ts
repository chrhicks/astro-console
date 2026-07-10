import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Context, Effect, Layer } from 'effect'

import { generatePreviewJpeg } from './frame-preview'

export interface SavedFrame {
  readonly absolutePath: string
  readonly fileSize: number
  // Sibling JPG preview written alongside the FITS file. Absent when preview
  // generation failed; the FITS file still exists in that case.
  readonly previewFilePath?: string
  readonly previewFileSize?: number
}

// Parsed frame geometry and numeric element type needed to write a faithful
// FITS primary HDU. `width`/`height` are the ASCOM NumX/NumY dimensions;
// `rank` is 2 for mono/Bayer and 3 for colour; `planes` is the colour-plane
// count (Dimension3) for rank 3; `elementType` is the numeric type actually
// used for the serialized pixel buffer.
export interface FrameDescriptor {
  readonly width: number
  readonly height: number
  readonly rank: number
  readonly planes?: number
  readonly elementType: number
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
        const targetDir = sanitizeTargetDir(input.targetShort)
        const date = input.capturedAt.slice(0, 10) || 'unknown-date'
        const time = input.capturedAt.slice(11, 19).replace(/:/g, '')
        const dir = path.join(
          resolveExternalFramesRoot(),
          date,
          targetDir,
          'lights',
        )
        yield* Effect.tryPromise(() => fs.mkdir(dir, { recursive: true }))
        const sequence = yield* Effect.tryPromise(() => resolveNextSequence(dir))
        const dateTime = time ? `${date}-${time}` : date
        const fileName =
          `${dateTime}_${targetDir.toLowerCase()}_light_${sequence}.fits`
        const absolutePath = path.join(dir, fileName)
        const bytes = yield* writeFits(input.data, input.frame)
        yield* Effect.tryPromise(() => fs.writeFile(absolutePath, bytes))
        const previewPath = absolutePath.replace(/\.fits$/, '.preview.jpg')
        const preview = yield* Effect.tryPromise(async () => {
          const jpg = generatePreviewJpeg(input.data, input.frame)
          if (!jpg) return null
          await fs.writeFile(previewPath, jpg)
          return { previewFilePath: previewPath, previewFileSize: jpg.byteLength }
        }).pipe(
          // Best-effort: preview failure must not invalidate the saved FITS.
          Effect.catchAll(() => Effect.succeed(null)),
        )
        return {
          absolutePath,
          fileSize: bytes.byteLength,
          previewFilePath: preview?.previewFilePath,
          previewFileSize: preview?.previewFileSize,
        }
      }),
  } satisfies FrameStorage,
)

// Serialises an Alpaca ImageBytes frame as a FITS primary HDU. The pixel
// bytes are kept in ASCOM row-major order (last declared dimension fastest)
// and the FITS axes are labelled so NAXIS1 is that fastest axis, which
// preserves the byte stream without reordering. Multi-byte elements are
// byte-swapped to the big-endian representation FITS requires. Fails with a
// clear error when the element type or rank cannot be represented as a
// faithful FITS primary HDU.
function writeFits(
  data: Uint8Array,
  frame: FrameDescriptor,
): Effect.Effect<Uint8Array, Error> {
  const type = resolveFitsType(frame.elementType)
  if (!type) {
    return Effect.fail(
      new Error(
        `Unsupported Alpaca transmission element type ${frame.elementType} for FITS export`,
      ),
    )
  }
  if (frame.rank !== 2 && frame.rank !== 3) {
    return Effect.fail(
      new Error(`Unsupported image rank ${frame.rank} for FITS export`),
    )
  }
  const planes = frame.rank === 3 ? frame.planes ?? 0 : 1
  if (frame.rank === 3 && planes <= 0) {
    return Effect.fail(new Error('Color frame is missing colour plane count'))
  }
  if (frame.width <= 0 || frame.height <= 0) {
    return Effect.fail(new Error('Frame dimensions must be positive'))
  }
  const expectedBytes = type.bytesPerElement * frame.width * frame.height * planes
  if (data.length !== expectedBytes) {
    return Effect.fail(
      new Error(
        `Frame data length ${data.length} does not match expected ${expectedBytes} bytes`,
      ),
    )
  }

  // NAXIS1 is the fastest-varying axis in FITS. ASCOM serialises the image
  // array with the last declared dimension fastest, so map height (rank 2)
  // or colour planes (rank 3) onto NAXIS1 to preserve the byte order.
  const cards: Array<[string, number | boolean]> = [
    ['SIMPLE', true],
    ['BITPIX', type.bitpix],
    ['NAXIS', frame.rank],
  ]
  if (frame.rank === 2) {
    cards.push(['NAXIS1', frame.height], ['NAXIS2', frame.width])
  } else {
    cards.push(
      ['NAXIS1', planes],
      ['NAXIS2', frame.height],
      ['NAXIS3', frame.width],
    )
  }
  if (type.bzero !== undefined) {
    cards.push(['BZERO', type.bzero], ['BSCALE', 1])
  }
  cards.push(['EXTEND', true])

  const header = buildFitsHeader(cards)
  const pixels = toBigEndian(data, type.bytesPerElement)
  const dataBlock = padToBlock(pixels)
  return Effect.succeed(Buffer.concat([header, dataBlock]))
}

interface FitsType {
  readonly bitpix: number
  readonly bytesPerElement: number
  readonly bzero?: number
}

// ASCOM Alpaca ImageBytes transmission element-type codes mapped to a FITS
// primary HDU representation. Unsigned 16/32-bit values use BZERO scaling per
// the FITS convention so the stored signed integers reconstruct the unsigned
// pixels.
function resolveFitsType(elementType: number): FitsType | null {
  switch (elementType) {
    case 1: return { bitpix: 16, bytesPerElement: 2 } // Int16
    case 2: return { bitpix: 32, bytesPerElement: 4 } // Int32
    case 3: return { bitpix: -64, bytesPerElement: 8 } // Double (Float64)
    case 4: return { bitpix: -32, bytesPerElement: 4 } // Single (Float32)
    case 6: return { bitpix: 8, bytesPerElement: 1 } // Byte
    case 7: return { bitpix: 64, bytesPerElement: 8 } // Int64
    case 8: return { bitpix: 16, bytesPerElement: 2, bzero: 32768 } // UInt16
    case 9: return { bitpix: 32, bytesPerElement: 4, bzero: 2147483648 } // UInt32
    default: return null
  }
}

function buildFitsHeader(
  cards: Array<[string, number | boolean]>,
): Buffer {
  const lines: string[] = []
  for (const [keyword, value] of cards) {
    lines.push(fitsCard(keyword, value))
  }
  lines.push('END'.padEnd(80))
  let header = lines.join('')
  const blockSize = 2880
  const pad = (blockSize - (header.length % blockSize)) % blockSize
  if (pad > 0) header += ' '.repeat(pad)
  return Buffer.from(header, 'ascii')
}

function fitsCard(keyword: string, value: number | boolean): string {
  const key = keyword.padEnd(8).slice(0, 8)
  const valueField =
    typeof value === 'boolean'
      ? (value ? 'T' : 'F').padStart(20)
      : String(value).padStart(20)
  return `${key}= ${valueField}`.padEnd(80)
}

function toBigEndian(data: Uint8Array, bytesPerElement: number): Uint8Array {
  if (bytesPerElement === 1) return data
  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i += bytesPerElement) {
    for (let j = 0; j < bytesPerElement; j++) {
      out[i + j] = data[i + bytesPerElement - 1 - j]
    }
  }
  return out
}

function padToBlock(data: Uint8Array): Uint8Array {
  const blockSize = 2880
  const pad = (blockSize - (data.length % blockSize)) % blockSize
  if (pad === 0) return data
  return Buffer.concat([data, Buffer.alloc(pad, 0)])
}
