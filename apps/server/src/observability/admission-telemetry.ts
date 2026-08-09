import { Effect, Exit } from 'effect'
import type { AdmissionReason, LocalIdentity } from '../auth/identity.ts'
import { recordOperationalEvent } from './operational-telemetry.ts'

export type { AdmissionReason }

export function recordAdmissionDecision(reason: AdmissionReason) {
  return recordOperationalEvent({
    scope: 'admission',
    operation: 'decision',
    outcome: reason,
  })
}

export function recordJwksRefresh(outcome: 'success' | 'failed') {
  return recordOperationalEvent({
    scope: 'admission',
    operation: 'jwks.refresh',
    outcome,
  })
}

export function tracedAdmission(
  effect: Effect.Effect<LocalIdentity | undefined, unknown>,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    const outcome = Exit.match(result, {
      onFailure: () => 'unavailable' as const,
      onSuccess: (identity) =>
        identity === undefined ? ('rejected' as const) : ('admitted' as const),
    })
    yield* Effect.annotateCurrentSpan({ 'astro.admission.outcome': outcome })
    yield* recordOperationalEvent({
      scope: 'admission',
      operation: 'request',
      outcome,
    })
    return result
  }).pipe(Effect.withSpan('Admission.request'))
  return traced.pipe(
    Effect.flatMap(
      Exit.match({
        onFailure: Effect.failCause,
        onSuccess: Effect.succeed,
      }),
    ),
  )
}
