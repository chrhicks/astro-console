import { DatabaseSync } from 'node:sqlite'
import { Context, Layer } from 'effect'
import { PlanIntent, type ObserveIntent } from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'
import type { FailureReason } from '../services/domain-state.ts'
import type { StateSqliteRepositoryShape } from './state-sqlite-repository.ts'
import { acceptRunDefinition, acceptPlanDraft } from './run/plan.ts'
import {
  acceptFakePolicy,
  acceptRun,
  acceptRunIntervention,
  advanceFakeRunState,
} from './run/lifecycle.ts'
import { applyRunMutation, previewRunMutation } from './run/mutations.ts'
import type { RunDefinitionAuthority } from './run/shared.ts'

type StartRun = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'StartAcceptedRun' }
>
type AcceptRunDefinition = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'AcceptRunDefinition' }
>
type PauseRun = Extract<
  typeof ObserveIntent.Type,
  { readonly _tag: 'PauseRun' }
>
type ResumeRun = Extract<
  typeof ObserveIntent.Type,
  { readonly _tag: 'ResumeRun' }
>
type FakePolicy = Extract<
  typeof ObserveIntent.Type,
  | { readonly _tag: 'StopRun' }
  | { readonly _tag: 'SkipSequence' }
  | { readonly _tag: 'RetryPhase' }
  | { readonly _tag: 'RequestPark' }
>
type PreviewRunMutation = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'PreviewRunMutation' }
>
type ApplyRunMutation = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'ApplyRunMutation' }
>
type ApproveDisruptiveRunMutation = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'ApproveDisruptiveRunMutation' }
>
type SavePlanDraft = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'SaveDraft' }
>
export type RunTransition = {
  readonly status: number
  readonly body: unknown
  readonly event?: { readonly type: string; readonly cursor: number }
}
export type RunReject = (reason: FailureReason) => RunTransition
export interface RunSqliteRepositoryShape {
  readonly saveDraft: (
    input: SavePlanDraft,
    identity: LocalIdentity,
  ) => RunTransition
  readonly acceptRunDefinition: (
    input: AcceptRunDefinition,
    identity: LocalIdentity,
  ) => RunTransition
  readonly startAcceptedRun: (
    input: StartRun,
    identity: LocalIdentity,
  ) => RunTransition
  readonly previewRunMutation: (
    input: PreviewRunMutation,
    identity: LocalIdentity,
  ) => RunTransition
  readonly applyRunMutation: (
    input: ApplyRunMutation | ApproveDisruptiveRunMutation,
    identity: LocalIdentity,
  ) => RunTransition
  readonly pause: (input: PauseRun, identity: LocalIdentity) => RunTransition
  readonly resume: (input: ResumeRun, identity: LocalIdentity) => RunTransition
  readonly stop: (input: FakePolicy, identity: LocalIdentity) => RunTransition
  readonly skip: (input: FakePolicy, identity: LocalIdentity) => RunTransition
  readonly retry: (input: FakePolicy, identity: LocalIdentity) => RunTransition
  readonly park: (input: FakePolicy, identity: LocalIdentity) => RunTransition
  readonly advance: (identity: LocalIdentity) =>
    | {
        readonly body: unknown
        readonly event: { readonly type: string; readonly cursor: number }
      }
    | undefined
}
export class RunSqliteRepository extends Context.Service<
  RunSqliteRepository,
  RunSqliteRepositoryShape
>()('@astro-console/server/RunSqliteRepository') {}
export const runSqliteRepositoryLayer = (
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  reject: RunReject,
  authority: RunDefinitionAuthority = { executor: 'fake' },
) =>
  Layer.sync(RunSqliteRepository, () =>
    RunSqliteRepository.of({
      saveDraft: (input, identity) =>
        acceptPlanDraft(db, stateRepository, input, identity),
      acceptRunDefinition: (input, identity) =>
        acceptRunDefinition(db, stateRepository, input, identity, authority),
      startAcceptedRun: (input, identity) =>
        acceptRun(db, stateRepository, input, identity),
      previewRunMutation: (input, identity) => {
        const body = previewRunMutation(db, stateRepository, input, identity)
        return {
          status:
            body.outcome === 'rejected' ? reject(body.reason).status : 202,
          body,
          ...('event' in body ? { event: body.event } : {}),
        }
      },
      applyRunMutation: (input, identity) =>
        applyRunMutation(
          db,
          stateRepository,
          input,
          PlanIntent.guards.ApproveDisruptiveRunMutation(input),
          identity,
        ),
      pause: (input, identity) =>
        acceptRunIntervention(db, stateRepository, input, 'pause', identity),
      resume: (input, identity) =>
        acceptRunIntervention(db, stateRepository, input, 'resume', identity),
      stop: (input, identity) =>
        acceptFakePolicy(db, stateRepository, input, 'stop', identity),
      skip: (input, identity) =>
        acceptFakePolicy(db, stateRepository, input, 'skip', identity),
      retry: (input, identity) =>
        acceptFakePolicy(db, stateRepository, input, 'retry', identity),
      park: (input, identity) =>
        acceptFakePolicy(db, stateRepository, input, 'park', identity),
      advance: (identity) => advanceFakeRunState(db, stateRepository, identity),
    }),
  )
