import { Effect, Option, Schema } from 'effect'
import type { LocalIdentity } from '../auth/identity.ts'
import { AdapterObservation } from '../http/origin-handlers.ts'
import { StateSqliteRepository } from '../persistence/state-sqlite-repository.ts'
import type { Evidence } from './domain-state.ts'
import { ProjectionPublication } from './projection-publication.ts'

export const ingestAdapterObservation = Effect.fn('AdapterObservation.ingest')(
  function* (raw: unknown, identity: LocalIdentity) {
    const decoded = yield* Schema.decodeUnknownEffect(AdapterObservation)(
      raw,
    ).pipe(Effect.option)
    if (Option.isNone(decoded)) return undefined
    const input = decoded.value
    const repository = yield* StateSqliteRepository
    const publication = yield* ProjectionPublication
    const current = repository.state()
    const evidence: Evidence = {
      ...current.evidence,
      frameId: input.frameId,
      capturedAt: input.capturedAt,
      quality: input.quality,
      desired: input.desired,
      solved: input.solved,
      uncertaintyArcsec: input.uncertaintyArcsec,
      correction: {
        state: input.correctionState,
        evidence: input.correctionEvidence,
        bound: input.correctionBound,
        protection: input.protection,
        action:
          input.correctionState === 'automatic'
            ? 'none'
            : 'Review recovery in Observe before any new command.',
      },
    }
    const snapshot = yield* Effect.sync(() =>
      repository.persistEvidence(evidence, () => identity),
    )
    yield* publication.publish(repository.state().eventCursor)
    return snapshot
  },
)
