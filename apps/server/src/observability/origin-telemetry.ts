import { ConfigProvider, Effect, Layer, ManagedRuntime } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { OtlpSerialization, OtlpTracer } from 'effect/unstable/observability'

export type OriginTelemetry = {
  readonly initialize: () => Promise<void>
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
  readonly dispose: () => Promise<void>
}

export type OriginTelemetryOptions = {
  readonly configProvider?: ConfigProvider.ConfigProvider
}

/**
 * One process-owned Effect runtime for OTLP/HTTP protobuf traces.
 *
 * Effect's OTLP layer reads the standard OTEL_* environment variables. When
 * OTEL_TRACES_EXPORTER is not `otlp`, the runtime keeps Effect's default tracer
 * and performs no export.
 */
export function createOriginTelemetry(
  options: OriginTelemetryOptions = {},
): OriginTelemetry {
  const tracer = OtlpTracer.layerFromConfig().pipe(
    Layer.provide(OtlpSerialization.layerProtobuf),
    Layer.provide(FetchHttpClient.layer),
    options.configProvider === undefined
      ? (layer) => layer
      : Layer.provide(ConfigProvider.layer(options.configProvider)),
  )
  const runtime = ManagedRuntime.make(tracer)
  return {
    initialize: () => runtime.context().then(() => undefined),
    runPromise: (effect) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  }
}

export const defaultOriginTelemetry: OriginTelemetry = {
  initialize: () => Promise.resolve(),
  runPromise: (effect) => Effect.runPromise(effect),
  dispose: () => Promise.resolve(),
}

export function tracedHttpRequest<A, E>(
  response: { readonly statusCode: number; readonly headersSent?: boolean },
  input: {
    readonly method: 'GET' | 'POST'
    readonly route: string
    readonly workspace:
      'acquire' | 'control' | 'library' | 'observe' | 'plan' | 'process'
  },
  effect: Effect.Effect<A, E>,
) {
  const responseAttributes = Effect.suspend(() =>
    response.headersSent === true
      ? Effect.annotateCurrentSpan({
          'http.response.status_code': response.statusCode,
        })
      : Effect.void,
  )
  return effect.pipe(
    Effect.tap(() => responseAttributes),
    Effect.tapError(() => responseAttributes),
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
