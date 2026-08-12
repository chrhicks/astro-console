import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ConfigProvider,
  Context,
  Deferred,
  Effect,
  Layer,
  Queue,
  Schema,
} from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { ProcessingProjectId } from '@astro-console/protocol'
import { openOriginTestApplicationForDatabase } from './origin-test-graph.ts'
import { createOriginTelemetry } from '../observability/origin-telemetry.ts'
import type {
  NodeRuntimeGcType,
  NodeRuntimeSampleSource,
} from '../observability/node-runtime-telemetry.ts'
import { tracedExecutorWork } from '../observability/executor-telemetry.ts'
import { recordOperationalEvent } from '../observability/operational-telemetry.ts'
import {
  recordAdmissionDecision,
  recordJwksRefresh,
  tracedAdmission,
} from '../observability/admission-telemetry.ts'
import { tracedStartup } from '../observability/startup-telemetry.ts'
import {
  tracedFrameInspection,
  tracedFrameIntake,
  tracedPipelineStage,
  tracedPlateSolve,
  tracedPublisherWork,
} from '../observability/pipeline-telemetry.ts'
import {
  recordSqliteBacklog,
  tracedSqliteOperation,
  type SqliteOperation,
} from '../observability/sqlite-telemetry.ts'
import { alpacaCameraProvider } from '../providers/alpaca-camera-provider.ts'
import { alpacaPreflightProvider } from '../providers/alpaca-preflight-provider.ts'
import {
  originTelemetryServicesLayer,
  originProcessWorkBehaviorLayer,
} from '../app/origin-application-services.ts'
import { tracedHttpRoute } from '../http/routes/origin-route-shared.ts'
import { ProcessingProjectLifecycle } from '../services/processing-project-service.ts'
import { openOtlpTestCollector } from './otlp-test-collector.ts'

test('origin telemetry is disabled until the standard traces exporter is enabled', async () => {
  const collector = await openOtlpTestCollector()
  let runtimeSamplerStarts = 0
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
    }),
    nodeRuntimeTelemetry: {
      source: {
        start: () => {
          runtimeSamplerStarts += 1
        },
        sample: () => ({
          eventLoopUtilization: 0,
          eventLoopDelaySeconds: {
            min: 0,
            max: 0,
            mean: 0,
            stddev: 0,
            p50: 0,
            p90: 0,
            p99: 0,
          },
          heapSpaces: [],
          heapLimitBytes: 0,
        }),
        stop: () => undefined,
      },
    },
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
  assert.equal(runtimeSamplerStarts, 0)
})

test('origin telemetry exports protobuf spans with standard resource identity', async () => {
  const collector = await openOtlpTestCollector()
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

test('concurrent executions keep HTTP status and outcome capture distinct', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_SERVICE_NAME: 'astro-console-concurrent-http-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
    }),
  })
  try {
    await telemetry.initialize()
    const responses = Effect.runSync(
      Queue.unbounded<HttpServerResponse.HttpServerResponse>(),
    )
    Queue.offerUnsafe(responses, HttpServerResponse.empty({ status: 200 }))
    Queue.offerUnsafe(responses, HttpServerResponse.empty({ status: 409 }))
    const releaseAccepted = Effect.runSync(Deferred.make<void>())
    const route = tracedHttpRoute(
      {
        method: 'GET',
        route: '/concurrent-telemetry',
        workspace: 'library',
      },
      Queue.take(responses),
      (_response, captured) =>
        captured.pipe(
          Effect.flatMap((value) =>
            value.status === 200
              ? Deferred.await(releaseAccepted).pipe(Effect.as(value))
              : Deferred.succeed(releaseAccepted, undefined).pipe(
                  Effect.as(value),
                ),
          ),
        ),
    )
    await telemetry.runPromise(
      Effect.all([route, route], { concurrency: 'unbounded' }),
    )
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'HTTP GET /concurrent-telemetry'), 2)
  assert.ok(textOccurrences(payload, 'accepted') > 0)
  assert.ok(textOccurrences(payload, 'rejected') > 0)
})

test('origin telemetry exports structured logs and metrics with standard signal config', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}/v1/logs`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${collector.url}/v1/metrics`,
      OTEL_SERVICE_NAME: 'astro-console-signals-test',
      OTEL_BLRP_SCHEDULE_DELAY: '60000',
      OTEL_METRIC_EXPORT_INTERVAL: '60000',
    }),
  })
  try {
    await telemetry.initialize()
    await telemetry.runPromise(
      recordOperationalEvent({
        scope: 'startup',
        operation: 'config.decode',
        outcome: 'ready',
      }),
    )
  } finally {
    await telemetry.dispose()
    await collector.close()
  }
  const logs = collector.requests.filter(
    (request) => request.url === '/v1/logs',
  )
  const metrics = collector.requests.filter(
    (request) => request.url === '/v1/metrics',
  )
  assert.equal(logs.length, 1)
  assert.equal(metrics.length, 1)
  assert.match(logs[0]?.contentType ?? '', /^application\/x-protobuf/)
  assert.match(metrics[0]?.contentType ?? '', /^application\/x-protobuf/)
  const logPayload = logs[0]?.body.toString('utf8') ?? ''
  const metricPayload = metrics[0]?.body.toString('utf8') ?? ''
  assert.match(logPayload, /astro-console-signals-test/)
  assert.match(logPayload, /astro\.operation/)
  assert.match(logPayload, /astro\.telemetry\.scope/)
  assert.match(logPayload, /startup/)
  assert.match(logPayload, /config\.decode/)
  assert.match(logPayload, /ready/)
  assert.match(metricPayload, /astro-console-signals-test/)
  assert.match(metricPayload, /astro\.operation\.count/)
  assert.match(metricPayload, /astro\.telemetry\.scope/)
  assert.doesNotMatch(logPayload, /owner-chicks/)
  assert.doesNotMatch(logPayload, /private/)
  assert.doesNotMatch(metricPayload, /owner-chicks/)
  assert.doesNotMatch(metricPayload, /private/)
})

