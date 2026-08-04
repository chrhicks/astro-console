import { readFileSync } from 'node:fs'
import { Schema } from 'effect'
import type { OriginServerConfig } from './environment-config.ts'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'

const GrantResponse = Schema.Struct({ url: Schema.NonEmptyString })
export function configuredDownloadGrantIssuer(
  config: OriginServerConfig['downloadGrant'],
): DownloadGrantIssuer | undefined {
  if (config === undefined) return undefined
  return createDownloadGrantIssuer(config)
}

export function createDownloadGrantIssuer(input: {
  readonly url: string
  readonly secretPath: string
}): DownloadGrantIssuer {
  const url = new URL(input.url)
  let secret: string
  try {
    secret = readFileSync(input.secretPath, 'utf8').trim()
  } catch {
    throw new Error('Download grant shared secret is unreadable')
  }
  if (secret.length < 32 || /[\r\n]/.test(secret))
    throw new Error('Download grant shared secret is invalid')
  return {
    issue: async (input) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error('Download grant signer is unavailable')
      const text = await response.text()
      if (Buffer.byteLength(text) > 16_384)
        throw new Error('Download grant signer response is too large')
      return Schema.decodeUnknownSync(GrantResponse)(JSON.parse(text)).url
    },
  }
}
