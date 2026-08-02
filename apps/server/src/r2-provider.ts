import { createHash, createHmac } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { Schema } from 'effect'
import type { PublisherFile, PublisherProvider } from './publisher-worker.ts'
import type { R2PublisherConfig } from './publisher-config.ts'

const Credentials = Schema.Struct({
  accessKeyId: Schema.NonEmptyString,
  secretAccessKey: Schema.NonEmptyString,
})
type Fetcher = (
  input: URL,
  init: RequestInit & { readonly duplex?: 'half' },
) => Promise<Response>

export function createR2Provider(
  config: Pick<
    R2PublisherConfig,
    'accountId' | 'bucket' | 'endpoint' | 'credentialsPath'
  >,
  fetcher: Fetcher = fetch,
  dependencies: {
    readonly fileStream?: (path: string) => Readable
  } = {},
): PublisherProvider {
  let rawCredentials: unknown
  try {
    rawCredentials = JSON.parse(readFileSync(config.credentialsPath, 'utf8'))
  } catch {
    throw new Error('R2 credentials are unreadable')
  }
  if (
    typeof rawCredentials !== 'object' ||
    rawCredentials === null ||
    Object.keys(rawCredentials).sort().join(',') !==
      'accessKeyId,secretAccessKey'
  )
    throw new Error('R2 credentials are invalid')
  let credentials: typeof Credentials.Type
  try {
    credentials = Schema.decodeUnknownSync(Credentials)(rawCredentials)
  } catch {
    throw new Error('R2 credentials are invalid')
  }
  const request = async (
    method: 'PUT' | 'HEAD',
    key: string,
    file?: PublisherFile,
    metadata?: { readonly assetId: string; readonly checksum: string },
  ) => {
    if (
      !/^published\/[A-Za-z0-9._/-]+$/.test(key) ||
      key.includes('//') ||
      key.includes('..')
    )
      throw new Error('R2 object key is outside the publisher prefix')
    if (file !== undefined && metadata?.checksum !== file.checksum)
      throw new Error('publisher file checksum does not match metadata')
    const url = new URL(
      `/${config.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
      config.endpoint,
    )
    const payloadHash =
      file?.checksum ??
      createHash('sha256').update(new Uint8Array()).digest('hex')
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const date = amzDate.slice(0, 8)
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(file === undefined
        ? {}
        : {
            'content-length': String(file.bytes),
            'content-disposition': `attachment; filename="${basename(file.path)}"`,
          }),
      ...(metadata === undefined
        ? {}
        : {
            'x-amz-meta-asset-id': metadata.assetId,
            'x-amz-meta-checksum': metadata.checksum,
          }),
    }
    const signedHeaders = Object.keys(headers).sort()
    const canonicalHeaders = signedHeaders
      .map((name) => `${name}:${headers[name]}\n`)
      .join('')
    const canonicalRequest = `${method}\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders.join(';')}\n${payloadHash}`
    const scope = `${date}/auto/s3/aws4_request`
    const signingKey = hmac(
      hmac(
        hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), 'auto'),
        's3',
      ),
      'aws4_request',
    )
    const signature = createHmac('sha256', signingKey)
      .update(
        `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash('sha256').update(canonicalRequest).digest('hex')}`,
      )
      .digest('hex')
    const authorizedHeaders = {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
    }
    const response = await fetcher(
      url,
      file === undefined
        ? { method, headers: authorizedHeaders }
        : {
            method,
            headers: authorizedHeaders,
            body: fileBody(
              dependencies.fileStream?.(file.path) ??
                createReadStream(file.path, { highWaterMark: 64 * 1024 }),
            ),
            duplex: 'half',
          },
    )
    if (!response.ok)
      throw new Error(`R2 ${method} failed with ${response.status}`)
    return response
  }
  return {
    put: async (key, file, metadata) => {
      await request('PUT', key, file, metadata)
    },
    head: async (key) => {
      const response = await request('HEAD', key)
      const checksum = response.headers.get('x-amz-meta-checksum')
      const bytes = response.headers.get('content-length')
      if (checksum === null || bytes === null || !/^\d+$/.test(bytes))
        return undefined
      return { checksum, bytes: Number(bytes) }
    },
  }
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest()
}

function fileBody(stream: Readable) {
  const iterator = stream[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await iterator.next()
      if (chunk.done) return controller.close()
      if (!(chunk.value instanceof Uint8Array))
        return controller.error(
          new Error('R2 publisher received a text file chunk'),
        )
      controller.enqueue(chunk.value)
    },
    async cancel() {
      await iterator.return?.()
      stream.destroy()
    },
  })
}
