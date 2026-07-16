import { Effect, Result } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { OperationCoordinator, type OperationLease } from '../session/operation-coordinator'
import { AggregateStore } from '../state/aggregate-store'
import type { DeviceSession } from '../device/device-plugin'
import { FrameStorage } from '../storage/frame-storage'
import { captureExternalFrame } from './external-exposure'
import type { ExternalSequencePlan, ExternalSequenceProjection } from '../../../shared/api-v2'
import { isExternalSequenceTerminal } from '../../../shared/lifecycle'
import { HardwareWorkers } from '../runtime/hardware-workers'

export const MAX_SEQUENCE_LIGHTS = 360
export const MAX_SEQUENCE_DARKS = 360

export const runConfigureExternalSequence = (plan: ExternalSequencePlan) =>
  Effect.gen(function* () {
    if (!isPlanValid(plan)) return yield* Effect.fail(new Error('Sequence requires 1–360 lights, 0–360 darks, and a duration up to 3600 seconds'))
    const bus = yield* EventBus
    const sessions = yield* SessionManager
    const session = yield* sessions.getCurrent
    if (!hasExternalCapture(session)) {
      return yield* Effect.fail(new Error('Connect a rig with an external camera before configuring a sequence'))
    }
    if (plan.darkCount > 0 && !session.rig.camera?.startDarkExposure) {
      return yield* Effect.fail(new Error('Connected rig does not support dark exposures'))
    }
    const coordinator = yield* OperationCoordinator
    const updated = yield* Effect.acquireUseRelease(
      coordinator.acquire(session, 'sequence').pipe(
        Effect.flatMap((lease) =>
          lease
            ? Effect.succeed(lease)
            : Effect.fail(new Error('Another operation is active')),
        ),
      ),
      (lease) => coordinator.commitIfLease(lease, (current) => {
        if (!isExternalSequenceTerminal(current.sequence.phase)) return current
        return {
          ...current,
          sequence: { phase: 'idle', plan: Object.freeze({ ...plan }), completed: 0, failed: 0 },
        }
      }),
      (lease) => coordinator.release(lease),
    )
    if (!updated || !isExternalSequenceTerminal(updated.sequence.phase)) {
      return yield* Effect.fail(new Error('Sequence is active and cannot be reconfigured'))
    }
    yield* bus.publish('sequence.configured', {})
  })

export const runStartExternalSequence = Effect.gen(function* () {
  const store = yield* AggregateStore
  const sessions = yield* SessionManager
  const session = yield* sessions.getCurrent
  if (!session) return yield* Effect.fail(new Error('Connect a rig with an external camera before starting a sequence'))
  yield* launchSequencePhase(session, 'sequence', 'light', (current) => {
    const plan = current.sequence.plan
    if (!hasExternalCapture(session) || !current.currentTarget || !plan || !isPlanValid(plan) || current.sequence.phase !== 'idle') return null
    if (plan.darkCount > 0 && !session.rig.camera?.startDarkExposure) return null
    return { plan: Object.freeze({ ...plan }), target: current.currentTarget }
  }, 'Sequence is not ready to start')
})

export const runContinueExternalSequence = Effect.gen(function* () {
  const store = yield* AggregateStore
  const sessions = yield* SessionManager
  const session = yield* sessions.getCurrent
  if (!hasExternalCapture(session)) {
    return yield* Effect.fail(new Error('Dark confirmation is not available'))
  }
  yield* launchSequencePhase(session, 'sequence-continue', 'dark', (current) => {
    const plan = current.sequence.plan
    if (!hasExternalCapture(session) || !plan || current.sequence.phase !== 'awaiting-darks' || !current.sequence.target || !session.rig.camera?.startDarkExposure) return null
    return { plan: Object.freeze({ ...plan }), target: current.sequence.target }
  }, 'Dark confirmation is not available')
})

function launchSequencePhase(
  session: DeviceSession,
  kind: 'sequence' | 'sequence-continue',
  frameKind: 'light' | 'dark',
  prepare: (current: import('../state/aggregate').SessionAggregate) => { plan: ExternalSequencePlan; target: NonNullable<ExternalSequenceProjection['target']> } | null,
  error: string,
) {
  let handedOff = false
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const coordinator = yield* OperationCoordinator
      const lease = yield* coordinator.acquire(session, kind)
      if (!lease) return yield* Effect.fail(new Error('Another operation is active'))
      return lease
    }),
    (lease) => Effect.gen(function* () {
      const store = yield* AggregateStore
      const sessions = yield* SessionManager
      if (!(yield* sessions.ownsSession(session))) return yield* Effect.fail(new Error(error))
      const prepared = prepare(yield* store.get)
      if (!prepared) return yield* Effect.fail(new Error(error))
      const workers = yield* HardwareWorkers
      yield* Effect.uninterruptible(
        workers.launch(runSequencePhase(session, prepared.plan, prepared.target, frameKind, 1, lease)).pipe(
          Effect.tap(() => Effect.sync(() => { handedOff = true })),
        ),
      )
    }),
    (lease) => handedOff ? Effect.void : Effect.gen(function* () {
      const coordinator = yield* OperationCoordinator
      yield* coordinator.release(lease)
    }),
  )
}