test('origin telemetry exports Node runtime metrics without spans or private process data', async () => {
  const collector = await openOtlpTestCollector()
  let starts = 0
  let stops = 0
  let tick: (() => void) | undefined
  let recordGc:
    ((type: NodeRuntimeGcType, durationSeconds: number) => void) | undefined
  const source: NodeRuntimeSampleSource = {
    start(record) {
      starts += 1
      recordGc = record
    },
    sample: () => ({
      eventLoopUtilization: 0.42,
      eventLoopDelaySeconds: {
        min: 0.001,
        max: 0.009,
        mean: 0.003,
        stddev: 0.002,
        p50: 0.002,
        p90: 0.006,
        p99: 0.008,
      },
      heapSpaces: [{ name: 'old_space', usedBytes: 1_048_576 }],
      heapLimitBytes: 4_294_967_296,
    }),
    stop() {
      stops += 1
    },
  }
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${collector.url}/v1/metrics`,
      OTEL_SERVICE_NAME: 'astro-console-node-runtime-test',
      OTEL_METRIC_EXPORT_INTERVAL: '60000',
    }),
    nodeRuntimeTelemetry: {
      source,
      schedule: (scheduledTick) => {
        tick = scheduledTick
        return () => undefined
      },
    },
  })
  try {
    await telemetry.initialize()
    assert.equal(starts, 1)
    tick?.()
    recordGc?.('major', 0.012)
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  assert.equal(stops, 1)
  assert.deepEqual(
    [...new Set(collector.requests.map((request) => request.url))],
    ['/v1/metrics'],
  )
  const payloadBytes = Buffer.concat(
    collector.requests.map((request) => request.body),
  )
  const payload = payloadBytes.toString('utf8')
  for (const metricName of [
    'nodejs.eventloop.utilization',
    'nodejs.eventloop.delay.min',
    'nodejs.eventloop.delay.max',
    'nodejs.eventloop.delay.mean',
    'nodejs.eventloop.delay.stddev',
    'nodejs.eventloop.delay.p50',
    'nodejs.eventloop.delay.p90',
    'nodejs.eventloop.delay.p99',
    'v8js.memory.heap.used',
    'v8js.memory.heap.limit',
    'v8js.gc.duration',
  ])
    assert.equal(textOccurrences(payload, metricName), 1)
  assert.match(payload, /v8js\.heap\.space\.name/)
  assert.match(payload, /old_space/)
  assert.match(payload, /v8js\.gc\.type/)
  assert.match(payload, /major/)
  assert.match(payload, /astro-console-node-runtime-test/)
  const units = otlpMetricUnits(payloadBytes)
  assert.equal(units.get('nodejs.eventloop.utilization'), '1')
  for (const metricName of [
    'nodejs.eventloop.delay.min',
    'nodejs.eventloop.delay.max',
    'nodejs.eventloop.delay.mean',
    'nodejs.eventloop.delay.stddev',
    'nodejs.eventloop.delay.p50',
    'nodejs.eventloop.delay.p90',
    'nodejs.eventloop.delay.p99',
    'v8js.gc.duration',
  ])
    assert.equal(units.get(metricName), 's')
  assert.equal(units.get('v8js.memory.heap.used'), 'By')
  assert.equal(units.get('v8js.memory.heap.limit'), 'By')
  assert.doesNotMatch(payload, /unit/)
  assert.doesNotMatch(payload, /\/Users\/chicks/)
  assert.doesNotMatch(payload, /--experimental-strip-types/)
  assert.doesNotMatch(payload, /OTEL_EXPORTER_OTLP/)
  assert.doesNotMatch(payload, /owner-chicks/)
  assert.doesNotMatch(payload, /private/)
  assert.doesNotMatch(payload, /email/)
})

test('SQLite telemetry exports closed spans, operation metrics, and backlog gauges', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${collector.url}/v1/metrics`,
      OTEL_SERVICE_NAME: 'astro-console-sqlite-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
      OTEL_METRIC_EXPORT_INTERVAL: '60000',
    }),
  })
  const successfulOperations: ReadonlyArray<SqliteOperation> = [
    'executor.work.select',
    'executor.work.settle',
    'publisher.outbox.claim',
    'publisher.outbox.settle',
    'projection.snapshot.read',
  ]
  try {
    await telemetry.initialize()
    for (const operation of successfulOperations)
      await telemetry.runPromise(
        tracedSqliteOperation(operation, Effect.succeed('complete')),
      )
    await assert.rejects(
      telemetry.runPromise(
        tracedSqliteOperation(
          'command.state.transaction',
          Effect.fail(
            new Error(
              'SQLITE_BUSY private SQL SELECT * FROM secrets WHERE id=private-param',
            ),
          ),
        ),
      ),
    )
    await telemetry.runPromise(recordSqliteBacklog('executor', 2))
    await telemetry.runPromise(recordSqliteBacklog('publisher', 3))
    await telemetry.runPromise(recordSqliteBacklog('executor', 0))
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  const tracePayload = Buffer.concat(
    collector.requests
      .filter((request) => request.url === '/v1/traces')
      .map((request) => request.body),
  ).toString('utf8')
  const metricPayloadBytes = Buffer.concat(
    collector.requests
      .filter((request) => request.url === '/v1/metrics')
      .map((request) => request.body),
  )
  const metricPayload = metricPayloadBytes.toString('utf8')
  for (const span of [
    'SQLite.executor.work.select',
    'SQLite.executor.work.settle',
    'SQLite.publisher.outbox.claim',
    'SQLite.publisher.outbox.settle',
    'SQLite.projection.snapshot.read',
    'SQLite.command.state.transaction',
  ])
    assert.equal(textOccurrences(tracePayload, span), 1)
  assert.match(tracePayload, /db\.system\.name/)
  assert.match(tracePayload, /sqlite/)
  assert.match(tracePayload, /db\.operation\.name/)
  assert.match(tracePayload, /db\.query\.summary/)
  assert.match(tracePayload, /db\.collection\.name/)
  assert.match(tracePayload, /astro\.sqlite\.outcome/)
  assert.match(tracePayload, /success/)
  assert.match(tracePayload, /busy/)
  assert.match(metricPayload, /astro\.sqlite\.operation\.count/)
  assert.match(metricPayload, /astro\.sqlite\.operation\.duration/)
  assert.match(metricPayload, /astro\.sqlite\.backlog/)
  assert.match(metricPayload, /executor/)
  assert.match(metricPayload, /publisher/)
  assert.equal(
    otlpMetricUnits(metricPayloadBytes).get('astro.sqlite.operation.duration'),
    's',
  )
  const durationAttributeKeys = otlpHistogramAttributeKeys(
    metricPayloadBytes,
    'astro.sqlite.operation.duration',
  )
  assert.equal(durationAttributeKeys.has('unit'), false)
  assert.equal(durationAttributeKeys.has('time_unit'), false)
  for (const payload of [tracePayload, metricPayload]) {
    assert.doesNotMatch(payload, /db\.query\.text/)
    assert.doesNotMatch(payload, /SQLITE_BUSY/)
    assert.doesNotMatch(payload, /SELECT \* FROM secrets/)
    assert.doesNotMatch(payload, /private-param/)
    assert.doesNotMatch(payload, /private SQL/)
    assert.doesNotMatch(payload, /state\.sqlite/)
    assert.doesNotMatch(payload, /owner-chicks/)
    assert.doesNotMatch(payload, /desktop-owner/)
    assert.doesNotMatch(payload, /checksum/)
    assert.doesNotMatch(payload, /rightAscension/)
    assert.doesNotMatch(payload, /declination/)
  }
})

