import type { BootstrapSseEventEnvelope } from '@astro-console/protocol'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Effect, Fiber, Scope, Stream } from 'effect'

interface ProjectionSseWritable {
  readonly write: (payload: string) => boolean
  readonly once: {
    (event: 'drain' | 'close', listener: () => void): unknown
    (event: 'error', listener: (cause: Error) => void): unknown
  }
  readonly off: {
    (event: 'drain' | 'close', listener: () => void): unknown
    (event: 'error', listener: (cause: Error) => void): unknown
  }
}

export const encodeProjectionSseEvent = (event: BootstrapSseEventEnvelope) =>
  `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`

export const projectionHeartbeat = <E, R>(
  write: (payload: string) => Effect.Effect<unknown, E, R>,
) =>
  Effect.sleep('15 seconds').pipe(
    Effect.andThen(write(': heartbeat\n\n')),
    Effect.forever,
  )

const waitForDrain = (response: ProjectionSseWritable) =>
  Effect.callback<void, unknown>((resume) => {
    const cleanup = () => {
      response.off('drain', onDrain)
      response.off('error', onError)
      response.off('close', onClose)
    }
    const onDrain = () => {
      cleanup()
      resume(Effect.void)
    }
    const onError = (cause: Error) => {
      cleanup()
      resume(Effect.fail(cause))
    }
    const onClose = () => {
      cleanup()
      resume(Effect.fail(new Error('SSE response closed before drain')))
    }
    response.once('drain', onDrain)
    response.once('error', onError)
    response.once('close', onClose)
    return Effect.sync(cleanup)
  })

export const writeProjectionSsePayload = (
  response: ProjectionSseWritable,
  payload: string,
) =>
  Effect.try({
    try: () => response.write(payload),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((accepted) =>
      accepted ? Effect.void : waitForDrain(response),
    ),
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
      writeProjectionSsePayload(input.response, payload).pipe(
        Effect.tapError(() => Effect.sync(input.observeWriteFailure)),
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
