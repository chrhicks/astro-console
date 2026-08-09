import { Effect, Schema } from 'effect'
import type { PreflightProviderConfig } from '../config/environment-config.ts'
import type {
  CameraProviderCommandOutcome,
  CameraProviderShape,
} from '../services/camera-command-service.ts'
import {
  alpacaFetch,
  alpacaOperation,
  type AlpacaRequestMetadata,
} from './alpaca-observability.ts'

const Envelope = Schema.Struct({
  Value: Schema.optionalKey(Schema.Unknown),
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})
const states = [
  'idle',
  'waiting',
  'exposing',
  'reading',
  'download',
  'error',
] as const
const maxImageBytes = 64 * 1024 * 1024
const imageBytesHeaderSize = 44

export const alpacaCameraProvider = (
  config: Extract<PreflightProviderConfig, { readonly kind: 'alpaca' }>,
  request: typeof fetch = fetch,
): CameraProviderShape => {
  const device = config.devices.camera
  if (device === undefined)
    throw new Error('Configured Alpaca rig has no camera device.')
  const base = `http://${config.host}:${config.port}/api/v1/camera/${device.deviceNumber}`
  return {
    startExposure: (durationSeconds) =>
      cameraCommand(
        request,
        `${base}/startexposure`,
        {
          method: 'PUT',
          operation: 'camera.start_exposure',
          route: '/api/v1/camera/:deviceNumber/startexposure',
          deviceKind: 'camera',
        },
        new URLSearchParams({
          Duration: String(durationSeconds),
          Light: 'true',
        }),
      ),
    abortExposure: () =>
      cameraCommand(request, `${base}/abortexposure`, {
        method: 'PUT',
        operation: 'camera.abort_exposure',
        route: '/api/v1/camera/:deviceNumber/abortexposure',
        deviceKind: 'camera',
      }),
    readState: () =>
      read(request, `${base}/camerastate`, {
        method: 'GET',
        operation: 'camera.read_state',
        route: '/api/v1/camera/:deviceNumber/camerastate',
        deviceKind: 'camera',
      }).pipe(
        Effect.map((value) => ({
          observedAt: new Date().toISOString(),
          cameraState:
            typeof value === 'number' && value >= 0 && value < states.length
              ? states[value]
              : 'unknown',
        })),
      ),
    readImageArray: () =>
      readImageArray(request, `${base}/imagearray`, {
        method: 'GET',
        operation: 'camera.read_image',
        route: '/api/v1/camera/:deviceNumber/imagearray',
        deviceKind: 'camera',
      }),
  }
}
function cameraCommand(
  request: typeof fetch,
  url: string,
  metadata: AlpacaRequestMetadata,
  body?: URLSearchParams,
): Effect.Effect<CameraProviderCommandOutcome, unknown> {
  const operation = alpacaFetch(
    request,
    url,
    {
      method: 'PUT',
      ...(body === undefined
        ? {}
        : {
            body,
            headers: {
              'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
          }),
    },
    metadata,
  ).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.tryPromise({
            try: () => response.json(),
            catch: (cause) => cause,
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Envelope)),
            Effect.flatMap(commandOutcome),
          )
        : Effect.tryPromise({
            try: () => response.text(),
            catch: (cause) => cause,
          }).pipe(
            Effect.flatMap((text) => {
              try {
                const envelope = Schema.decodeUnknownSync(Envelope)(
                  JSON.parse(text),
                )
                return commandOutcome(envelope)
              } catch {
                return Effect.fail(
                  new Error(
                    `Alpaca camera request failed: ${boundedProviderText(text, response.status)}`,
                  ),
                )
              }
            }),
          ),
    ),
  )
  return alpacaOperation(operation, metadata)
}
function commandOutcome(
  envelope: typeof Envelope.Type,
): Effect.Effect<CameraProviderCommandOutcome, Error> {
  return envelope.ErrorNumber === 0
    ? Effect.succeed({ _tag: 'Acknowledged' })
    : Effect.succeed({
        _tag: 'Rejected',
        summary:
          envelope.ErrorMessage ??
          `Alpaca camera provider error ${envelope.ErrorNumber}.`,
      })
}
function read(
  request: typeof fetch,
  url: string,
  metadata: AlpacaRequestMetadata,
) {
  const operation = alpacaFetch(request, url, { method: 'GET' }, metadata).pipe(
    Effect.flatMap(decode),
    Effect.map((envelope) => envelope.Value),
  )
  return alpacaOperation(operation, metadata)
}
function decode(response: Response) {
  if (!response.ok)
    return Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => cause,
    }).pipe(
      Effect.flatMap((text) =>
        Effect.fail(
          new Error(
            `Alpaca camera request failed: ${boundedProviderText(text, response.status)}`,
          ),
        ),
      ),
    )
  return Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Envelope)),
    Effect.flatMap((envelope) => {
      return envelope.ErrorNumber === 0
        ? Effect.succeed(envelope)
        : Effect.fail(
            new Error(
              envelope.ErrorMessage ??
                `Alpaca camera provider error ${envelope.ErrorNumber}.`,
            ),
          )
    }),
  )
}

