import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { Context, Effect, Layer, Scope } from 'effect'

export interface OriginListenerShape {
  readonly listen: (
    port: number,
    host: string,
    handler: (request: IncomingMessage, response: ServerResponse) => void,
  ) => Effect.Effect<BoundOrigin, never, Scope.Scope>
}

export type BoundOrigin = {
  readonly port: number
}

export class OriginListener extends Context.Service<
  OriginListener,
  OriginListenerShape
>()('@astro-console/server/OriginListener') {}

export const originListenerLayer = Layer.succeed(
  OriginListener,
  OriginListener.of({
    listen: Effect.fn('OriginListener.listen')(function* (port, host, handler) {
      if (!Number.isInteger(port) || port < 0 || port > 65_535)
        throw new Error('Listen port must be an integer from 0 to 65535')
      if (host !== '127.0.0.1' && host !== '0.0.0.0')
        throw new Error(
          'Listen host must be loopback or the private Compose network',
        )
      return yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<{ readonly server: Server; readonly port: number }>(
              (resolve, reject) => {
                const server = createServer(handler)
                server.once('error', reject)
                server.listen(port, host, () => {
                  const address = server.address()
                  if (address === null || typeof address === 'string')
                    return reject(
                      new Error('Local server did not bind a TCP port'),
                    )
                  resolve({ server, port: address.port })
                })
              },
            ),
        ),
        ({ server }) =>
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                server.closeAllConnections()
                server.close(() => resolve())
              }),
          ),
      ).pipe(Effect.map(({ port }) => ({ port })))
    }),
  }),
)