test('startup and admission spans export closed outcomes without identity', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}/v1/logs`,
      OTEL_SERVICE_NAME: 'astro-console-startup-admission-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
      OTEL_BLRP_SCHEDULE_DELAY: '60000',
    }),
  })
  try {
    await telemetry.initialize()
    await telemetry.runPromise(
      tracedStartup('config.decode', Effect.succeed({ mode: 'development' })),
    )
    await telemetry.runPromise(
      tracedStartup('service.create', Effect.succeed(true)),
    )
    await telemetry.runPromise(
      tracedStartup('listener.bind', Effect.succeed(true)),
    )
    await telemetry.runPromise(
      tracedAdmission(
        Effect.succeed({
          personId: 'private-person-id',
          clientId: 'private-client-id',
          role: 'owner' as const,
          capability: 'controlCapable' as const,
        }),
      ),
    )
    await telemetry.runPromise(tracedAdmission(Effect.succeed(undefined)))
    await telemetry.runPromise(recordAdmissionDecision('notMember'))
    await telemetry.runPromise(recordJwksRefresh('failed'))
  } finally {
    await telemetry.dispose()
    await collector.close()
  }
  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'Origin.startup.config.decode'), 1)
  assert.equal(textOccurrences(payload, 'Origin.startup.service.create'), 1)
  assert.equal(textOccurrences(payload, 'Origin.startup.listener.bind'), 1)
  assert.equal(textOccurrences(payload, 'Admission.request'), 2)
  assert.match(payload, /astro\.startup\.operation/)
  assert.match(payload, /astro\.startup\.outcome/)
  assert.match(payload, /astro\.admission\.outcome/)
  assert.match(payload, /ready/)
  assert.match(payload, /admitted/)
  assert.match(payload, /rejected/)
  assert.match(payload, /decision/)
  assert.match(payload, /notMember/)
  assert.match(payload, /jwks\.refresh/)
  assert.match(payload, /failed/)
  assert.doesNotMatch(payload, /private-person-id/)
  assert.doesNotMatch(payload, /private-client-id/)
  assert.doesNotMatch(payload, /owner-chicks/)
  assert.doesNotMatch(payload, /cf-access-jwt-assertion/)
  assert.doesNotMatch(payload, /kid/)
  assert.doesNotMatch(payload, /email/)
})

test('admission telemetry excludes health and static requests', async () => {
  const observed: Array<{ readonly path: string; readonly enabled: boolean }> =
    []
  const service = await openOriginTestApplicationForDatabase(
    ':memory:',
    { fixture: 'm27' },
    undefined,
    (request, observation) => {
      observed.push({
        path: request.path,
        enabled: observation !== undefined,
      })
      observation?.admission('admitted')
      return {
        personId: 'private-person-id',
        clientId: 'private-client-id',
        role: 'owner',
        capability: 'controlCapable',
      }
    },
    {
      admission: () => undefined,
      jwks: () => undefined,
    },
  )
  try {
    const listener = await service.listen()
    try {
      const base = `http://127.0.0.1:${listener.port}`
      assert.equal((await fetch(`${base}/api/health/ready`)).status, 200)
      assert.equal((await fetch(`${base}/missing-static.css`)).status, 404)
      assert.equal((await fetch(`${base}/api/library`)).status, 200)
    } finally {
      await listener.close()
    }
  } finally {
    await service.close()
  }

  assert.deepEqual(observed, [
    { path: '/api/health/ready', enabled: false },
    { path: '/missing-static.css', enabled: false },
    { path: '/api/library', enabled: true },
  ])
})

test('executor work exports a safe closed work outcome without tracing an empty poll', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_SERVICE_NAME: 'astro-console-executor-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
    }),
  })
  try {
    await telemetry.initialize()
    const outcome = await telemetry.runPromise(
      tracedExecutorWork('StartExposure', async () => 'reconciling'),
    )
    assert.equal(outcome, 'reconciling')
  } finally {
    await telemetry.dispose()
    await collector.close()
  }
  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'RunExecutor.work.execute'), 1)
  assert.match(payload, /astro\.executor\.work\.kind/)
  assert.match(payload, /StartExposure/)
  assert.match(payload, /astro\.executor\.work\.outcome/)
  assert.match(payload, /reconciling/)
  assert.doesNotMatch(payload, /run-m27/)
  assert.doesNotMatch(payload, /asset-m27/)
})

