import {
  constants,
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
} from 'node:perf_hooks'
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8'
import { Effect, Metric } from 'effect'

export type NodeRuntimeGcType = 'major' | 'minor' | 'incremental' | 'weakcb'

export type NodeRuntimeSample = {
  readonly eventLoopUtilization: number
  readonly eventLoopDelaySeconds: {
    readonly min: number
    readonly max: number
    readonly mean: number
    readonly stddev: number
    readonly p50: number
    readonly p90: number
    readonly p99: number
  }
  readonly heapSpaces: ReadonlyArray<{
    readonly name: string
    readonly usedBytes: number
  }>
  readonly heapLimitBytes: number
}

export type NodeRuntimeSampleSource = {
  readonly start: (
    recordGc: (type: NodeRuntimeGcType, durationSeconds: number) => void,
  ) => void
  readonly sample: () => NodeRuntimeSample
  readonly stop: () => void
}

export type NodeRuntimeScheduler = (tick: () => void) => () => void

export type NodeRuntimeTelemetryOptions = {
  readonly source?: NodeRuntimeSampleSource
  readonly schedule?: NodeRuntimeScheduler
}

export type NodeRuntimeTelemetry = {
  readonly start: (
    runSync: (effect: Effect.Effect<void, never>) => void,
  ) => void
  readonly stop: () => void
}

const eventLoopUtilization = Metric.gauge('nodejs.eventloop.utilization', {
  description: 'Node.js event loop utilization',
  attributes: { unit: '1' },
})

const eventLoopDelayMetrics = {
  min: Metric.gauge('nodejs.eventloop.delay.min', {
    description: 'Minimum Node.js event loop delay in seconds',
    attributes: { unit: 's' },
  }),
  max: Metric.gauge('nodejs.eventloop.delay.max', {
    description: 'Maximum Node.js event loop delay in seconds',
    attributes: { unit: 's' },
  }),
  mean: Metric.gauge('nodejs.eventloop.delay.mean', {
    description: 'Mean Node.js event loop delay in seconds',
    attributes: { unit: 's' },
  }),
  stddev: Metric.gauge('nodejs.eventloop.delay.stddev', {
    description: 'Node.js event loop delay standard deviation in seconds',
    attributes: { unit: 's' },
  }),
  p50: Metric.gauge('nodejs.eventloop.delay.p50', {
    description: '50th percentile Node.js event loop delay in seconds',
    attributes: { unit: 's' },
  }),
  p90: Metric.gauge('nodejs.eventloop.delay.p90', {
    description: '90th percentile Node.js event loop delay in seconds',
    attributes: { unit: 's' },
  }),
  p99: Metric.gauge('nodejs.eventloop.delay.p99', {
    description: '99th percentile Node.js event loop delay in seconds',
    attributes: { unit: 's' },
  }),
} as const

const heapUsed = Metric.gauge('v8js.memory.heap.used', {
  description: 'V8 heap space memory used in bytes',
  attributes: { unit: 'By' },
})
const heapLimit = Metric.gauge('v8js.memory.heap.limit', {
  description: 'V8 heap memory limit in bytes',
  attributes: { unit: 'By' },
})
const gcDuration = Metric.histogram('v8js.gc.duration', {
  description: 'V8 garbage collection duration in seconds',
  attributes: { unit: 's' },
  boundaries: [
    0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
  ],
})

/**
 * Samples Node runtime state into the Effect metric registry owned by the
 * caller. It does not create a tracer, logger, exporter, or background Effect
 * runtime.
 */
export function createNodeRuntimeTelemetry(
  options: NodeRuntimeTelemetryOptions = {},
): NodeRuntimeTelemetry {
  let running = false
  let source: NodeRuntimeSampleSource | undefined
  let cancelSchedule: (() => void) | undefined

  return {
    start(runSync) {
      if (running) return
      running = true
      source = options.source ?? createNodeRuntimeSampleSource()

      const record = (effect: Effect.Effect<void, never>) => {
        if (running) runSync(effect)
      }
      try {
        source.start((type, durationSeconds) =>
          record(recordNodeRuntimeGc(type, durationSeconds)),
        )
        cancelSchedule = (options.schedule ?? scheduleNodeRuntimeSample)(() => {
          if (running && source !== undefined)
            record(recordNodeRuntimeSample(source.sample()))
        })
      } catch (error) {
        running = false
        source.stop()
        source = undefined
        throw error
      }
    },
    stop() {
      if (!running) return
      running = false
      cancelSchedule?.()
      cancelSchedule = undefined
      source?.stop()
      source = undefined
    },
  }
}

