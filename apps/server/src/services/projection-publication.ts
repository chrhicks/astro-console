import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Effect, Layer } from 'effect'
import type { LocalIdentity } from '../auth/identity.ts'

export interface ProjectionPublicationShape {
  readonly publish: (type: string, cursor: number) => Effect.Effect<void>
  readonly stream: (
    request: IncomingMessage,
    response: ServerResponse,
    identity: LocalIdentity,
  ) => Effect.Effect<void>
  readonly close: () => Effect.Effect<void>
}

export class ProjectionPublication extends Context.Service<
  ProjectionPublication,
  ProjectionPublicationShape
>()('@astro-console/server/ProjectionPublication') {}

export const projectionPublicationLayer = (dependencies: {
  readonly expire: () => void
  readonly currentCursor: () => number
  readonly eventFor: (identity: LocalIdentity) => string
  readonly controllerConnected: (identity: LocalIdentity) => void
  readonly controllerDisconnected: (identity: LocalIdentity) => void
  readonly responseHeaders: (contentType: string) => Record<string, string>
  readonly observe?: (
    event: 'connect' | 'disconnect' | 'publish' | 'writeFailure',
  ) => void
}) =>
  Layer.effect(
    ProjectionPublication,
    Effect.sync(() => {
      const listeners = new Map<ServerResponse, LocalIdentity>()
      const controllerStreams = new Map<string, number>()
      const heartbeats = new Map<
        ServerResponse,
        ReturnType<typeof setTimeout>
      >()
      let emittedCursor = 0
      let closed = false
      const publish = (type: string, cursor: number) =>
        Effect.sync(() => {
          void type
          void cursor
          if (closed) return
          for (const [response, identity] of listeners)
            try {
              response.write(dependencies.eventFor(identity))
            } catch (cause) {
              dependencies.observe?.('writeFailure')
              throw cause
            }
          dependencies.observe?.('publish')
        })
      let poll: ReturnType<typeof setTimeout> | undefined
      const schedulePoll = () => {
        poll = setTimeout(() => {
          if (closed) return
          dependencies.expire()
          const cursor = dependencies.currentCursor()
          if (cursor > emittedCursor) {
            emittedCursor = cursor
            Effect.runSync(publish('ProjectionChanged', cursor))
          }
          schedulePoll()
        }, 250)
        poll.unref()
      }
      schedulePoll()
      const scheduleHeartbeat = (response: ServerResponse) => {
        const heartbeat = setTimeout(() => {
          if (closed || !listeners.has(response)) return
          response.write(`: heartbeat\n\n`)
          scheduleHeartbeat(response)
        }, 15_000)
        heartbeat.unref()
        heartbeats.set(response, heartbeat)
      }
      const stream = (
        request: IncomingMessage,
        response: ServerResponse,
        identity: LocalIdentity,
      ) =>
        Effect.sync(() => {
          if (closed) return
          const streamCount = controllerStreams.get(identity.clientId) ?? 0
          if (streamCount === 0) dependencies.controllerConnected(identity)
          controllerStreams.set(identity.clientId, streamCount + 1)
          response.writeHead(200, {
            ...dependencies.responseHeaders('text/event-stream'),
            connection: 'keep-alive',
          })
          try {
            response.write(dependencies.eventFor(identity))
          } catch (cause) {
            dependencies.observe?.('writeFailure')
            throw cause
          }
          listeners.set(response, identity)
          dependencies.observe?.('connect')
          scheduleHeartbeat(response)
          request.on('close', () => {
            if (closed) return
            const heartbeat = heartbeats.get(response)
            if (heartbeat !== undefined) clearTimeout(heartbeat)
            heartbeats.delete(response)
            listeners.delete(response)
            dependencies.observe?.('disconnect')
            const remaining =
              (controllerStreams.get(identity.clientId) ?? 1) - 1
            if (remaining <= 0) {
              controllerStreams.delete(identity.clientId)
              dependencies.controllerDisconnected(identity)
            } else controllerStreams.set(identity.clientId, remaining)
          })
        })
      const close = () =>
        Effect.sync(() => {
          if (closed) return
          closed = true
          if (poll !== undefined) clearTimeout(poll)
          for (const heartbeat of heartbeats.values()) clearTimeout(heartbeat)
          heartbeats.clear()
          listeners.clear()
          controllerStreams.clear()
        })
      return ProjectionPublication.of({ publish, stream, close })
    }),
  )
