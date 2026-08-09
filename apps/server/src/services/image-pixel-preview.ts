import { deflateSync } from 'node:zlib'

const maxPreviewWidth = 256
const maxPreviewHeight = 192
const imageBytesHeaderSize = 44

export type PixelPreview = {
  readonly png: Uint8Array
  readonly width: number
  readonly height: number
  readonly clippingPercent: number
  readonly sharpness: number
  readonly shape: number
}

export function createPixelPreview(
  bytes: Uint8Array,
  format: 'cameraRaw' | 'fits' | 'tiff',
): PixelPreview {
  const image =
    format === 'fits'
      ? decodeFitsPixels(bytes)
      : format === 'cameraRaw'
        ? decodeImageBytesPixels(bytes)
        : unsupported('TIFF preview decoding is not available.')
  const scale = Math.max(
    1,
    Math.ceil(image.width / maxPreviewWidth),
    Math.ceil(image.height / maxPreviewHeight),
  )
  const width = Math.ceil(image.width / scale)
  const height = Math.ceil(image.height / scale)
  const sampled = new Uint16Array(width * height)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      sampled[y * width + x] = image.pixel(
        Math.min(image.width - 1, x * scale),
        Math.min(image.height - 1, y * scale),
      )

  const ordered = Array.from(sampled).sort((left, right) => left - right)
  const low = percentile(ordered, 0.01)
  const high = Math.max(low + 1, percentile(ordered, 0.995))
  const grayscale = new Uint8Array(sampled.length)
  let clipped = 0
  let neighborDifference = 0
  let neighborCount = 0
  let total = 0
  let totalSquared = 0
  sampled.forEach((value, index) => {
    if (value <= low || value >= high) clipped += 1
    const normalized = Math.max(
      0,
      Math.min(255, Math.round(((value - low) / (high - low)) * 255)),
    )
    grayscale[index] = normalized
    total += normalized
    totalSquared += normalized * normalized
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) {
      neighborDifference += Math.abs(normalized - (grayscale[index - 1] ?? 0))
      neighborCount += 1
    }
    if (y > 0) {
      neighborDifference += Math.abs(
        normalized - (grayscale[index - width] ?? 0),
      )
      neighborCount += 1
    }
  })
  const mean = total / Math.max(1, grayscale.length)
  const deviation = Math.sqrt(
    Math.max(0, totalSquared / Math.max(1, grayscale.length) - mean * mean),
  )
  return {
    png: encodeGrayscalePng(grayscale, width, height),
    width,
    height,
    clippingPercent: Math.round((clipped / Math.max(1, sampled.length)) * 100),
    sharpness: Math.round(neighborDifference / Math.max(1, neighborCount)),
    shape: Math.round(deviation),
  }
}

function decodeFitsPixels(bytes: Uint8Array) {
  const values = new Map<string, string>()
  const decoder = new TextDecoder('ascii')
  let endOffset: number | undefined
  for (let offset = 0; offset + 80 <= bytes.byteLength; offset += 80) {
    const card = decoder.decode(bytes.subarray(offset, offset + 80))
    const key = card.slice(0, 8).trim()
    if (key === 'END') {
      endOffset = offset + 80
      break
    }
    if (card[8] === '=')
      values.set(key, card.slice(10).split('/')[0]?.trim() ?? '')
  }
  if (endOffset === undefined)
    return unsupported('The FITS header has no END card.')
  const bitpix = integer(values, 'BITPIX')
  const rank = integer(values, 'NAXIS')
  const width = integer(values, 'NAXIS1')
  const height = integer(values, 'NAXIS2')
  if (bitpix !== 16 || rank !== 2 || width <= 0 || height <= 0)
    return unsupported(
      'Only two-dimensional 16-bit FITS previews are supported.',
    )
  const dataStart = Math.ceil(endOffset / 2880) * 2880
  if (dataStart + width * height * 2 > bytes.byteLength)
    return unsupported('The FITS pixel data is truncated.')
  const bscale = optionalNumber(values, 'BSCALE', 1)
  const bzero = optionalNumber(values, 'BZERO', 0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    width,
    height,
    pixel: (x: number, y: number) =>
      clampUint16(
        view.getInt16(dataStart + (y * width + x) * 2, false) * bscale + bzero,
      ),
  }
}

function decodeImageBytesPixels(bytes: Uint8Array) {
  if (bytes.byteLength < imageBytesHeaderSize)
    return unsupported('The Alpaca ImageBytes metadata is truncated.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(0, true)
  const errorNumber = view.getUint32(4, true)
  const dataStart = view.getUint32(16, true)
  const transmissionElementType = view.getUint32(24, true)
  const rank = view.getUint32(28, true)
  const width = view.getUint32(32, true)
  const height = view.getUint32(36, true)
  if (version !== 1 || errorNumber !== 0)
    return unsupported(
      'The Alpaca ImageBytes metadata is not successful version 1.',
    )
  if (
    transmissionElementType !== 8 ||
    rank !== 2 ||
    width <= 0 ||
    height <= 0 ||
    dataStart < imageBytesHeaderSize ||
    dataStart + width * height * 2 > bytes.byteLength
  )
    return unsupported('The Alpaca ImageBytes pixel layout is unsupported.')
  return {
    width,
    height,
    pixel: (x: number, y: number) =>
      view.getUint16(dataStart + (x * height + y) * 2, true),
  }
}

function encodeGrayscalePng(pixels: Uint8Array, width: number, height: number) {
  const scanlines = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1)
    scanlines[row] = 0
    scanlines.set(pixels.subarray(y * width, (y + 1) * width), row + 1)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', dimensions(width, height)),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function dimensions(width: number, height: number) {
  const result = Buffer.alloc(13)
  result.writeUInt32BE(width, 0)
  result.writeUInt32BE(height, 4)
  result[8] = 8
  result[9] = 0
  return result
}

function pngChunk(type: string, data: Uint8Array) {
  const name = Buffer.from(type, 'ascii')
  const result = Buffer.alloc(12 + data.byteLength)
  result.writeUInt32BE(data.byteLength, 0)
  name.copy(result, 4)
  Buffer.from(data).copy(result, 8)
  result.writeUInt32BE(
    crc32(Buffer.concat([name, Buffer.from(data)])),
    8 + data.byteLength,
  )
  return result
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function percentile(values: ReadonlyArray<number>, fraction: number) {
  return (
    values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ??
    0
  )
}

function integer(values: ReadonlyMap<string, string>, key: string) {
  const value = Number(values.get(key))
  if (!Number.isInteger(value))
    return unsupported(`The FITS ${key} card is invalid.`)
  return value
}

function optionalNumber(
  values: ReadonlyMap<string, string>,
  key: string,
  fallback: number,
) {
  const encoded = values.get(key)
  if (encoded === undefined) return fallback
  const value = Number(encoded.replace(/[dD]/g, 'E'))
  if (!Number.isFinite(value))
    return unsupported(`The FITS ${key} card is invalid.`)
  return value
}

function clampUint16(value: number) {
  return Math.max(0, Math.min(65_535, Math.round(value)))
}

function unsupported(message: string): never {
  throw new Error(message)
}
