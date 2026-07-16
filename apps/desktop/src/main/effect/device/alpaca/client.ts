import { Schema } from 'effect'

const COMMAND_TIMEOUT_MS = 15000
const IMAGE_FETCH_TIMEOUT_MS = 60000
const MAX_IMAGE_DOWNLOAD_BYTES = 256 * 1024 * 1024
const ALPACA_CLIENT_ID = 1

const AlpacaEnvelope = Schema.Struct({
  Value: Schema.Unknown,
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

  async get<S extends Schema.ConstraintDecoder<unknown>>(
    path: string,
    value: S,
    signal?: AbortSignal,
  ): Promise<S['Type']> {
    const res = await this.request(`${this.baseUrl}${path}`, {
      signal: combineSignal(signal, COMMAND_TIMEOUT_MS),
    })
    if (!res.ok)
      throw new Error(`Alpaca GET ${path} failed: HTTP ${res.status}`)
    const body = Schema.decodeUnknownSync(AlpacaEnvelope)(await res.json())
    if (body.ErrorNumber !== 0) {
      throw new Error(
        `Alpaca GET ${path} failed: ${body.ErrorMessage ?? `error ${body.ErrorNumber}`}`,
      )
    }
    return Schema.decodeUnknownSync(value)(body.Value)
  }

  async put(
    path: string,
    body: Record<string, string | number | boolean>,
    timeoutMs = COMMAND_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<void> {
    const form = new URLSearchParams({ ClientID: String(ALPACA_CLIENT_ID) })
    Object.entries(body).forEach(([key, value]) => form.set(key, String(value)))
    const res = await this.request(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: combineSignal(signal, timeoutMs),
    })
    if (!res.ok)
      throw new Error(`Alpaca PUT ${path} failed: HTTP ${res.status}`)
    const response = Schema.decodeUnknownSync(AlpacaPutResponse)(
      await res.json(),
    )
    if (response.ErrorNumber !== 0) {
      throw new Error(
        `Alpaca PUT ${path} failed: ${response.ErrorMessage ?? `error ${response.ErrorNumber}`}`,
      )
    }
  }

  async getImageBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    const res = await this.request(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/imagebytes' },
      signal: combineSignal(signal, IMAGE_FETCH_TIMEOUT_MS),
    })
    if (!res.ok)
      throw new Error(`Alpaca GET ${path} failed: HTTP ${res.status}`)
    const contentLength = res.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_IMAGE_DOWNLOAD_BYTES) {
      throw new Error(
        `Alpaca GET ${path} exceeded max download size: ${contentLength} bytes`,
      )
    }
    if (!res.body)
      throw new Error(`Alpaca GET ${path} returned no response body`)

    const chunks: Uint8Array[] = []
    let total = 0
    const reader = res.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > MAX_IMAGE_DOWNLOAD_BYTES) {
          await reader.cancel().catch(() => {})
          throw new Error(
            `Alpaca GET ${path} exceeded max download size: ${total} bytes`,
          )
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const data = new Uint8Array(total)
    let offset = 0
    chunks.forEach((chunk) => {
      data.set(chunk, offset)
      offset += chunk.byteLength
    })
    return data
  }
}

function combineSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}
