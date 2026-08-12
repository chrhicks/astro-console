import { createServer } from 'node:http'

export async function openOtlpTestCollector() {
  const requests: Array<{
    readonly url: string
    readonly contentType: string | undefined
    readonly body: Buffer
  }> = []
  const server = createServer((request, response) => {
    const chunks: Array<Buffer> = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({
        url: request.url ?? '',
        contentType:
          typeof request.headers['content-type'] === 'string'
            ? request.headers['content-type']
            : undefined,
        body: Buffer.concat(chunks),
      })
      response.writeHead(200).end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('test collector did not bind a TCP port')
  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      ),
  }
}
