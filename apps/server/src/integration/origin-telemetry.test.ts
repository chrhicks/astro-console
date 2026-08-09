import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { ConfigProvider, Effect } from 'effect'
import { createOriginTelemetry } from '../observability/origin-telemetry.ts'

test('origin telemetry is disabled until the standard traces exporter is enabled', async () => {
  const collector = await testCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
    }),
  })
  try {
    await telemetry.initialize()
    await telemetry.runPromise(
      Effect.void.pipe(Effect.withSpan('OriginTelemetry.disabled-test')),
    )
  } finally {
    await telemetry.dispose()
    await collector.close()
  }
  assert.equal(collector.requests.length, 0)
})

test('origin telemetry exports protobuf spans with standard resource identity', async () => {
  const collector = await testCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_SERVICE_NAME: 'astro-console-origin-test',
      OTEL_SERVICE_VERSION: 'test-release-42',
      OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
    }),
  })
  try {
    await telemetry.initialize()
    const child = Effect.fn('OriginTelemetry.child')(function* () {
      yield* Effect.annotateCurrentSpan({
        'astro.workspace': 'observe',
      })
    })
    await telemetry.runPromise(
      child().pipe(
        Effect.withSpan('HTTP POST /api/observe/commands', {
          kind: 'server',
        }),
      ),
    )
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  assert.equal(collector.requests.length, 1)
  const request = collector.requests[0]
  assert.equal(request?.url, '/v1/traces')
  assert.match(request?.contentType ?? '', /^application\/x-protobuf/)
  const payload = request?.body.toString('utf8') ?? ''
  assert.match(payload, /astro-console-origin-test/)
  assert.match(payload, /test-release-42/)
  assert.match(payload, /deployment\.environment\.name/)
  assert.match(payload, /OriginTelemetry\.child/)
  assert.match(payload, /HTTP POST \/api\/observe\/commands/)
  assert.match(payload, /astro\.workspace/)
})

async function testCollector() {
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
