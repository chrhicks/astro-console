import type { BootstrapSseEventEnvelope } from '@astro-console/protocol'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Effect, Fiber, Scope, Stream } from 'effect'

export const encodeProjectionSseEvent = (event: BootstrapSseEventEnvelope) =>
  `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`

export const projectionHeartbeat = <E, R>(
  write: (payload: string) => Effect.Effect<unknown, E, R>,
) =>
  Effect.sleep('15 seconds').pipe(
    Effect.andThen(write(': heartbeat\n\n')),
    Effect.forever,
  )

export const serveProjectionSse = (input: {
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly responseHeaders: Record<string, string>
  readonly events: Stream.Stream<BootstrapSseEventEnvelope>
  readonly scope: Scope.Scope
  readonly observeWriteFailure: () => void
}) =>
  Effect.gen(function* () {
    input.response.writeHead(200, {
      ...input.responseHeaders,
      connection: 'keep-alive',
    })
    const write = (payload: string) =>
      Effect.try({
        try: () => input.response.write(payload),
        catch: (cause) => cause,
      }).pipe(
        Effect.tapError(() => Effect.sync(input.observeWriteFailure)),
        Effect.asVoid,
      )
    const connection = Effect.gen(function* () {
      yield* projectionHeartbeat(write).pipe(Effect.forkScoped)
      yield* input.events.pipe(
        Stream.runForEach((event) => write(encodeProjectionSseEvent(event))),
      )
    }).pipe(
      Effect.scoped,
      Effect.ensuring(
        Effect.sync(() => {
          if (!input.response.writableEnded) input.response.end()
        }),
      ),
    )
    const fiber = yield* Effect.forkIn(connection, input.scope, {
      startImmediately: true,
    })
    input.request.once('close', () => {
      Effect.runSync(Fiber.interrupt(fiber))
    })
  })
