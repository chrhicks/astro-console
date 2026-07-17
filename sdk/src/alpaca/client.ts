import { Effect, Schema } from 'effect'

const COMMAND_TIMEOUT_MS = 15000
const IMAGE_FETCH_TIMEOUT_MS = 60000
const MAX_IMAGE_DOWNLOAD_BYTES = 256 * 1024 * 1024
const ALPACA_CLIENT_ID = 1

export class AlpacaTransportError extends Schema.TaggedErrorClass<AlpacaTransportError>()(
  'AlpacaTransportError',
  { operation: Schema.String, message: Schema.String, cause: Schema.Defect() },
) {}

export class AlpacaProtocolError extends Schema.TaggedErrorClass<AlpacaProtocolError>()(
  'AlpacaProtocolError',
  { operation: Schema.String, message: Schema.String },
) {}

export class AlpacaRejectedError extends Schema.TaggedErrorClass<AlpacaRejectedError>()(
  'AlpacaRejectedError',
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

export type AlpacaError =
  | AlpacaTransportError
  | AlpacaProtocolError
  | AlpacaRejectedError

const AlpacaEnvelope = Schema.Struct({
  Value: Schema.optionalKey(Schema.Unknown),
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})

const AlpacaPutResponse = Schema.Struct({
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})

export class AlpacaClient {
  private readonly baseUrl: string

  constructor(
    host: string,
    port: number,
    private readonly request: typeof fetch = fetch,
  ) {
    this.baseUrl = `http://${host}:${port}`
  }

  get<S extends Schema.ConstraintDecoder<unknown>>(
    path: string,
    value: S,
    signal?: AbortSignal,
  ): Effect.Effect<S['Type'], AlpacaError> {
    const operation = `Alpaca GET ${path}`
    const requestFn = this.request
    const url = `${this.baseUrl}${path}`
    return Effect.fn('AlpacaClient.get')(function* () {
      const response = yield* request(
        requestFn,
        url,
        {},
        operation,
        COMMAND_TIMEOUT_MS,
        signal,
      )
      if (!response.ok) {
        return yield* Effect.fail(
          new AlpacaRejectedError({
            operation,
            message: `${operation} failed: HTTP ${response.status}`,
            status: response.status,
          }),
        )
      }
      const envelope = yield* decode(AlpacaEnvelope, response, operation)
      if (envelope.ErrorNumber !== 0) {
        return yield* Effect.fail(
          new AlpacaRejectedError({
            operation,
            message: `${operation} failed: ${envelope.ErrorMessage ?? `error ${envelope.ErrorNumber}`}`,
          }),
        )
      }
      return yield* decodeValue(value, envelope.Value, operation)
    }).call(this)
  }

  put(
    path: string,
    body: Record<string, string | number | boolean>,
    timeoutMs = COMMAND_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Effect.Effect<void, AlpacaError> {
    const operation = `Alpaca PUT ${path}`
    const requestFn = this.request
    const url = `${this.baseUrl}${path}`
    return Effect.fn('AlpacaClient.put')(function* () {
      const form = new URLSearchParams({ ClientID: String(ALPACA_CLIENT_ID) })
      Object.entries(body).forEach(([key, value]) =>
        form.set(key, String(value)),
      )
      const response = yield* request(
        requestFn,
        url,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        },
        operation,
        timeoutMs,
        signal,
      )
      if (!response.ok) {
        return yield* Effect.fail(
          new AlpacaRejectedError({
            operation,
            message: `${operation} failed: HTTP ${response.status}`,
            status: response.status,
          }),
        )
      }
      const result = yield* decode(AlpacaPutResponse, response, operation)
      if (result.ErrorNumber !== 0) {
        return yield* Effect.fail(
          new AlpacaRejectedError({
            operation,
            message: `${operation} failed: ${result.ErrorMessage ?? `error ${result.ErrorNumber}`}`,
          }),
        )
      }
    }).call(this)
  }

  getImageBytes(
    path: string,
    signal?: AbortSignal,
  ): Effect.Effect<Uint8Array, AlpacaError> {
    const operation = `Alpaca GET ${path}`
    const requestFn = this.request
    const url = `${this.baseUrl}${path}`
    return Effect.fn('AlpacaClient.getImageBytes')(function* () {
      const response = yield* request(
        requestFn,
        url,
        { headers: { Accept: 'application/imagebytes' } },
        operation,
        IMAGE_FETCH_TIMEOUT_MS,
        signal,
      )
      if (!response.ok) {
        return yield* Effect.fail(
          new AlpacaRejectedError({
            operation,
            message: `${operation} failed: HTTP ${response.status}`,
            status: response.status,
          }),
        )
      }
      const contentLength = response.headers.get('content-length')
      if (contentLength && Number(contentLength) > MAX_IMAGE_DOWNLOAD_BYTES) {
        return yield* Effect.fail(
          new AlpacaProtocolError({
            operation,
            message: `${operation} exceeded max download size: ${contentLength} bytes`,
          }),
        )
      }
      if (!response.body) {
        return yield* Effect.fail(
          new AlpacaProtocolError({
            operation,
            message: `${operation} returned no response body`,
          }),
        )
      }
      const reader = response.body.getReader()
      return yield* Effect.acquireUseRelease(
        Effect.succeed(reader),
        () =>
          Effect.gen(function* () {
            const chunks: Uint8Array[] = []
            let total = 0
            while (true) {
              const chunk = yield* Effect.tryPromise({
                try: () => reader.read(),
                catch: (cause) =>
                  new AlpacaTransportError({
                    operation,
                    message: `${operation} failed while reading response: ${errorMessage(cause)}`,
                    cause,
                  }),
              })
              if (chunk.done) break
              if (!chunk.value) continue
              total += chunk.value.byteLength
              if (total > MAX_IMAGE_DOWNLOAD_BYTES) {
                yield* Effect.tryPromise({
                  try: () => reader.cancel(),
                  catch: () =>
                    new AlpacaProtocolError({
                      operation,
                      message: `${operation} exceeded max download size: ${total} bytes`,
                    }),
                }).pipe(Effect.ignore)
                return yield* Effect.fail(
                  new AlpacaProtocolError({
                    operation,
                    message: `${operation} exceeded max download size: ${total} bytes`,
                  }),
                )
              }
              chunks.push(chunk.value)
            }
            const data = new Uint8Array(total)
            let offset = 0
            chunks.forEach((chunk) => {
              data.set(chunk, offset)
              offset += chunk.byteLength
            })
            return data
          }),
        () => Effect.sync(() => reader.releaseLock()).pipe(Effect.ignore),
      )
    })()
  }

  getPromise<S extends Schema.ConstraintDecoder<unknown>>(
    path: string,
    value: S,
    signal?: AbortSignal,
  ): Promise<S['Type']> {
    return Effect.runPromise(this.get(path, value, signal))
  }

  putPromise(
    path: string,
    body: Record<string, string | number | boolean>,
    timeoutMs = COMMAND_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<void> {
    return Effect.runPromise(this.put(path, body, timeoutMs, signal))
  }

  getImageBytesPromise(
    path: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    return Effect.runPromise(this.getImageBytes(path, signal))
  }
}

function request(
  fetch: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  operation: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Effect.Effect<Response, AlpacaTransportError> {
  return Effect.tryPromise({
    try: (effectSignal) =>
      fetch(input, {
        ...init,
        signal: combineSignal(effectSignal, signal, timeoutMs),
      }),
    catch: (cause) =>
      new AlpacaTransportError({
        operation,
        message: `${operation} failed: ${errorMessage(cause)}`,
        cause,
      }),
  })
}

function decode<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  response: Response,
  operation: string,
): Effect.Effect<S['Type'], AlpacaProtocolError> {
  return Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new AlpacaProtocolError({
          operation,
          message: `${operation} returned invalid JSON: ${errorMessage(cause)}`,
        }),
    })
    return yield* decodeValue(schema, body, operation)
  })
}

function decodeValue<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
  operation: string,
): Effect.Effect<S['Type'], AlpacaProtocolError> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (cause) =>
        new AlpacaProtocolError({
          operation,
          message: `${operation} returned an invalid payload: ${errorMessage(cause)}`,
        }),
    ),
  )
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

function combineSignal(
  effectSignal: AbortSignal,
  signal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal
    ? AbortSignal.any([effectSignal, signal, timeout])
    : AbortSignal.any([effectSignal, timeout])
}
