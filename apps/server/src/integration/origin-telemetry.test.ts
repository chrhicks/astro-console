import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { ConfigProvider, Effect, Schema } from 'effect'
import { createLocalWebService } from '../app/origin-service.ts'
import { createOriginTelemetry } from '../observability/origin-telemetry.ts'
import { alpacaCameraProvider } from '../providers/alpaca-camera-provider.ts'
import { alpacaPreflightProvider } from '../providers/alpaca-preflight-provider.ts'

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

test('Alpaca operations export safe child spans without changing requests', async () => {
  const collector = await testCollector()
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
  const collector = await testCollector()
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
    const service = createLocalWebService(
      ':memory:',
      undefined,
      undefined,
      undefined,
      { fixture: 'm27', telemetry },
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
      service.close()
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
  const collector = await testCollector()
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
    const service = createLocalWebService(
      ':memory:',
      undefined,
      undefined,
      undefined,
      { fixture: 'm27', telemetry },
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
      service.close()
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
  const collector = await testCollector()
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
    const service = createLocalWebService(
      ':memory:',
      undefined,
      undefined,
      undefined,
      { fixture: 'm27', telemetry },
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
      service.close()
    }
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'Library.catalog.page'), 1)
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

test('Process HTTP flows export one safe business boundary each', async () => {
  const collector = await testCollector()
  const telemetry = createOriginTelemetry({
    configProvider: ConfigProvider.fromUnknown({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
      OTEL_SERVICE_NAME: 'astro-console-process-test',
      OTEL_BSP_SCHEDULE_DELAY: '60000',
    }),
  })
  const sourceAssetId = 'asset-m27-006'
  const acceptedCommandId = 'private-process-command-id'
  const acceptedIdempotencyKey = 'private-process-idempotency-key'
  const rejectedCommandId = 'private-invalid-process-command-id'
  try {
    await telemetry.initialize()
    const service = createLocalWebService(
      ':memory:',
      undefined,
      undefined,
      undefined,
      { fixture: 'm27', telemetry },
    )
    try {
      const listener = await service.listen()
      try {
        const base = `http://127.0.0.1:${listener.port}`
        const openResponse = await fetch(
          `${base}/api/workspaces/process?sourceAssetId=${sourceAssetId}`,
        )
        assert.equal(openResponse.status, 200)
        const handoff = Schema.decodeUnknownSync(
          Schema.Struct({
            sourceAssetId: Schema.String,
            revision: Schema.Number,
          }),
        )(await openResponse.json())
        assert.equal(handoff.sourceAssetId, sourceAssetId)

        const acceptedResponse = await fetch(`${base}/api/process/commands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commandId: acceptedCommandId,
            command: {
              _tag: 'StartProcessingSession',
              sourceAssetIds: [sourceAssetId],
              idempotencyKey: acceptedIdempotencyKey,
            },
          }),
        })
        assert.equal(acceptedResponse.status, 202)
        await acceptedResponse.body?.cancel()

        const rejectedResponse = await fetch(`${base}/api/process/commands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commandId: rejectedCommandId,
            command: {
              _tag: 'PrivateInvalidProcessCommand',
              privateBody: 'PRIVATE_PROCESS_BODY',
            },
          }),
        })
        assert.equal(rejectedResponse.status, 409)
        await rejectedResponse.body?.cancel()
      } finally {
        await listener.close()
      }
    } finally {
      service.close()
    }
  } finally {
    await telemetry.dispose()
    await collector.close()
  }

  const payload = Buffer.concat(
    collector.requests.map((request) => request.body),
  ).toString('utf8')
  assert.equal(textOccurrences(payload, 'Process.workspace.open'), 1)
  assert.equal(textOccurrences(payload, 'Process.command.execute'), 2)
  assert.equal(textOccurrences(payload, 'HTTP GET /api/workspaces/process'), 1)
  assert.equal(textOccurrences(payload, 'HTTP POST /api/process/commands'), 2)
  assert.match(payload, /astro\.workspace/)
  assert.match(payload, /astro\.process\.operation/)
  assert.match(payload, /workspace\.open/)
  assert.match(payload, /command\.execute/)
  assert.match(payload, /astro\.process\.outcome/)
  assert.match(payload, /accepted/)
  assert.match(payload, /rejected/)
  assert.equal(textOccurrences(payload, 'astro.command.intent'), 1)
  assert.equal(textOccurrences(payload, 'StartProcessingSession'), 1)
  assert.doesNotMatch(payload, /Server\.LibraryService\.processSource/)
  assert.doesNotMatch(payload, new RegExp(sourceAssetId))
  assert.doesNotMatch(payload, /owner-chicks/)
  assert.doesNotMatch(payload, /desktop-owner/)
  assert.doesNotMatch(payload, new RegExp(acceptedCommandId))
  assert.doesNotMatch(payload, new RegExp(rejectedCommandId))
  assert.doesNotMatch(payload, new RegExp(acceptedIdempotencyKey))
  assert.doesNotMatch(payload, /PrivateInvalidProcessCommand/)
  assert.doesNotMatch(payload, /PRIVATE_PROCESS_BODY/)
  assert.doesNotMatch(payload, /commandId/)
  assert.doesNotMatch(payload, /sourceAssetIds/)
  assert.doesNotMatch(payload, /idempotencyKey/)
  assert.doesNotMatch(payload, /session-private-process-command-id/)
  assert.doesNotMatch(payload, /m27-stack-/)
  assert.doesNotMatch(payload, /run-m27-001/)
  assert.doesNotMatch(payload, /solve-m27-001/)
  assert.doesNotMatch(payload, /cameraRaw/)
})

function textOccurrences(text: string, value: string) {
  return text.split(value).length - 1
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
