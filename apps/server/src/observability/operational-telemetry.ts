import { Effect, Metric } from 'effect'

const operationCounter = Metric.counter('astro.operation.count', {
  incremental: true,
  description: 'Completed Astro Console operational telemetry events',
})

export type OperationalTelemetryEvent = {
  readonly scope:
    'executor' | 'projection' | 'pipeline' | 'http' | 'startup' | 'admission'
  readonly operation: OperationalOperation
  readonly outcome: OperationalOutcome
}

type OperationalOperation =
  | 'work.execute'
  | 'snapshot'
  | 'sse.open'
  | 'sse.connect'
  | 'sse.disconnect'
  | 'sse.publish'
  | 'sse.writeFailure'
  | 'plateSolve'
  | 'frameIntake'
  | 'frameInspection'
  | 'publisher'
  | 'plateSolve.execute'
  | 'publisher.localRead'
  | 'publisher.put'
  | 'publisher.verify'
  | 'publisher.settle'
  | 'config.decode'
  | 'service.create'
  | 'listener.bind'
  | 'shutdown'
  | 'request'
  | 'decision'
  | 'jwks.refresh'
export type OperationalOutcome =
  | 'noChange'
  | 'waitingPreflight'
  | 'acquireRequired'
  | 'captureReady'
  | 'awaitingObservation'
  | 'observing'
  | 'retrievalReady'
  | 'retrieved'
  | 'aborted'
  | 'rejected'
  | 'reconciling'
  | 'delivered'
  | 'recorded.solved'
  | 'recorded.noSolution'
  | 'rejected.SourceUnavailable'
  | 'rejected.SourceHintsUnavailable'
  | 'rejected.SourceFormatUnsupported'
  | 'rejected.SolveNotExpected'
  | 'accepted'
  | 'rejected.InvalidInput'
  | 'rejected.MaterializationFailed'
  | 'available'
  | 'failed'
  | 'published'
  | 'superseded'
  | 'success'
  | 'unavailable'
  | 'ready'
  | 'stopped'
  | 'admitted'
  | 'missingOrInvalidToken'
  | 'keyUnavailable'
  | 'membershipUnavailable'
  | 'notMember'

export function recordOperationalEvent(event: OperationalTelemetryEvent) {
  const attributes = {
    'astro.telemetry.scope': event.scope,
    'astro.telemetry.operation': event.operation,
    'astro.telemetry.outcome': event.outcome,
  }
  return Effect.all([
    Metric.update(Metric.withAttributes(operationCounter, attributes), 1),
    Effect.logInfo('astro.operation').pipe(Effect.annotateLogs(attributes)),
  ]).pipe(Effect.asVoid)
}