test('projection snapshot and SSE setup export bounded delivery spans', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}/v1/logs`,
      OTEL_SERVICE_NAME: 'astro-console-projection-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
      OTEL_BLRP_SCHEDULE_DELAY: '60000',
    }),
  })
  try {
    await telemetry.initialize()
    const service = await openOriginTestApplicationForDatabase(
      ':memory:',
      { fixture: 'm27' },
      Layer.mergeAll(originTelemetryServicesLayer(telemetry)),
    )
    try {
      const listener = await service.listen()
      try {
        const base = `http://127.0.0.1:${listener.port}`
        const snapshot = await fetch(`${base}/api/snapshot`)
        assert.equal(snapshot.status, 200)
        const projection = Schema.decodeUnknownSync(
          Schema.Struct({
            data: Schema.Struct({
              plan: Schema.optionalKey(
                Schema.Struct({
                  planId: Schema.String,
                  revision: Schema.Number,
                }),
              ),
              control: Schema.Struct({ revision: Schema.Number }),
            }),
          }),
        )(await snapshot.json()).data
        if (projection.plan === undefined)
          throw new Error(
            'Projection telemetry fixture has no Plan projection.',
          )
        const eventsAbort = new AbortController()
        const events = await fetch(`${base}/api/events`, {
          signal: eventsAbort.signal,
        })
        assert.equal(events.status, 200)
        assert.match(
          events.headers.get('content-type') ?? '',
          /text\/event-stream/,
        )
        const command = await fetch(`${base}/api/plan/commands`, {
          method: 'POST',
          body: JSON.stringify({
            intent: {
              _tag: 'StartAcceptedRun',
              planId: projection.plan.planId,
              expectedPlanRevision: projection.plan.revision,
              expectedLeaseRevision: projection.control.revision,
              idempotencyKey: 'private-projection-command-key',
            },
          }),
        })
        assert.equal(command.status, 202)
        await command.body?.cancel()
        eventsAbort.abort()
        await new Promise<void>((resolve) => setTimeout(resolve, 25))
      } finally {
        await listener.close()
      }
    } finally {
      await service.close()
    }
  } finally {
    await telemetry.dispose()
    await collector.close()
  }
  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'Projection.snapshot.deliver'), 1)
  assert.equal(textOccurrences(payload, 'Projection.sse.open'), 1)
  assert.equal(textOccurrences(payload, 'HTTP GET /api/snapshot'), 1)
  assert.equal(textOccurrences(payload, 'HTTP GET /api/events'), 1)
  assert.equal(textOccurrences(payload, 'SQLite.projection.snapshot.read'), 1)
  assert.equal(textOccurrences(payload, 'SQLite.command.state.transaction'), 1)
  assert.match(payload, /astro\.projection\.delivery/)
  assert.match(payload, /astro\.projection\.delivery\.outcome/)
  assert.match(payload, /delivered/)
  assert.match(payload, /astro\.projection\.control\.state/)
  assert.match(payload, /held/)
  assert.match(payload, /sse\.connect/)
  assert.match(payload, /sse\.publish/)
  assert.match(payload, /sse\.disconnect/)
  assert.doesNotMatch(payload, /heartbeat/)
  assert.doesNotMatch(payload, /owner-chicks/)
  assert.doesNotMatch(payload, /desktop-owner/)
  assert.doesNotMatch(payload, /plan-m27/)
  assert.doesNotMatch(payload, /run-m27/)
  assert.doesNotMatch(payload, /asset-m27/)
  assert.doesNotMatch(payload, /private-projection-command-key/)
})

test('local image pipeline boundaries export only closed outcomes', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_SERVICE_NAME: 'astro-console-pipeline-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
    }),
  })
  try {
    await telemetry.initialize()
    await telemetry.runPromise(
      tracedPlateSolve(
        Effect.succeed({
          outcome: 'recorded' as const,
          result: 'NoSolution' as const,
        }),
      ),
    )
    await telemetry.runPromise(
      tracedFrameIntake(
        Effect.succeed({
          outcome: 'rejected' as const,
          reason: 'MaterializationFailed' as const,
        }),
      ),
    )
    await telemetry.runPromise(
      tracedFrameInspection(
        Effect.succeed({ inspection: { _tag: 'Available' as const } }),
      ),
    )
    assert.equal(
      await telemetry.runPromise(tracedPublisherWork(async () => 'published')),
      'published',
    )
    for (const stage of [
      'plateSolve.execute',
      'publisher.localRead',
      'publisher.put',
      'publisher.verify',
      'publisher.settle',
    ] as const)
      await telemetry.runPromise(tracedPipelineStage(stage, async () => true))
  } finally {
    await telemetry.dispose()
    await collector.close()
  }
  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'PlateSolve.execute'), 1)
  assert.equal(textOccurrences(payload, 'FrameIntake.materialize'), 1)
  assert.equal(textOccurrences(payload, 'FrameInspection.inspect'), 1)
  assert.equal(textOccurrences(payload, 'Publisher.work.publish'), 1)
  assert.equal(textOccurrences(payload, 'PlateSolve.external.execute'), 1)
  assert.equal(textOccurrences(payload, 'Publisher.local.read'), 1)
  assert.equal(textOccurrences(payload, 'Publisher.provider.put'), 1)
  assert.equal(textOccurrences(payload, 'Publisher.provider.verify'), 1)
  assert.equal(textOccurrences(payload, 'Publisher.work.settle'), 1)
  assert.match(payload, /astro\.pipeline\.operation/)
  assert.match(payload, /astro\.pipeline\.outcome/)
  assert.match(payload, /recorded\.noSolution/)
  assert.match(payload, /rejected\.MaterializationFailed/)
  assert.match(payload, /available/)
  assert.match(payload, /published/)
  assert.doesNotMatch(payload, /asset-private/)
  assert.doesNotMatch(payload, /private\/path/)
  assert.doesNotMatch(payload, /sha256:/)
  assert.doesNotMatch(payload, /object-key/)
  assert.doesNotMatch(payload, /rightAscension/)
  assert.doesNotMatch(payload, /declination/)
})

