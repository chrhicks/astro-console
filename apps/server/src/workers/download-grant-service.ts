import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { readFileSync } from 'node:fs'
import { Effect, Schema } from 'effect'
import {
  createR2DownloadGrantIssuer,
  type DownloadGrantIssuer,
} from '../storage/r2-download-grant.ts'
import { downloadGrantSignerConfig } from '../config/environment-config.ts'
import { runExecutable } from '../app/executable.ts'

const Request = Schema.Struct({
  objectKey: Schema.NonEmptyString,
  expiresAt: Schema.NonEmptyString,
})
export function createDownloadGrantService(
  config: {
    readonly bucket: string
    readonly endpoint: string
    readonly credentialsPath: string
    readonly secretPath: string
  },
  dependencies: {
    readonly secret?: string
    readonly issuer?: DownloadGrantIssuer
  } = {},
) {
  const secret =
    dependencies.secret ?? readFileSync(config.secretPath, 'utf8').trim()
  if (secret.length < 32 || /[\r\n]/.test(secret))
    throw new Error('Download grant shared secret is invalid')
  const issuer = dependencies.issuer ?? createR2DownloadGrantIssuer(config)
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (
        request.method !== 'POST' ||
        request.url !== '/internal/download-grants' ||
        request.headers.authorization !== `Bearer ${secret}`
      )
        return response.writeHead(401).end()
      let text = ''
      for await (const chunk of request) {
        text += chunk
        if (Buffer.byteLength(text) > 16_384)
          return response.writeHead(413).end()
      }
      let input: typeof Request.Type
      try {
        input = Schema.decodeUnknownSync(Request)(JSON.parse(text))
      } catch {
        return response.writeHead(400).end()
      }
      try {
        const url = await issuer.issue(input)
        response
          .writeHead(200, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          })
          .end(JSON.stringify({ url }))
      } catch {
        response.writeHead(503).end()
      }
    })()
  })
}
if (process.argv[1]?.endsWith('./download-grant-service.ts')) {
  runExecutable('download-grant signer', async () => {
    const config = await Effect.runPromise(downloadGrantSignerConfig)
    const server = createDownloadGrantService(config)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, '0.0.0.0', resolve)
    })
  })
}