function boundedProviderText(text: string, status: number) {
  const trimmed = text.trim().replace(/[\r\n]+/g, ' ')
  if (trimmed.length === 0) return `HTTP ${status}.`
  try {
    const decoded: unknown = JSON.parse(trimmed)
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'ErrorMessage' in decoded &&
      typeof decoded.ErrorMessage === 'string'
    )
      return decoded.ErrorMessage.slice(0, 240)
  } catch {}
  return trimmed.slice(0, 240)
}

function readImageArray(
  request: typeof fetch,
  url: string,
  metadata: AlpacaRequestMetadata,
) {
  const operation = alpacaFetch(
    request,
    url,
    { headers: { accept: 'application/imagebytes' } },
    metadata,
  ).pipe(
    Effect.flatMap((response) => {
      if (!response.ok)
        return Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) => cause,
        }).pipe(
          Effect.flatMap((text) =>
            Effect.fail(
              new Error(
                `Alpaca camera request failed: ${boundedProviderText(text, response.status)}`,
              ),
            ),
          ),
        )
      const contentType =
        response.headers.get('content-type')?.toLowerCase() ?? ''
      if (
        contentType.includes('application/imagebytes') ||
        contentType.includes('application/octet-stream')
      ) {
        const declared = response.headers.get('content-length')
        const declaredLength = declared === null ? undefined : Number(declared)
        if (
          declaredLength !== undefined &&
          (!Number.isSafeInteger(declaredLength) ||
            declaredLength <= 0 ||
            declaredLength > maxImageBytes)
        )
          return Effect.fail(
            new Error('Alpaca image response is outside the supported size.'),
          )
        return readBoundedBytes(response, maxImageBytes).pipe(
          Effect.flatMap((bytes) => imageBytes(bytes, 'imageBytes')),
        )
      }
      if (
        contentType.includes('application/fits') ||
        contentType.includes('image/fits')
      )
        return readBoundedBytes(response, maxImageBytes).pipe(
          Effect.flatMap((bytes) => imageBytes(bytes, 'fits')),
        )
      return readBoundedBytes(response, maxImageBytes).pipe(
        Effect.flatMap((bytes) =>
          Effect.try({
            try: () => {
              const parsed: unknown = JSON.parse(
                new TextDecoder().decode(bytes),
              )
              return parsed
            },
            catch: (cause) => cause,
          }),
        ),
        Effect.flatMap(Schema.decodeUnknownEffect(Envelope)),
        Effect.flatMap((envelope) =>
          envelope.ErrorNumber === 0
            ? jsonImageBytes(envelope.Value)
            : Effect.fail(
                new Error(envelope.ErrorMessage ?? 'Alpaca image read failed.'),
              ),
        ),
      )
    }),
  )
  return alpacaOperation(operation, metadata)
}

function jsonImageBytes(value: unknown) {
  if (typeof value === 'string')
    return imageBytes(
      new Uint8Array(Buffer.from(value, 'base64')),
      'compatibility',
    )
  if (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'number' &&
        Number.isInteger(entry) &&
        entry >= 0 &&
        entry <= 255,
    )
  )
    return imageBytes(Uint8Array.from(value), 'compatibility')
  return Effect.fail(
    new Error('Alpaca image response has an unsupported JSON representation.'),
  )
}
function imageBytes(
  bytes: Uint8Array,
  representation: 'imageBytes' | 'fits' | 'compatibility',
): Effect.Effect<
  { readonly bytes: Uint8Array; readonly format: 'fits' | 'cameraRaw' },
  Error
> {
  if (bytes.byteLength === 0 || bytes.byteLength > maxImageBytes)
    return Effect.fail(
      new Error('Alpaca image response is outside the supported size.'),
    )
  const signature = new TextDecoder().decode(bytes.slice(0, 6))
  if (
    signature === 'SIMPLE' &&
    (representation === 'fits' || representation === 'compatibility')
  )
    return Effect.succeed({ bytes, format: 'fits' as const })
  if (representation === 'fits')
    return Effect.fail(new Error('Alpaca FITS response has no SIMPLE header.'))
  try {
    validateImageBytes(bytes)
  } catch (cause) {
    return Effect.fail(
      cause instanceof Error
        ? cause
        : new Error('Alpaca ImageBytes response is malformed.'),
    )
  }
  return Effect.succeed({ bytes, format: 'cameraRaw' as const })
}

