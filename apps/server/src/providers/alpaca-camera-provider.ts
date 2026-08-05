import { Effect, Schema } from 'effect'
import type { PreflightProviderConfig } from '../config/environment-config.ts'
import type { CameraProviderShape } from '../services/camera-command-service.ts'

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
      command(
        request,
        `${base}/startexposure`,
        new URLSearchParams({
          Duration: String(durationSeconds),
          Light: 'true',
        }),
      ),
    abortExposure: () => command(request, `${base}/abortexposure`),
    readState: () =>
      read(request, `${base}/camerastate`).pipe(
        Effect.map((value) => ({
          observedAt: new Date().toISOString(),
          cameraState:
            typeof value === 'number' && value >= 0 && value < states.length
              ? states[value]
              : 'unknown',
        })),
      ),
    readImageArray: () => readImageArray(request, `${base}/imagearray`),
  }
}
function command(request: typeof fetch, url: string, body?: URLSearchParams) {
  return Effect.tryPromise({
    try: (signal) =>
      request(url, {
        method: 'PUT',
        signal,
        ...(body === undefined
          ? {}
          : {
              body,
              headers: {
                'content-type':
                  'application/x-www-form-urlencoded;charset=UTF-8',
              },
            }),
      }),
    catch: (cause) => cause,
  }).pipe(Effect.flatMap(decode))
}
function read(request: typeof fetch, url: string) {
  return Effect.tryPromise({
    try: (signal) => request(url, { method: 'GET', signal }),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap(decode),
    Effect.map((envelope) => envelope.Value),
  )
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

function readImageArray(request: typeof fetch, url: string) {
  return Effect.tryPromise({
    try: (signal) =>
      request(url, { headers: { accept: 'application/imagebytes' }, signal }),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((response) => {
      if (!response.ok)
        return decode(response).pipe(Effect.as(undefined as never))
      const contentType =
        response.headers.get('content-type')?.toLowerCase() ?? ''
      if (
        contentType.includes('application/imagebytes') ||
        contentType.includes('application/octet-stream')
      ) {
        const declaredLength = Number(response.headers.get('content-length'))
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > 64 * 1024 * 1024
        )
          return Effect.fail(
            new Error('Alpaca image response is outside the supported size.'),
          )
        return Effect.tryPromise({
          try: () => response.arrayBuffer(),
          catch: (cause) => cause,
        }).pipe(
          Effect.map((buffer) => new Uint8Array(buffer)),
          Effect.flatMap(imageBytes),
        )
      }
      return Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) => cause,
      }).pipe(
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
}

function jsonImageBytes(value: unknown) {
  if (typeof value === 'string')
    return imageBytes(new Uint8Array(Buffer.from(value, 'base64')))
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
    return imageBytes(Uint8Array.from(value))
  return Effect.fail(
    new Error('Alpaca image response has an unsupported JSON representation.'),
  )
}
function imageBytes(
  bytes: Uint8Array,
): Effect.Effect<
  { readonly bytes: Uint8Array; readonly format: 'fits' | 'cameraRaw' },
  Error
> {
  if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024 * 1024)
    return Effect.fail(
      new Error('Alpaca image response is outside the supported size.'),
    )
  const signature = new TextDecoder().decode(bytes.slice(0, 6))
  if (signature === 'SIMPLE')
    return Effect.succeed({ bytes, format: 'fits' as const })
  if (bytes.byteLength < 32)
    return Effect.fail(new Error('Alpaca ImageBytes response is too short.'))
  return Effect.succeed({ bytes, format: 'cameraRaw' as const })
}
