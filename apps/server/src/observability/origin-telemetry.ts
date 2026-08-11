import {
  Config,
  ConfigProvider,
  Effect,
  Layer,
  ManagedRuntime,
  Schema,
} from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { Otlp } from 'effect/unstable/observability'
import {
  createNodeRuntimeTelemetry,
  type NodeRuntimeTelemetryOptions,
} from './node-runtime-telemetry.ts'
import { recordOperationalEvent } from './operational-telemetry.ts'
import { otlpProtobufSerialization } from './otlp-serialization.ts'

export type OriginTelemetry = {
  readonly initialize: () => Promise<void>
  readonly runSync: <A, E>(effect: Effect.Effect<A, E>) => A
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
  readonly dispose: () => Promise<void>
}

export type OriginTelemetryOptions = {
  readonly configProvider?: ConfigProvider.ConfigProvider
  readonly nodeRuntimeTelemetry?: NodeRuntimeTelemetryOptions | false
}

const metricsExporterEnabled = Config.all({
  disabled: Config.boolean('OTEL_SDK_DISABLED').pipe(Config.withDefault(false)),
  endpoint: Config.url('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT').pipe(
    Config.orElse(() => Config.url('OTEL_EXPORTER_OTLP_ENDPOINT')),
    Config.withDefault(undefined),
  ),
  exporters: Config.schema(
    Config.Array(Schema.String),
    'OTEL_METRICS_EXPORTER',
  ).pipe(
    Config.map((exporters) =>
      exporters.map((exporter) => exporter.toLowerCase().trim()),
    ),
    Config.withDefault<ReadonlyArray<string>>([]),
  ),
}).pipe(
  Config.map(
    ({ disabled, endpoint, exporters }) =>
      !disabled && endpoint !== undefined && exporters.includes('otlp'),
  ),
)

/**
 * One process-owned Effect runtime for OTLP/HTTP protobuf telemetry.
 *
 * Effect's OTLP layer reads the standard OTEL_* environment variables. Each
 * OTEL_*_EXPORTER signal remains independently opt-in.
 */
export function createOriginTelemetry(
  options: OriginTelemetryOptions = {},
): OriginTelemetry {
  const telemetry = Otlp.layerFromConfig({
    loggerExcludeLogSpans: true,
  }).pipe(
    Layer.provide(otlpProtobufSerialization),
    Layer.provide(FetchHttpClient.layer),
    options.configProvider === undefined
      ? (layer) => layer
      : Layer.provide(ConfigProvider.layer(options.configProvider)),
  )
  const runtime = ManagedRuntime.make(telemetry)
  const nodeRuntime =
    options.nodeRuntimeTelemetry === false
      ? undefined
      : createNodeRuntimeTelemetry(options.nodeRuntimeTelemetry)
  const configProvider = options.configProvider ?? ConfigProvider.fromEnv()
  let initializePromise: Promise<void> | undefined

  const initialize = () => {
    initializePromise ??= (async () => {
      await runtime.context()
      const enabled = await Effect.runPromise(
        metricsExporterEnabled.parse(configProvider),
      )
      if (enabled)
        nodeRuntime?.start((effect) => {
          runtime.runSync(effect)
        })
    })()
    return initializePromise
  }

  return {
    initialize,
    runSync: (effect) => runtime.runSync(effect),
    runPromise: (effect) => runtime.runPromise(effect),
    dispose: () => {
      nodeRuntime?.stop()
      return runtime.dispose()
    },
  }
}

export const defaultOriginTelemetry: OriginTelemetry = {
  initialize: () => Promise.resolve(),
  runSync: (effect) => Effect.runSync(effect),
  runPromise: (effect) => Effect.runPromise(effect),
  dispose: () => Promise.resolve(),
}

export function tracedHttpRequest<A, E>(
  response: { readonly statusCode: number; readonly headersSent?: boolean },
  input: {
    readonly method: 'GET' | 'POST' | 'PATCH'
    readonly route: string
    readonly workspace:
      | 'acquire'
      | 'control'
      | 'library'
      | 'observe'
      | 'plan'
      | 'process'
      | 'projection'
  },
  effect: Effect.Effect<A, E>,
) {
  const responseSignals = Effect.suspend(() => {
    const outcome =
      response.headersSent !== true || response.statusCode >= 500
        ? 'unavailable'
        : response.statusCode >= 200 && response.statusCode < 400
          ? 'accepted'
          : 'rejected'
    return Effect.all([
      response.headersSent === true
        ? Effect.annotateCurrentSpan({
            'http.response.status_code': response.statusCode,
          })
        : Effect.void,
      recordOperationalEvent({ scope: 'http', operation: 'request', outcome }),
    ]).pipe(Effect.asVoid)
  })
  return effect.pipe(
    Effect.tap(() => responseSignals),
    Effect.tapError(() => responseSignals),
    Effect.withSpan(`HTTP ${input.method} ${input.route}`, {
      kind: 'server',
      attributes: {
        'http.request.method': input.method,
        'http.route': input.route,
        'astro.workspace': input.workspace,
      },
    }),
  )
}
