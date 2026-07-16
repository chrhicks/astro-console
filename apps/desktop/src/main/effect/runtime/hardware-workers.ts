import { Context, Effect, FiberSet, Layer } from 'effect'

export interface HardwareWorkers {
  readonly launch: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<void, never, R>
}

export const HardwareWorkers = Context.Service<HardwareWorkers>('HardwareWorkers')

export const HardwareWorkersLive = Layer.effect(
  HardwareWorkers,
  Effect.gen(function* () {
    const workers = yield* FiberSet.make()

    return {
      launch: (effect) => FiberSet.run(workers, effect).pipe(Effect.asVoid),
    } satisfies HardwareWorkers
  }),
)
