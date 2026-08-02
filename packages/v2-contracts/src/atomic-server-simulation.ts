import { Effect, Ref, Semaphore } from 'effect'

export interface AtomicCommit<State, Result> {
  readonly state: State
  readonly result: Result
}

export interface AtomicServerSimulation<State, Work> {
  readonly transact: <Result, Error, Requirements = never>(
    decide: (
      state: State,
    ) => Effect.Effect<AtomicCommit<State, Result>, Error, Requirements>,
  ) => Effect.Effect<Result, Error, Requirements>
  readonly readState: () => Effect.Effect<State>
  readonly dispatchOutbox: <Error, Requirements = never>(
    execute: (work: Work) => Effect.Effect<void, Error, Requirements>,
  ) => Effect.Effect<void, Error, Requirements>
}

export const makeAtomicServerSimulation = <State, Work>(
  initialState: State,
  outbox: (state: State) => ReadonlyArray<Work>,
): Effect.Effect<AtomicServerSimulation<State, Work>> =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make(initialState)
    const transaction = yield* Semaphore.make(1)

    const transact: AtomicServerSimulation<State, Work>['transact'] = (
      decide,
    ) =>
      transaction.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(stateRef)
          const commit = yield* decide(current)
          yield* Ref.set(stateRef, commit.state)
          return commit.result
        }),
      )

    const readState = Effect.fn('AtomicServerSimulation.readState')(
      function* () {
        return yield* Ref.get(stateRef)
      },
    )

    const dispatchOutbox: AtomicServerSimulation<
      State,
      Work
    >['dispatchOutbox'] = (execute) =>
      Ref.get(stateRef).pipe(
        Effect.flatMap((state) =>
          Effect.forEach(outbox(state), execute, { discard: true }),
        ),
      )

    return { transact, readState, dispatchOutbox }
  })
