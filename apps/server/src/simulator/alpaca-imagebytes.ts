const fitsCardBytes = 80
const fitsBlockBytes = 2880
const imageBytesMetadataBytes = 44

export type FitsImageFacts = {
  readonly width: number
  readonly height: number
  readonly bitpix: 16
  readonly dataStart: number
  readonly bscale: number
  readonly bzero: number
}

export type ImageBytesFacts = {
  readonly metadataVersion: number
  readonly errorNumber: number
  readonly clientTransactionId: number
  readonly serverTransactionId: number
  readonly dataStart: number
  readonly imageElementType: number
  readonly transmissionElementType: number
  readonly rank: number
  readonly dimension1: number
  readonly dimension2: number
  readonly dimension3: number
}

/**
 * Converts a two-dimensional 16-bit FITS primary image to ASCOM Alpaca
 * ImageBytes metadata version 1. ImageArray exposes Int32 source elements and
 * transmits lossless UInt16 values.
 */
export function fitsToAlpacaImageBytes(
  fits: Uint8Array,
  transaction: {
    readonly clientTransactionId?: number
    readonly serverTransactionId?: number
  } = {},
) {
  const facts = readFitsImageFacts(fits)
  const pixelCount = facts.width * facts.height
  const output = new Uint8Array(imageBytesMetadataBytes + pixelCount * 2)
  const view = new DataView(output.buffer)
  const metadata: ImageBytesFacts = {
    metadataVersion: 1,
    errorNumber: 0,
    clientTransactionId: transaction.clientTransactionId ?? 0,
    serverTransactionId: transaction.serverTransactionId ?? 0,
    dataStart: imageBytesMetadataBytes,
    imageElementType: 2,
    transmissionElementType: 8,
    rank: 2,
    dimension1: facts.width,
    dimension2: facts.height,
    dimension3: 0,
  }
  const metadataValues = [
    metadata.metadataVersion,
    metadata.errorNumber,
    metadata.clientTransactionId,
    metadata.serverTransactionId,
    metadata.dataStart,
    metadata.imageElementType,
    metadata.transmissionElementType,
    metadata.rank,
    metadata.dimension1,
    metadata.dimension2,
    metadata.dimension3,
  ]
  metadataValues.forEach((value, index) =>
    view.setUint32(index * 4, value, true),
  )

  const fitsView = new DataView(fits.buffer, fits.byteOffset, fits.byteLength)
  for (let x = 0; x < facts.width; x += 1)
    for (let y = 0; y < facts.height; y += 1) {
      const fitsPixel = y * facts.width + x
      const raw = fitsView.getInt16(facts.dataStart + fitsPixel * 2, false)
      const value = raw * facts.bscale + facts.bzero
      if (!Number.isInteger(value) || value < 0 || value > 65_535)
        throw new Error(
          'The FITS pixel range cannot be represented as Alpaca UInt16 ImageBytes.',
        )
      const alpacaPixel = x * facts.height + y
      view.setUint16(imageBytesMetadataBytes + alpacaPixel * 2, value, true)
    }
  return { bytes: output, fits: facts, metadata }
}

export function readFitsImageFacts(fits: Uint8Array): FitsImageFacts {
  const values = new Map<string, string>()
  const decoder = new TextDecoder('ascii')
  let endOffset: number | undefined
  for (
    let offset = 0;
    offset + fitsCardBytes <= fits.byteLength;
    offset += 80
  ) {
    const card = decoder.decode(fits.subarray(offset, offset + fitsCardBytes))
    const key = card.slice(0, 8).trim()
    if (key === 'END') {
      endOffset = offset + fitsCardBytes
      break
    }
    if (card[8] === '=')
      values.set(key, card.slice(10).split('/')[0]?.trim() ?? '')
  }
  if (endOffset === undefined)
    throw new Error('The FITS primary header has no END card.')
  const bitpix = integer(values, 'BITPIX')
  const axes = integer(values, 'NAXIS')
  const width = integer(values, 'NAXIS1')
  const height = integer(values, 'NAXIS2')
  if (bitpix !== 16)
    throw new Error(
      `The simulator supports 16-bit FITS input, received BITPIX ${bitpix}.`,
    )
  if (axes !== 2)
    throw new Error(
      `The simulator supports two-dimensional FITS input, received NAXIS ${axes}.`,
    )
  if (width <= 0 || height <= 0)
    throw new Error('The FITS image dimensions must be positive.')
  const dataStart = Math.ceil(endOffset / fitsBlockBytes) * fitsBlockBytes
  const requiredBytes = dataStart + width * height * 2
  if (requiredBytes > fits.byteLength)
    throw new Error('The FITS primary image data is truncated.')
  return {
    width,
    height,
    bitpix: 16,
    dataStart,
    bscale: optionalNumber(values, 'BSCALE', 1),
    bzero: optionalNumber(values, 'BZERO', 0),
  }
}

export function readAlpacaImageBytesMetadata(
  bytes: Uint8Array,
): ImageBytesFacts {
  if (bytes.byteLength < imageBytesMetadataBytes)
    throw new Error(
      'The Alpaca ImageBytes response is shorter than metadata version 1.',
    )
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values = Array.from({ length: 11 }, (_, index) =>
    view.getUint32(index * 4, true),
  )
  if (values[0] !== 1)
    throw new Error(`Unsupported ImageBytes metadata version ${values[0]}.`)
  return {
    metadataVersion: 1,
    errorNumber: values[1] ?? 0,
    clientTransactionId: values[2] ?? 0,
    serverTransactionId: values[3] ?? 0,
    dataStart: values[4] ?? 0,
    imageElementType: values[5] ?? 0,
    transmissionElementType: values[6] ?? 0,
    rank: values[7] ?? 0,
    dimension1: values[8] ?? 0,
    dimension2: values[9] ?? 0,
    dimension3: values[10] ?? 0,
  }
}

function integer(values: ReadonlyMap<string, string>, key: string) {
  const value = Number(values.get(key))
  if (!Number.isInteger(value))
    throw new Error(`The FITS ${key} card is invalid.`)
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
    throw new Error(`The FITS ${key} card is invalid.`)
  return value
}
