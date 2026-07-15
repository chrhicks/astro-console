import type { RigFramePixelFormat, RigFrameResult } from '../../rig/rig-model'

const MAX_IMAGE_PIXEL_BYTES = 256 * 1024 * 1024

export function parseAlpacaImageBytes(data: Uint8Array): RigFrameResult {
  const capturedAt = new Date().toISOString()
  if (data.length < 44) return unknownFrame(data, capturedAt)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const metadataVersion = view.getInt32(0, true)
  const errorNumber = view.getInt32(4, true)
  const dataStart = view.getInt32(16, true)
  const imageElementType = view.getInt32(20, true)
  const transmissionElementType = view.getInt32(24, true)
  const rank = view.getInt32(28, true)
  const width = view.getInt32(32, true)
  const height = view.getInt32(36, true)
  const dimension3 = view.getInt32(40, true)
  if (
    metadataVersion !== 1 ||
    errorNumber !== 0 ||
    (rank !== 2 && rank !== 3) ||
    width <= 0 ||
    height <= 0 ||
    (rank === 3 && dimension3 !== 3) ||
    dataStart < 44 ||
    dataStart > data.length
  )
    return unknownFrame(data, capturedAt)

  const planes = rank === 3 ? dimension3 : 1
  const bytesPerElement = elementSize(transmissionElementType)
  const pixelElements = width * height * planes
  const pixelBytes = bytesPerElement * pixelElements
  if (
    bytesPerElement === 0 ||
    !Number.isSafeInteger(pixelElements) ||
    pixelElements <= 0 ||
    !Number.isSafeInteger(pixelBytes) ||
    pixelBytes > MAX_IMAGE_PIXEL_BYTES ||
    !Number.isSafeInteger(dataStart + pixelBytes) ||
    dataStart + pixelBytes > data.length
  )
    return unknownFrame(data, capturedAt)

  return {
    transfer: 'image-bytes',
    width,
    height,
    pixelFormat: pixelFormat(transmissionElementType, rank),
    data: data.subarray(dataStart, dataStart + pixelBytes),
    imageBytes: {
      imageElementType,
      transmissionElementType,
      rank,
      planes: rank === 3 ? planes : undefined,
    },
    metadata: { capturedAt },
  }
}

function unknownFrame(data: Uint8Array, capturedAt: string): RigFrameResult {
  return {
    transfer: 'image-bytes',
    width: 0,
    height: 0,
    pixelFormat: 'unknown',
    data,
    metadata: { capturedAt },
  }
}

function elementSize(elementType: number): number {
  if (elementType === 1 || elementType === 8) return 2
  if (elementType === 2 || elementType === 4 || elementType === 9) return 4
  if (elementType === 3 || elementType === 5 || elementType === 7) return 8
  return elementType === 6 ? 1 : 0
}

function pixelFormat(elementType: number, rank: number): RigFramePixelFormat {
  if (elementType === 1 || elementType === 8)
    return rank === 3 ? 'rgb48' : 'mono16'
  if (elementType === 6) return rank === 3 ? 'rgb24' : 'mono8'
  return 'unknown'
}