export function recordNodeRuntimeSample(sample: NodeRuntimeSample) {
  return Effect.all([
    Metric.update(
      eventLoopUtilization,
      finiteNonNegative(sample.eventLoopUtilization),
    ),
    Metric.update(
      eventLoopDelayMetrics.min,
      finiteNonNegative(sample.eventLoopDelaySeconds.min),
    ),
    Metric.update(
      eventLoopDelayMetrics.max,
      finiteNonNegative(sample.eventLoopDelaySeconds.max),
    ),
    Metric.update(
      eventLoopDelayMetrics.mean,
      finiteNonNegative(sample.eventLoopDelaySeconds.mean),
    ),
    Metric.update(
      eventLoopDelayMetrics.stddev,
      finiteNonNegative(sample.eventLoopDelaySeconds.stddev),
    ),
    Metric.update(
      eventLoopDelayMetrics.p50,
      finiteNonNegative(sample.eventLoopDelaySeconds.p50),
    ),
    Metric.update(
      eventLoopDelayMetrics.p90,
      finiteNonNegative(sample.eventLoopDelaySeconds.p90),
    ),
    Metric.update(
      eventLoopDelayMetrics.p99,
      finiteNonNegative(sample.eventLoopDelaySeconds.p99),
    ),
    ...sample.heapSpaces.map(({ name, usedBytes }) =>
      Metric.update(
        Metric.withAttributes(heapUsed, { 'v8js.heap.space.name': name }),
        finiteNonNegative(usedBytes),
      ),
    ),
    Metric.update(heapLimit, finiteNonNegative(sample.heapLimitBytes)),
  ]).pipe(Effect.asVoid)
}

export function recordNodeRuntimeGc(
  type: NodeRuntimeGcType,
  durationSeconds: number,
) {
  return Metric.update(
    Metric.withAttributes(gcDuration, { 'v8js.gc.type': type }),
    finiteNonNegative(durationSeconds),
  )
}

function createNodeRuntimeSampleSource(): NodeRuntimeSampleSource {
  const delay = monitorEventLoopDelay({ resolution: 20 })
  let previousUtilization = performance.eventLoopUtilization()
  let observer: PerformanceObserver | undefined

  return {
    start(recordGc) {
      previousUtilization = performance.eventLoopUtilization()
      delay.enable()
      observer = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          const type = gcType(performanceEntryGcKind(entry))
          if (type !== undefined)
            recordGc(type, finiteNonNegative(entry.duration) / 1_000)
        }
      })
      observer.observe({ entryTypes: ['gc'] })
    },
    sample() {
      const currentUtilization = performance.eventLoopUtilization()
      const intervalUtilization = performance.eventLoopUtilization(
        currentUtilization,
        previousUtilization,
      )
      previousUtilization = currentUtilization
      const hasDelaySamples = delay.count > 0
      const sample: NodeRuntimeSample = {
        eventLoopUtilization: intervalUtilization.utilization,
        eventLoopDelaySeconds: {
          min: hasDelaySamples ? nanosecondsToSeconds(delay.min) : 0,
          max: hasDelaySamples ? nanosecondsToSeconds(delay.max) : 0,
          mean: hasDelaySamples ? nanosecondsToSeconds(delay.mean) : 0,
          stddev: hasDelaySamples ? nanosecondsToSeconds(delay.stddev) : 0,
          p50: hasDelaySamples ? nanosecondsToSeconds(delay.percentile(50)) : 0,
          p90: hasDelaySamples ? nanosecondsToSeconds(delay.percentile(90)) : 0,
          p99: hasDelaySamples ? nanosecondsToSeconds(delay.percentile(99)) : 0,
        },
        heapSpaces: getHeapSpaceStatistics().map((space) => ({
          name: space.space_name,
          usedBytes: space.space_used_size,
        })),
        heapLimitBytes: getHeapStatistics().heap_size_limit,
      }
      delay.reset()
      return sample
    },
    stop() {
      observer?.disconnect()
      observer = undefined
      delay.disable()
    },
  }
}

function scheduleNodeRuntimeSample(tick: () => void) {
  const interval = setInterval(tick, 10_000)
  interval.unref()
  return () => clearInterval(interval)
}

function gcType(kind: unknown): NodeRuntimeGcType | undefined {
  switch (kind) {
    case constants.NODE_PERFORMANCE_GC_MAJOR:
      return 'major'
    case constants.NODE_PERFORMANCE_GC_MINOR:
      return 'minor'
    case constants.NODE_PERFORMANCE_GC_INCREMENTAL:
      return 'incremental'
    case constants.NODE_PERFORMANCE_GC_WEAKCB:
      return 'weakcb'
    default:
      return undefined
  }
}

function performanceEntryGcKind(entry: PerformanceEntry): unknown {
  if (
    !('detail' in entry) ||
    typeof entry.detail !== 'object' ||
    entry.detail === null
  )
    return undefined
  return Reflect.get(entry.detail, 'kind')
}

function nanosecondsToSeconds(value: number) {
  return finiteNonNegative(value) / 1_000_000_000
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}
