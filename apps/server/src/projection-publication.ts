import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Effect, Layer } from 'effect'
import type { LocalIdentity } from './identity.ts'

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
  readonly responseHeaders: (contentType: string) => Record<string, string>
}) =>
  Layer.effect(
    ProjectionPublication,
    Effect.sync(() => {
      const listeners = new Map<ServerResponse, LocalIdentity>()
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
            response.write(dependencies.eventFor(identity))
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
          response.writeHead(200, {
            ...dependencies.responseHeaders('text/event-stream'),
            connection: 'keep-alive',
          })
          response.write(dependencies.eventFor(identity))
          listeners.set(response, identity)
          scheduleHeartbeat(response)
          request.on('close', () => {
            const heartbeat = heartbeats.get(response)
            if (heartbeat !== undefined) clearTimeout(heartbeat)
            heartbeats.delete(response)
            listeners.delete(response)
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
        })
      return ProjectionPublication.of({ publish, stream, close })
    }),
  )
