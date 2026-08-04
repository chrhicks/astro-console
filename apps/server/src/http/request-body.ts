import type { IncomingMessage } from 'node:http'

export const BodyTooLarge = Symbol('BodyTooLarge')
export function body(
  request: IncomingMessage,
): Promise<unknown | undefined | typeof BodyTooLarge> {
  return new Promise((resolve) => {
    let size = 0
    let text = ''
    let settled = false
    const finish = (value: unknown | undefined | typeof BodyTooLarge) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const contentLength = request.headers['content-length']
    if (
      typeof contentLength === 'string' &&
      /^\d+$/.test(contentLength) &&
      Number(contentLength) > 16_384
    ) {
      request.resume()
      return finish(BodyTooLarge)
    }
    request.on('data', (chunk: Buffer | string) => {
      size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
      if (size > 16_384) {
        request.resume()
        return finish(BodyTooLarge)
      }
      text += chunk
    })
    request.on('end', () => {
      try {
        finish(JSON.parse(text))
      } catch {
        finish(undefined)
      }
    })
    request.on('error', () => finish(undefined))
  })
}
