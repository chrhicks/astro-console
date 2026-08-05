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
