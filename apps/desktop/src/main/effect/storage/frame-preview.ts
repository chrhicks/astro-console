import { nativeImage } from 'electron'
import { crc32, deflateSync } from 'node:zlib'
import type { FrameDescriptor } from './frame-storage'

const PREVIEW_MAX_EDGE = 1600
const PREVIEW_JPEG_QUALITY = 85
// Stride-sampling target so the intermediate PNG stays bounded before
// nativeImage downscales to PREVIEW_MAX_EDGE.
const PREVIEW_SAMPLE_TARGET = 2400
const HISTOGRAM_BINS = 512
const LOW_PERCENTILE = 0.005
const HIGH_PERCENTILE = 0.995

// Generates a JPEG preview buffer from raw Alpaca frame data with a percentile
// stretch suitable for dark astro frames. Returns null for unsupported layouts.
// Best-effort: callers treat null as "no preview" and continue without failing.
export function generatePreviewJpeg(
  data: Uint8Array,
  frame: FrameDescriptor,
): Buffer | null {
  const rgba = frameToRgba(data, frame)
  if (!rgba) return null
  const png = encodeRgbaPng(rgba.buffer, rgba.width, rgba.height)
  const img = nativeImage.createFromBuffer(png)
  const size = img.getSize()
  const scale = PREVIEW_MAX_EDGE / Math.max(size.width, size.height)
  const resized = scale < 1
    ? img.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'good',
      })
    : img
  return resized.toJPEG(PREVIEW_JPEG_QUALITY)
}

interface PreviewType {
  bytesPerElement: number
  read: (view: DataView, offset: number) => number
}

// ASCOM Alpaca transmission element-type codes mapped to little-endian readers.
// Int64/UInt64 are omitted; they are rare for astro cameras and the preview is
// best-effort. The raw data is already in its native unsigned/signed form, so
// no FITS BZERO scaling is needed here.
function resolvePreviewType(elementType: number): PreviewType | null {
  switch (elementType) {
    case 1: return { bytesPerElement: 2, read: (v, o) => v.getInt16(o, true) }
    case 2: return { bytesPerElement: 4, read: (v, o) => v.getInt32(o, true) }
    case 3: return { bytesPerElement: 8, read: (v, o) => v.getFloat64(o, true) }
    case 4: return { bytesPerElement: 4, read: (v, o) => v.getFloat32(o, true) }
    case 6: return { bytesPerElement: 1, read: (v, o) => v.getUint8(o) }
    case 8: return { bytesPerElement: 2, read: (v, o) => v.getUint16(o, true) }
    case 9: return { bytesPerElement: 4, read: (v, o) => v.getUint32(o, true) }
    default: return null
  }
}

// Converts raw Alpaca frame data to an 8-bit RGBA bitmap with a percentile
// stretch. Stride-samples to bound memory before nativeImage downscales to
// PREVIEW_MAX_EDGE. ASCOM row-major order has the last declared dimension
// fastest (height for rank 2, colour plane for rank 3).
function frameToRgba(data: Uint8Array, frame: FrameDescriptor): {
  width: number
  height: number
  buffer: Buffer
} | null {
  if (frame.rank !== 2 && frame.rank !== 3) return null
  const planes = frame.rank === 3 ? frame.planes ?? 0 : 1
  if (frame.rank === 3 && planes <= 0) return null
  if (frame.width <= 0 || frame.height <= 0) return null

  const type = resolvePreviewType(frame.elementType)
  if (!type) return null

  const expectedBytes = type.bytesPerElement * frame.width * frame.height * planes
  if (data.length !== expectedBytes) return null

  const stride = Math.max(
    1,
    Math.ceil(Math.max(frame.width, frame.height) / PREVIEW_SAMPLE_TARGET),
  )
  const outWidth = Math.ceil(frame.width / stride)
  const outHeight = Math.ceil(frame.height / stride)

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const samples = new Float64Array(outWidth * outHeight * planes)
  let min = Infinity
  let max = -Infinity
  let s = 0
  for (let y = 0; y < frame.height; y += stride) {
    for (let x = 0; x < frame.width; x += stride) {
      for (let p = 0; p < planes; p++) {
        const index = (x * frame.height + y) * planes + p
        const value = type.read(view, index * type.bytesPerElement)
        samples[s++] = value
        if (value < min) min = value
        if (value > max) max = value
      }
    }
  }

  const { low, high } = percentileClip(samples, min, max)
  const range = high > low ? high - low : 1
  const buffer = Buffer.alloc(outWidth * outHeight * 4)
  for (let i = 0; i < outWidth * outHeight; i++) {
    if (planes === 1) {
      const g = clampByte((samples[i] - low) / range)
      buffer[i * 4] = g
      buffer[i * 4 + 1] = g
      buffer[i * 4 + 2] = g
    } else {
      buffer[i * 4] = clampByte((samples[i * 3] - low) / range)
      buffer[i * 4 + 1] = clampByte((samples[i * 3 + 1] - low) / range)
      buffer[i * 4 + 2] = clampByte((samples[i * 3 + 2] - low) / range)
    }
    buffer[i * 4 + 3] = 255
  }

  return { width: outWidth, height: outHeight, buffer }
}

// Percentile clip using a coarse histogram. Finds the 0.5th and 99.5th
// percentile values so hot/cold pixels do not compress the stretch range.
function percentileClip(samples: Float64Array, min: number, max: number): {
  low: number
  high: number
} {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { low: 0, high: 1 }
  }
  const bins = new Uint32Array(HISTOGRAM_BINS)
  const inv = (HISTOGRAM_BINS - 1) / (max - min)
  for (let i = 0; i < samples.length; i++) {
    const b = Math.min(
      HISTOGRAM_BINS - 1,
      Math.max(0, Math.floor((samples[i] - min) * inv)),
    )
    bins[b]++
  }
  const step = (max - min) / (HISTOGRAM_BINS - 1)
  const lowThreshold = samples.length * LOW_PERCENTILE
  const highThreshold = samples.length * HIGH_PERCENTILE
  let cumulative = 0
  let low = min
  let high = max
  let lowFound = false
  for (let b = 0; b < HISTOGRAM_BINS; b++) {
    cumulative += bins[b]
    if (!lowFound && cumulative >= lowThreshold) {
      low = min + b * step
      lowFound = true
    }
    if (cumulative >= highThreshold) {
      high = min + b * step
      break
    }
  }
  if (high <= low) return { low: min, high: max }
  return { low, high }
}

function clampByte(normalized: number): number {
  const v = Math.round(normalized * 255)
  return v < 0 ? 0 : v > 255 ? 255 : v
}

// Encodes an RGBA buffer as a PNG using only Node zlib, so nativeImage receives
// a platform-independent image buffer for resize/toJPEG.
function encodeRgbaPng(rgba: Buffer, width: number, height: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = pngChunk(
    'IHDR',
    Buffer.concat([
      uint32Be(width),
      uint32Be(height),
      Buffer.from([8, 6, 0, 0, 0]),
    ]),
  )
  const rowSize = width * 4 + 1
  const raw = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0
    rgba.copy(raw, y * rowSize + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = pngChunk('IDAT', deflateSync(raw))
  const iend = pngChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([signature, ihdr, idat, iend])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = uint32Be(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([uint32Be(data.length), typeBuf, data, crc])
}

function uint32Be(value: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(value, 0)
  return buf
}