test('Alpaca operations export safe child spans without changing requests', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_SERVICE_NAME: 'astro-console-provider-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
    }),
  })
  const preflightRequests: Array<{
    readonly url: string
    readonly method: string
    readonly hasSignal: boolean
  }> = []
  const providerConfig = {
    kind: 'alpaca' as const,
    rigId: 'private-rig-id',
    host: '192.0.2.235',
    port: 45_678,
    devices: {
      camera: { deviceNumber: 47, uniqueId: 'private-camera-unique-id' },
    },
  }
  const preflight = alpacaPreflightProvider(
    providerConfig,
    async (input, init) => {
      const url = String(input)
      preflightRequests.push({
        url,
        method: init?.method ?? 'GET',
        hasSignal: init?.signal instanceof AbortSignal,
      })
      const value = url.endsWith('/configureddevices')
        ? [
            {
              DeviceName: 'Recorded camera',
              DeviceNumber: 47,
              DeviceType: 'Camera',
              UniqueID: 'private-camera-unique-id',
            },
          ]
        : url.endsWith('/connected')
          ? true
          : url.endsWith('/name')
            ? 'Recorded camera'
            : url.endsWith('/canabortexposure')
              ? true
              : false
      return Response.json({ Value: value, ErrorNumber: 0 })
    },
  )
  const cameraRequests: Array<{
    readonly url: string
    readonly method: string
    readonly body: string
    readonly accept: string | undefined
    readonly hasSignal: boolean
  }> = []
  const imageBytes = recordedImageBytes()
  const camera = alpacaCameraProvider(providerConfig, async (input, init) => {
    const url = String(input)
    cameraRequests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? '' : String(init.body),
      accept: new Headers(init?.headers).get('accept') ?? undefined,
      hasSignal: init?.signal instanceof AbortSignal,
    })
    if (url.endsWith('/imagearray'))
      return new Response(imageBytes, {
        headers: {
          'content-type': 'application/imagebytes',
          'content-length': String(imageBytes.byteLength),
        },
      })
    return Response.json({
      Value: url.endsWith('/camerastate') ? 0 : null,
      ErrorNumber: 0,
    })
  })
  let failureRequestHasSignal = false
  const failedCamera = alpacaCameraProvider(
    providerConfig,
    async (_input, init) => {
      failureRequestHasSignal = init?.signal instanceof AbortSignal
      return new Response('PRIVATE_PROVIDER_BODY_SENTINEL', { status: 503 })
    },
  )

  let image:
    | {
        readonly bytes: Uint8Array
        readonly format: 'cameraRaw' | 'fits' | 'tiff'
      }
    | undefined
  let failedCommandExitTag: string | undefined
  try {
    await telemetry.initialize()
    await telemetry.runPromise(
      preflight.observe().pipe(Effect.withSpan('ProviderTest.preflight')),
    )
    await telemetry.runPromise(
      Effect.gen(function* () {
        yield* camera.startExposure(15)
        yield* camera.readState()
        image = yield* camera.readImageArray?.() ??
          Effect.die('missing camera image reader')
      }).pipe(Effect.withSpan('ProviderTest.camera')),
    )
    const failedCommand = await telemetry.runPromise(
      failedCamera
        .startExposure(15)
        .pipe(Effect.exit, Effect.withSpan('ProviderTest.failure')),
    )
    failedCommandExitTag = failedCommand._tag
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  assert.ok(preflightRequests.every((request) => request.method === 'GET'))
  assert.ok(preflightRequests.every((request) => request.hasSignal))
  assert.deepEqual(
    cameraRequests.map(({ method, body, accept, hasSignal }) => ({
      method,
      body,
      accept,
      hasSignal,
    })),
    [
      {
        method: 'PUT',
        body: 'Duration=15&Light=true',
        accept: undefined,
        hasSignal: true,
      },
      { method: 'GET', body: '', accept: undefined, hasSignal: true },
      {
        method: 'GET',
        body: '',
        accept: 'application/imagebytes',
        hasSignal: true,
      },
    ],
  )
  assert.equal(failureRequestHasSignal, true)
  assert.equal(failedCommandExitTag, 'Failure')
  assert.equal(image?.format, 'cameraRaw')
  assert.deepEqual(image?.bytes, imageBytes)

  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.match(payload, /ProviderTest\.preflight/)
  assert.match(payload, /ProviderTest\.camera/)
  assert.match(payload, /ProviderTest\.failure/)
  assert.match(payload, /AlpacaProvider\.operation/)
  assert.match(payload, /AlpacaProvider\.fetch/)
  assert.match(payload, /astro\.provider/)
  assert.match(payload, /astro\.provider\.operation/)
  assert.match(payload, /astro\.provider\.request\.outcome/)
  assert.match(payload, /astro\.provider\.operation\.outcome/)
  assert.match(payload, /preflight\.inventory/)
  assert.match(payload, /preflight\.device\.read/)
  assert.match(payload, /camera\.start_exposure/)
  assert.match(payload, /camera\.read_state/)
  assert.match(payload, /camera\.read_image/)
  assert.match(payload, /http\.route/)
  assert.match(payload, /http\.request\.method/)
  assert.match(payload, /http\.response\.status_code/)
  assert.match(payload, /\/api\/v1\/camera\/:deviceNumber\/imagearray/)
  assert.match(payload, /astro\.device\.kind/)
  assert.doesNotMatch(payload, /192\.0\.2\.235/)
  assert.doesNotMatch(payload, /private-rig-id/)
  assert.doesNotMatch(payload, /private-camera-unique-id/)
  assert.doesNotMatch(payload, /Recorded camera/)
  assert.doesNotMatch(payload, /\/api\/v1\/camera\/47\//)
  assert.doesNotMatch(payload, /Duration=15/)
  assert.doesNotMatch(payload, /Light=true/)
  assert.doesNotMatch(payload, /PRIVATE_PROVIDER_BODY_SENTINEL/)
})