export const runFinishExternalSequence = Effect.gen(function* () {
  const store = yield* AggregateStore
  const sessions = yield* SessionManager
  const session = yield* sessions.getCurrent
  if (!session) return yield* Effect.fail(new Error('No device connected'))
  const current = yield* store.get
  if (current.sequence.phase !== 'awaiting-darks') return yield* Effect.fail(new Error('Dark confirmation is not available'))
  const coordinator = yield* OperationCoordinator
  const lease = yield* coordinator.acquireRecovery(session, 'stop-capture')
  if (!lease) return
  yield* coordinator.commitIfLease(lease, (aggregate) => ({
    ...aggregate,
    sequence: { ...aggregate.sequence, phase: 'complete', frameKind: undefined, currentIndex: undefined },
  }))
  yield* coordinator.release(lease)
})

function runSequencePhase(session: DeviceSession, plan: ExternalSequencePlan, target: NonNullable<ExternalSequenceProjection['target']>, frameKind: 'light' | 'dark', startIndex: number, lease: OperationLease) {
  return Effect.gen(function* () {
    const coordinator = yield* OperationCoordinator
    yield* Effect.acquireUseRelease(Effect.void, () => Effect.gen(function* () {
      const store = yield* AggregateStore
      const storage = yield* FrameStorage
      const bus = yield* EventBus
      const sessions = yield* SessionManager
      const count = frameKind === 'light' ? plan.lightCount : plan.darkCount
      yield* storage.preflightExternalFrameStorage(plan.lightCount + plan.darkCount)
      const claimed = yield* coordinator.commitIfLease(lease, (current) => ({
        ...current,
        sequence: { ...current.sequence, phase: frameKind === 'light' ? 'lights' : 'darks', frameKind, currentIndex: startIndex, target },
      }))
      if (!claimed) return
      yield* bus.publish('capture.state.updated', { phase: 'capturing', mode: 'external' })
      for (let index = startIndex; index < startIndex + count; index++) {
        if (lease.signal.aborted) return
        const prepared = yield* coordinator.commitIfLease(lease, (current) => ({
          ...current,
          sequence: { ...current.sequence, frameKind, currentIndex: index },
          capture: { phase: 'capturing', mode: 'external', startedAt: new Date().toISOString() },
        }))
        if (!prepared || !(yield* coordinator.isCurrent(lease)) || !(yield* sessions.ownsSession(session)) || lease.signal.aborted) return
        yield* bus.publish('capture.state.updated', { phase: 'capturing', mode: 'external' })
        const captureStop = session.rig.captureStop
        if (captureStop?.mode !== 'external') return
        const camera = session.rig.camera
        if (!camera) return
        const result = yield* captureExternalFrame(camera, captureStop, {
          durationSec: plan.durationSec,
          light: frameKind === 'light',
          frameKind,
          targetShort: target.short,
          onState: (state) => coordinator.commitIfLease(lease, (current) => ({
            ...current,
            capture: { ...current.capture, deviceState: state.state },
          })).pipe(Effect.asVoid),
        }, { signal: lease.signal }).pipe(Effect.result)
        if (lease.signal.aborted) return
        if (Result.isFailure(result)) {
          yield* coordinator.commitIfLease(lease, (current) => ({
            ...current,
            capture: { phase: 'idle', mode: 'external', lastError: toErrorMessage(result.failure) },
            sequence: { ...current.sequence, failed: current.sequence.failed + 1, lastError: `Frame ${index} ${frameKind} failed: ${toErrorMessage(result.failure)}` },
          }))
          continue
        }
        const saved = result.success
        yield* coordinator.commitIfLease(lease, (current) => ({
          ...current,
          capture: { phase: saved.saved.previewError ? 'partial' : 'idle', mode: 'external', lastError: saved.saved.previewError },
          sequence: { ...current.sequence, completed: current.sequence.completed + 1 },
          library: { ...current.library, assets: [saved.asset, ...current.library.assets] },
        }))
        yield* bus.publish('capture.succeeded', {})
      }
      yield* coordinator.commitIfLease(lease, (current) => ({
        ...current,
        capture: { phase: 'idle', mode: 'external' },
        sequence: frameKind === 'light' && plan.darkCount > 0
          ? { ...current.sequence, phase: 'awaiting-darks', frameKind: undefined, currentIndex: undefined }
          : { ...current.sequence, phase: 'complete', frameKind: undefined, currentIndex: undefined },
      }))
      yield* bus.publish('capture.succeeded', {})
    }).pipe(Effect.catch((error) => lease.signal.aborted ? Effect.void : failSequence(lease, error))), () => coordinator.release(lease))
  })
}


function isPlanValid(plan: ExternalSequencePlan) {
  return Number.isInteger(plan.lightCount) && plan.lightCount >= 1 && plan.lightCount <= MAX_SEQUENCE_LIGHTS && Number.isInteger(plan.darkCount) && plan.darkCount >= 0 && plan.darkCount <= MAX_SEQUENCE_DARKS && Number.isFinite(plan.durationSec) && plan.durationSec > 0 && plan.durationSec <= 3600
}

function hasExternalCapture(session: DeviceSession | null): session is DeviceSession {
  return !!session?.rig.camera && session.rig.captureStop?.mode === 'external'
}

function toErrorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }

function failSequence(lease: OperationLease, error: unknown) {
  return Effect.gen(function* () {
    const coordinator = yield* OperationCoordinator
    const bus = yield* EventBus
    const message = toErrorMessage(error)
    const updated = yield* coordinator.commitIfLease(lease, (current) => ({
      ...current,
      capture: { phase: 'failed', mode: 'external', lastError: message },
      sequence: { ...current.sequence, phase: 'failed', frameKind: undefined, currentIndex: undefined, lastError: message },
    }))
    if (updated) yield* bus.publish('capture.failed', { error: message })
  })
}
