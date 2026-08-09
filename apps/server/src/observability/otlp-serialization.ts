import { Effect, Layer } from 'effect'
import { OtlpMetrics, OtlpSerialization } from 'effect/unstable/observability'

/**
 * Effect uses `unit` and `time_unit` as internal metric attributes when it
 * builds OTLP metric unit metadata. Its protobuf exporter currently also
 * copies them to every data point. Remove only those internal labels before
 * serialization; the metric-level unit field is already populated.
 */
export const otlpProtobufSerialization = Layer.effect(
  OtlpSerialization.OtlpSerialization,
  Effect.gen(function* () {
    const protobuf = yield* OtlpSerialization.OtlpSerialization
    return OtlpSerialization.OtlpSerialization.of({
      traces: protobuf.traces,
      logs: protobuf.logs,
      metrics: (data) => protobuf.metrics(stripInternalMetricLabels(data)),
    })
  }),
).pipe(Layer.provide(OtlpSerialization.layerProtobuf))

function stripInternalMetricLabels(data: OtlpMetrics.MetricsData) {
  for (const resource of data.resourceMetrics)
    for (const scope of resource.scopeMetrics)
      for (const metric of scope.metrics) {
        stripPointLabels(metric.gauge?.dataPoints)
        stripPointLabels(metric.sum?.dataPoints)
        stripPointLabels(metric.histogram?.dataPoints)
        stripPointLabels(metric.exponentialHistogram?.dataPoints)
        stripPointLabels(metric.summary?.dataPoints)
      }
  return data
}

function stripPointLabels(
  points:
    | ReadonlyArray<{
        readonly attributes?: Array<{ readonly key: string }>
      }>
    | undefined,
) {
  if (points === undefined) return
  for (const point of points) {
    const attributes = point.attributes
    if (attributes === undefined) continue
    for (let index = attributes.length - 1; index >= 0; index -= 1) {
      const key = attributes[index]?.key
      if (key === 'unit' || key === 'time_unit') attributes.splice(index, 1)
    }
  }
}