test('Plan HTTP flows export a small safe business hierarchy', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_SERVICE_NAME: 'astro-console-plan-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
    }),
  })
  try {
    await telemetry.initialize()
    const service = await openOriginTestApplicationForDatabase(
      ':memory:',
      { fixture: 'm27' },
      Layer.mergeAll(originTelemetryServicesLayer(telemetry)),
    )
    try {
      const listener = await service.listen()
      try {
        const base = `http://127.0.0.1:${listener.port}`
        const planResponse = await fetch(`${base}/api/workspaces/plan`)
        assert.equal(planResponse.status, 200)
        await planResponse.body?.cancel()

        const snapshotResponse = await fetch(`${base}/api/snapshot`)
        const snapshot = Schema.decodeUnknownSync(
          Schema.Struct({
            data: Schema.Struct({
              plan: Schema.optionalKey(
                Schema.Struct({
                  planId: Schema.String,
                  revision: Schema.Number,
                }),
              ),
              control: Schema.Struct({ revision: Schema.Number }),
            }),
          }),
        )(await snapshotResponse.json())
        if (snapshot.data.plan === undefined)
          throw new Error('Plan telemetry fixture has no Plan projection.')
        const commandResponse = await fetch(`${base}/api/plan/commands`, {
          method: 'POST',
          body: JSON.stringify({
            intent: {
              _tag: 'StartAcceptedRun',
              planId: snapshot.data.plan.planId,
              expectedPlanRevision: snapshot.data.plan.revision,
              expectedLeaseRevision: snapshot.data.control.revision,
              idempotencyKey: 'private-plan-command-key',
            },
          }),
        })
        assert.equal(commandResponse.status, 202)
        await commandResponse.body?.cancel()
      } finally {
        await listener.close()
      }
    } finally {
      await service.close()
    }
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.match(payload, /HTTP GET \/api\/workspaces\/plan/)
  assert.match(payload, /Plan\.workspace\.read/)
  assert.match(payload, /HTTP POST \/api\/plan\/commands/)
  assert.match(payload, /Plan\.command\.execute/)
  assert.match(payload, /Plan\.command\.applyIntent/)
  assert.match(payload, /Plan\.command\.publishChange/)
  assert.match(payload, /Plan\.command\.readSnapshot/)
  assert.match(payload, /astro\.workspace/)
  assert.match(payload, /astro\.command\.intent/)
  assert.match(payload, /StartAcceptedRun/)
  assert.match(payload, /astro\.command\.outcome/)
  assert.match(payload, /accepted/)
  assert.match(payload, /astro\.plan\.read\.outcome/)
  assert.match(payload, /served/)
  assert.match(payload, /astro\.plan\.stage/)
  assert.match(payload, /astro\.plan\.stage\.outcome/)
  assert.doesNotMatch(payload, /PlanService\.execute/)
  assert.doesNotMatch(payload, /PlanCommandService\.executeRequest/)
  assert.doesNotMatch(payload, /PlanCommandService\.responseFor/)
  assert.doesNotMatch(payload, /Server\.planCommandFromRequest/)
  assert.doesNotMatch(payload, /owner-chicks/)
  assert.doesNotMatch(payload, /desktop-owner/)
  assert.doesNotMatch(payload, /plan-m27/)
  assert.doesNotMatch(payload, /M27/)
  assert.doesNotMatch(payload, /Messier 27/)
  assert.doesNotMatch(payload, /private-plan-command-key/)
  assert.doesNotMatch(payload, /expectedPlanRevision/)
  assert.doesNotMatch(payload, /expectedLeaseRevision/)
})

test('Observe HTTP commands export only real business stages', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_SERVICE_NAME: 'astro-console-observe-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
    }),
  })
  try {
    await telemetry.initialize()
    const service = await openOriginTestApplicationForDatabase(
      ':memory:',
      { fixture: 'm27' },
      Layer.mergeAll(originTelemetryServicesLayer(telemetry)),
    )
    try {
      const listener = await service.listen()
      try {
        const base = `http://127.0.0.1:${listener.port}`
        const snapshot = async () => {
          const response = await fetch(`${base}/api/snapshot`)
          return Schema.decodeUnknownSync(
            Schema.Struct({
              data: Schema.Struct({
                plan: Schema.optionalKey(
                  Schema.Struct({
                    planId: Schema.String,
                    revision: Schema.Number,
                  }),
                ),
                observe: Schema.optionalKey(
                  Schema.Struct({ revision: Schema.Number }),
                ),
                control: Schema.Struct({ revision: Schema.Number }),
              }),
            }),
          )(await response.json()).data
        }
        const initial = await snapshot()
        if (initial.plan === undefined)
          throw new Error('Observe telemetry fixture has no Plan projection.')
        const startResponse = await fetch(`${base}/api/plan/commands`, {
          method: 'POST',
          body: JSON.stringify({
            intent: {
              _tag: 'StartAcceptedRun',
              planId: initial.plan.planId,
              expectedPlanRevision: initial.plan.revision,
              expectedLeaseRevision: initial.control.revision,
              idempotencyKey: 'private-observe-setup-key',
            },
          }),
        })
        assert.equal(startResponse.status, 202)
        await startResponse.body?.cancel()

        const active = await snapshot()
        if (active.observe === undefined)
          throw new Error('Observe telemetry fixture has no active run.')
        const pauseResponse = await fetch(`${base}/api/observe/commands`, {
          method: 'POST',
          body: JSON.stringify({
            intent: {
              _tag: 'PauseRun',
              expectedLeaseRevision: active.control.revision,
              expectedRunRevision: active.observe.revision,
              idempotencyKey: 'private-observe-pause-key',
            },
          }),
        })
        assert.equal(pauseResponse.status, 202)
        await pauseResponse.body?.cancel()

        const paused = await snapshot()
        if (paused.observe === undefined)
          throw new Error('Observe telemetry fixture has no paused run.')
        const rejectedResponse = await fetch(`${base}/api/observe/commands`, {
          method: 'POST',
          body: JSON.stringify({
            intent: {
              _tag: 'PauseRun',
              expectedLeaseRevision: paused.control.revision,
              expectedRunRevision: paused.observe.revision,
              idempotencyKey: 'private-observe-rejected-key',
            },
          }),
        })
        assert.equal(rejectedResponse.status, 409)
        await rejectedResponse.body?.cancel()
      } finally {
        await listener.close()
      }
    } finally {
      await service.close()
    }
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'Observe.command.execute'), 2)
  assert.equal(textOccurrences(payload, 'Observe.command.applyIntent'), 2)
  assert.equal(textOccurrences(payload, 'Observe.command.publishChange'), 1)
  assert.equal(textOccurrences(payload, 'Observe.command.readSnapshot'), 1)
  assert.match(payload, /HTTP POST \/api\/observe\/commands/)
  assert.match(payload, /astro\.workspace/)
  assert.match(payload, /astro\.command\.intent/)
  assert.match(payload, /PauseRun/)
  assert.match(payload, /astro\.command\.outcome/)
  assert.match(payload, /accepted/)
  assert.match(payload, /rejected/)
  assert.match(payload, /astro\.observe\.stage/)
  assert.match(payload, /astro\.observe\.stage\.outcome/)
  assert.doesNotMatch(payload, /ObserveService\.execute/)
  assert.doesNotMatch(payload, /ObserveCommandService\.executeRequest/)
  assert.doesNotMatch(payload, /Server\.observeCommandFromRequest/)
  assert.doesNotMatch(payload, /Server\.observeServiceResponse/)
  assert.doesNotMatch(payload, /Server\.observeInvalidResponse/)
  assert.doesNotMatch(payload, /owner-chicks/)
  assert.doesNotMatch(payload, /desktop-owner/)
  assert.doesNotMatch(payload, /plan-m27/)
  assert.doesNotMatch(payload, /run-m27/)
  assert.doesNotMatch(payload, /M27/)
  assert.doesNotMatch(payload, /private-observe-setup-key/)
  assert.doesNotMatch(payload, /private-observe-pause-key/)
  assert.doesNotMatch(payload, /private-observe-rejected-key/)
  assert.doesNotMatch(payload, /expectedRunRevision/)
  assert.doesNotMatch(payload, /expectedLeaseRevision/)
})

