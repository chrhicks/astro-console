import { Buffer } from 'node:buffer'
import { Effect } from 'effect'

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

interface FitsType {
  readonly bitpix: number
  readonly bytesPerElement: number
  readonly bzero?: number
}

// Upper bound on a single frame's pixel payload. Full-resolution astro
// frames are well under this; values beyond it are treated as corrupt
// geometry so an unsafe integer product or a runaway dimension cannot
// produce a misleading file.
const MAX_PIXEL_BYTES = 256 * 1024 * 1024

// Serialises an Alpaca ImageBytes frame as a FITS primary HDU. The pixel
// bytes are kept in ASCOM row-major order (last declared dimension fastest)
// and the FITS axes are labelled so NAXIS1 is that fastest axis, which
// preserves the byte stream without reordering. Multi-byte elements are
// byte-swapped to the big-endian representation FITS requires. Unsigned
// 16/32-bit types use BZERO scaling: the physical unsigned value x is stored
// as the signed value x-BZERO so a FITS reader reconstructs physical =
// stored + BZERO. Fails with a clear error when the element type or rank
// cannot be represented as a faithful FITS primary HDU.
export function writeFits(
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
  const elements = frame.width * frame.height * planes
  if (!Number.isSafeInteger(elements)) {
    return Effect.fail(new Error('Frame dimensions overflow safe integer range'))
  }
  const expectedBytes = type.bytesPerElement * elements
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > MAX_PIXEL_BYTES) {
    return Effect.fail(new Error('Frame data size exceeds safe bounds'))
  }
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
  const pixels = toBigEndian(data, type.bytesPerElement, type.bzero)
  const dataBlock = padToBlock(pixels)
  return Effect.succeed(Buffer.concat([header, dataBlock]))
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

// Converts little-endian input bytes to the big-endian representation FITS
// requires. For signed and float types this is a pure byte swap. For unsigned
// types with BZERO, the physical unsigned value x is rewritten as the signed
// stored value x-BZERO so a FITS reader reconstructs physical = stored +
// BZERO.
function toBigEndian(
  data: Uint8Array,
  bytesPerElement: number,
  bzero?: number,
): Uint8Array {
  if (bytesPerElement === 1) return data
  const out = Buffer.alloc(data.length)
  if (bzero === undefined) {
    for (let i = 0; i < data.length; i += bytesPerElement) {
      for (let j = 0; j < bytesPerElement; j++) {
        out[i + j] = data[i + bytesPerElement - 1 - j]
      }
    }
    return out
  }
  const inView = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let i = 0; i < data.length; i += bytesPerElement) {
    if (bytesPerElement === 2) {
      out.writeInt16BE(inView.getUint16(i, true) - bzero, i)
    } else {
      out.writeInt32BE(inView.getUint32(i, true) - bzero, i)
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
