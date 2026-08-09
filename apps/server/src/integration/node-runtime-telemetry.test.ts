import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect } from 'effect'
import {
  createNodeRuntimeTelemetry,
  type NodeRuntimeGcType,
  type NodeRuntimeSampleSource,
} from '../observability/node-runtime-telemetry.ts'

test('Node runtime sampling has deterministic start, tick, and stop lifecycle', () => {
  let starts = 0
  let stops = 0
  let cancelSchedule = 0
  let recordedEffects = 0
  let tick: (() => void) | undefined
  let recordGc:
    ((type: NodeRuntimeGcType, durationSeconds: number) => void) | undefined

  const source: NodeRuntimeSampleSource = {
    start(record) {
      starts += 1
      recordGc = record
    },
    sample: () => ({
      eventLoopUtilization: 0.25,
      eventLoopDelaySeconds: {
        min: 0.001,
        max: 0.009,
        mean: 0.003,
        stddev: 0.002,
        p50: 0.002,
        p90: 0.006,
        p99: 0.008,
      },
      heapSpaces: [{ name: 'old_space', usedBytes: 1_024 }],
      heapLimitBytes: 4_096,
    }),
    stop() {
      stops += 1
    },
  }
  const telemetry = createNodeRuntimeTelemetry({
    source,
    schedule: (scheduledTick) => {
      tick = scheduledTick
      return () => {
        cancelSchedule += 1
      }
    },
  })

  telemetry.start((effect) => {
    recordedEffects += 1
    Effect.runSync(effect)
  })
  telemetry.start(() => {
    throw new Error('duplicate start must be ignored')
  })
  assert.equal(starts, 1)
  assert.equal(recordedEffects, 0)

  tick?.()
  recordGc?.('major', 0.012)
  assert.equal(recordedEffects, 2)

  telemetry.stop()
  telemetry.stop()
  assert.equal(stops, 1)
  assert.equal(cancelSchedule, 1)

  tick?.()
  recordGc?.('minor', 0.004)
  assert.equal(recordedEffects, 2)
})