test('Library HTTP paths export one safe business boundary each', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_SERVICE_NAME: 'astro-console-library-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
    }),
  })
  let assetId = ''
  try {
    await telemetry.initialize()
    const service = await openOriginTestApplicationForDatabase(
      ':memory:',
      { fixture: 'm27' },
      Layer.mergeAll(originTelemetryServicesLayer(telemetry)),
    )
    try {
      const listener = await service.listen()
      try {
        const base = `http://127.0.0.1:${listener.port}`
        const pageResponse = await fetch(
          `${base}/api/library?queryId=private-query-text&pageSize=7&sort=sharpestFirst`,
        )
        assert.equal(pageResponse.status, 200)
        const page = Schema.decodeUnknownSync(
          Schema.Struct({
            results: Schema.Array(
              Schema.Struct({
                assetId: Schema.String,
                revision: Schema.Number,
              }),
            ),
          }),
        )(await pageResponse.json())
        const first = page.results[0]
        if (first === undefined)
          throw new Error('Library telemetry fixture has no catalog result.')
        assetId = first.assetId

        const detailResponse = await fetch(
          `${base}/api/library/assets/${encodeURIComponent(assetId)}`,
        )
        assert.equal(detailResponse.status, 200)
        const detail = Schema.decodeUnknownSync(
          Schema.Struct({ revision: Schema.Number }),
        )(await detailResponse.json())
        const reviewRequest = {
          expectedAssetRevision: detail.revision,
          expectedReviewRevision: 0,
          decision: 'accepted',
          rating: 5,
          annotation: 'PRIVATE_REVIEW_ANNOTATION',
          idempotencyKey: 'private-library-review-key',
        }
        const reviewResponse = await fetch(
          `${base}/api/library/assets/${encodeURIComponent(assetId)}/review`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(reviewRequest),
          },
        )
        assert.equal(reviewResponse.status, 200)
        await reviewResponse.body?.cancel()

        const rejectedReview = await fetch(
          `${base}/api/library/assets/${encodeURIComponent(assetId)}/review`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...reviewRequest,
              decision: 'rejected',
              annotation: 'PRIVATE_STALE_REVIEW_ANNOTATION',
              idempotencyKey: 'private-library-stale-review-key',
            }),
          },
        )
        assert.equal(rejectedReview.status, 409)
        await rejectedReview.body?.cancel()
      } finally {
        await listener.close()
      }
    } finally {
      await service.close()
    }
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'Library.catalog.page'), 1)
  assert.equal(
    textOccurrences(payload, 'Server.LibraryService.projectLibraryRow'),
    0,
  )
  assert.equal(textOccurrences(payload, 'Library.asset.detail'), 1)
  assert.equal(textOccurrences(payload, 'Library.asset.review'), 2)
  assert.match(payload, /HTTP GET \/api\/library/)
  assert.match(payload, /HTTP GET \/api\/library\/assets\/:assetId/)
  assert.match(payload, /HTTP POST \/api\/library\/assets\/:assetId\/review/)
  assert.match(payload, /astro\.workspace/)
  assert.match(payload, /astro\.library\.operation/)
  assert.match(payload, /catalog\.page/)
  assert.match(payload, /asset\.detail/)
  assert.match(payload, /asset\.review/)
  assert.match(payload, /astro\.library\.outcome/)
  assert.match(payload, /accepted/)
  assert.match(payload, /rejected/)
  assert.doesNotMatch(payload, /Server\.LibraryService\.page/)
  assert.doesNotMatch(payload, /Server\.LibraryService\.detail/)
  assert.doesNotMatch(payload, /private-query-text/)
  assert.doesNotMatch(payload, new RegExp(assetId))
  assert.doesNotMatch(payload, /owner-chicks/)
  assert.doesNotMatch(payload, /desktop-owner/)
  assert.doesNotMatch(payload, /PRIVATE_REVIEW_ANNOTATION/)
  assert.doesNotMatch(payload, /PRIVATE_STALE_REVIEW_ANNOTATION/)
  assert.doesNotMatch(payload, /private-library-review-key/)
  assert.doesNotMatch(payload, /private-library-stale-review-key/)
  assert.doesNotMatch(payload, /m27-stack-/)
  assert.doesNotMatch(payload, /run-m27-001/)
  assert.doesNotMatch(payload, /solve-m27-001/)
  assert.doesNotMatch(payload, /\.fits/)
})