function readBoundedBytes(response: Response, limit: number) {
  return Effect.tryPromise({
    try: async () => {
      const declaredHeader = response.headers.get('content-length')
      const declaredLength =
        declaredHeader === null ? undefined : Number(declaredHeader)
      if (
        declaredLength !== undefined &&
        (!Number.isSafeInteger(declaredLength) ||
          declaredLength <= 0 ||
          declaredLength > limit)
      )
        throw new Error('Alpaca image response is outside the supported size.')
      if (response.body === null) {
        if (declaredLength === undefined)
          throw new Error(
            'An unstreamable Alpaca image response requires a bounded Content-Length.',
          )
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength !== declaredLength || bytes.byteLength > limit)
          throw new Error(
            'Alpaca image response is outside the supported size.',
          )
        return bytes
      }
      const reader = response.body.getReader()
      if (declaredLength !== undefined) {
        const bytes = new Uint8Array(declaredLength)
        let offset = 0
        try {
          for (;;) {
            const next = await reader.read()
            if (next.done) break
            if (offset + next.value.byteLength > bytes.byteLength) {
              await reader.cancel().catch(() => undefined)
              throw new Error(
                'Alpaca image response does not match its Content-Length.',
              )
            }
            bytes.set(next.value, offset)
            offset += next.value.byteLength
          }
        } finally {
          reader.releaseLock()
        }
        if (offset !== bytes.byteLength)
          throw new Error(
            'Alpaca image response does not match its Content-Length.',
          )
        return bytes
      }
      const chunks: Uint8Array[] = []
      let total = 0
      try {
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          total += next.value.byteLength
          if (total > limit) {
            await reader.cancel().catch(() => undefined)
            throw new Error(
              'Alpaca image response is outside the supported size.',
            )
          }
          chunks.push(next.value)
        }
      } finally {
        reader.releaseLock()
      }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return bytes
    },
    catch: (cause) => cause,
  })
}

function validateImageBytes(bytes: Uint8Array) {
  if (bytes.byteLength < imageBytesHeaderSize)
    throw new Error('Alpaca ImageBytes response is too short.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(0, true)
  const errorNumber = view.getUint32(4, true)
  const dataStart = view.getUint32(16, true)
  const imageElementType = view.getUint32(20, true)
  const transmissionElementType = view.getUint32(24, true)
  const rank = view.getUint32(28, true)
  const dimensions = [
    view.getUint32(32, true),
    view.getUint32(36, true),
    view.getUint32(40, true),
  ]
  if (version !== 1)
    throw new Error(`Unsupported Alpaca ImageBytes version ${version}.`)
  if (errorNumber !== 0)
    throw new Error(`Alpaca ImageBytes reported provider error ${errorNumber}.`)
  if (dataStart < imageBytesHeaderSize || dataStart > bytes.byteLength)
    throw new Error('Alpaca ImageBytes data start is invalid.')
  if (rank !== 2 && rank !== 3)
    throw new Error(`Unsupported Alpaca ImageBytes rank ${rank}.`)
  if (
    !Number.isInteger(imageElementType) ||
    imageElementType < 1 ||
    imageElementType > 9
  )
    throw new Error(
      `Unsupported Alpaca ImageBytes image element type ${imageElementType}.`,
    )
  const activeDimensions = dimensions.slice(0, rank)
  if (activeDimensions.some((value) => value === 0))
    throw new Error('Alpaca ImageBytes dimensions must be positive.')
  const elementBytes = transmissionElementBytes(transmissionElementType)
  const pixelCount = activeDimensions.reduce((total, value) => total * value, 1)
  if (!Number.isSafeInteger(pixelCount))
    throw new Error(
      'Alpaca ImageBytes dimensions are outside the supported size.',
    )
  const payloadBytes = pixelCount * elementBytes
  if (
    !Number.isSafeInteger(payloadBytes) ||
    payloadBytes !== bytes.byteLength - dataStart
  )
    throw new Error(
      'Alpaca ImageBytes payload length does not match its metadata.',
    )
}

function transmissionElementBytes(type: number) {
  if (type === 6) return 1
  if (type === 1 || type === 8) return 2
  if (type === 2 || type === 4 || type === 9) return 4
  if (type === 3 || type === 5 || type === 7) return 8
  throw new Error(`Unsupported Alpaca ImageBytes transmission type ${type}.`)
}