test('Process HTTP flows export one safe Project boundary each', async () => {
  const collector = await openOtlpTestCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${collector.url}/v1/metrics`,
      OTEL_SERVICE_NAME: 'astro-console-process-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
      OTEL_METRIC_EXPORT_INTERVAL: '60000',
    }),
  })
  const sourceAssetId = 'asset-m27-006'
  const createIntentId = 'private-project-create-intent'
  try {
    await telemetry.initialize()
    const service = await openOriginTestApplicationForDatabase(
      ':memory:',
      { fixture: 'm27' },
      Layer.mergeAll(
        originTelemetryServicesLayer(telemetry),
        originProcessWorkBehaviorLayer({ autoRun: true }),
      ),
    )
    try {
      const listener = await service.listen()
      try {
        const base = `http://127.0.0.1:${listener.port}`
        const listResponse = await fetch(`${base}/api/process/projects`)
        assert.equal(listResponse.status, 200)
        await listResponse.body?.cancel()

        const acceptedResponse = await fetch(`${base}/api/process/projects`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Private Project name',
            selection: { assetIds: [sourceAssetId], captureSetIds: [] },
            intentId: createIntentId,
          }),
        })
        assert.equal(acceptedResponse.status, 201)
        const created = Schema.decodeUnknownSync(
          Schema.Struct({
            project: Schema.Struct({
              projectId: ProcessingProjectId,
              revision: Schema.Int,
            }),
          }),
        )(await acceptedResponse.json())

        const runResponse = await fetch(
          `${base}/api/process/projects/${created.project.projectId}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              projectId: created.project.projectId,
              expectedProjectRevision: created.project.revision,
              intentId: 'private-process-run-intent',
              intent: {
                _tag: 'RunStage',
                stage: 'Calibration',
                from: { _tag: 'CurrentDraft' },
              },
            }),
          },
        )
        assert.equal(runResponse.status, 200)
        await runResponse.body?.cancel()
        const lifecycle = Context.get(
          service.context,
          ProcessingProjectLifecycle,
        )
        let completed = false
        for (let attempt = 0; attempt < 20 && !completed; attempt += 1) {
          const opened = await telemetry.runPromise(
            lifecycle.open(
              {
                personId: 'owner-chicks',
                clientId: 'desktop-owner',
                role: 'owner',
                capability: 'controlCapable',
              },
              created.project.projectId,
            ),
          )
          completed = opened.stages.some(
            (stage) => stage.currentResult?.outcome === 'Succeeded',
          )
          if (!completed) await Effect.runPromise(Effect.sleep('25 millis'))
        }
        assert.equal(completed, true)

        const rejectedResponse = await fetch(
          `${base}/api/process/projects/private-project-id`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ privateBody: 'PRIVATE_PROCESS_BODY' }),
          },
        )
        assert.equal(rejectedResponse.status, 400)
        await rejectedResponse.body?.cancel()
      } finally {
        await listener.close()
      }
    } finally {
      await service.close()
    }
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'Process.project.read'), 1)
  assert.equal(textOccurrences(payload, 'Process.project.change'), 3)
  assert.match(payload, /Process\.worker\.execute/)
  assert.match(payload, /astro\.process\.backlog\.count/)
  assert.match(payload, /astro\.process\.pressure/)
  assert.match(payload, /astro\.sqlite\.backlog/)
  assert.equal(textOccurrences(payload, 'HTTP GET /api/process/projects'), 1)
  assert.equal(textOccurrences(payload, 'HTTP POST /api/process/projects'), 1)
  assert.equal(
    textOccurrences(payload, 'HTTP PATCH /api/process/projects/:projectId'),
    2,
  )
  assert.match(payload, /astro\.workspace/)
  assert.match(payload, /astro\.process\.operation/)
  assert.match(payload, /project\.read/)
  assert.match(payload, /project\.change/)
  assert.match(payload, /astro\.process\.outcome/)
  assert.match(payload, /accepted/)
  assert.match(payload, /rejected/)
  assert.doesNotMatch(payload, new RegExp(sourceAssetId))
  assert.doesNotMatch(payload, /owner-chicks/)
  assert.doesNotMatch(payload, /desktop-owner/)
  assert.doesNotMatch(payload, new RegExp(createIntentId))
  assert.doesNotMatch(payload, /Private Project name/)
  assert.doesNotMatch(payload, /private-project-id/)
  assert.doesNotMatch(payload, /PRIVATE_PROCESS_BODY/)
  assert.doesNotMatch(payload, /intentId/)
  assert.doesNotMatch(payload, /assetIds/)
})

function textOccurrences(text: string, value: string) {
  return text.split(value).length - 1
}

function otlpMetricUnits(payload: Uint8Array) {
  const units = new Map<string, string>()
  for (const resourceMetrics of protobufMessages(payload, 1))
    for (const scopeMetrics of protobufMessages(resourceMetrics, 2))
      for (const metric of protobufMessages(scopeMetrics, 2)) {
        const name = protobufString(metric, 1)
        const unit = protobufString(metric, 3)
        if (name !== undefined && unit !== undefined) units.set(name, unit)
      }
  return units
}

function otlpHistogramAttributeKeys(payload: Uint8Array, metricName: string) {
  const keys = new Set<string>()
  for (const resourceMetrics of protobufMessages(payload, 1))
    for (const scopeMetrics of protobufMessages(resourceMetrics, 2))
      for (const metric of protobufMessages(scopeMetrics, 2)) {
        if (protobufString(metric, 1) !== metricName) continue
        for (const histogram of protobufMessages(metric, 9))
          for (const point of protobufMessages(histogram, 1))
            for (const attribute of protobufMessages(point, 9)) {
              const key = protobufString(attribute, 1)
              if (key !== undefined) keys.add(key)
            }
      }
  return keys
}

function protobufMessages(bytes: Uint8Array, fieldNumber: number) {
  return protobufFields(bytes)
    .filter(
      (field) => field.number === fieldNumber && field.bytes !== undefined,
    )
    .flatMap((field) => (field.bytes === undefined ? [] : [field.bytes]))
}

function protobufString(bytes: Uint8Array, fieldNumber: number) {
  const value = protobufMessages(bytes, fieldNumber)[0]
  return value === undefined ? undefined : new TextDecoder().decode(value)
}

function protobufFields(bytes: Uint8Array) {
  const fields: Array<{
    readonly number: number
    readonly bytes?: Uint8Array
  }> = []
  let offset = 0
  while (offset < bytes.length) {
    const tag = protobufVarint(bytes, offset)
    offset = tag.next
    const wireType = tag.value & 7
    const number = tag.value >>> 3
    if (wireType === 2) {
      const length = protobufVarint(bytes, offset)
      offset = length.next
      const end = offset + length.value
      if (end > bytes.length) throw new Error('Invalid OTLP protobuf length')
      fields.push({ number, bytes: bytes.slice(offset, end) })
      offset = end
    } else if (wireType === 0) {
      offset = protobufVarint(bytes, offset).next
    } else if (wireType === 1) {
      offset += 8
    } else if (wireType === 5) {
      offset += 4
    } else {
      throw new Error(`Unsupported OTLP protobuf wire type ${wireType}`)
    }
  }
  return fields
}

function protobufVarint(bytes: Uint8Array, offset: number) {
  let value = 0
  let shift = 0
  while (offset < bytes.length && shift < 35) {
    const byte = bytes[offset]
    if (byte === undefined) break
    value += (byte & 0x7f) * 2 ** shift
    offset += 1
    if ((byte & 0x80) === 0) return { value, next: offset }
    shift += 7
  }
  throw new Error('Invalid OTLP protobuf varint')
}

function recordedImageBytes() {
  const bytes = new Uint8Array(52)
  const view = new DataView(bytes.buffer)
  for (const [index, value] of [1, 0, 0, 0, 44, 2, 8, 2, 2, 2, 0].entries())
    view.setUint32(index * 4, value, true)
  for (const [index, value] of [0, 20_000, 40_000, 65_535].entries())
    view.setUint16(44 + index * 2, value, true)
  return bytes
}
