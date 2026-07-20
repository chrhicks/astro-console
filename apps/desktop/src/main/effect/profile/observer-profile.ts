import { Context, Effect, Layer, Schema } from 'effect'
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ObserverLocationSchema } from './observer-location-schema'

export interface ObserverLocation {
  readonly lat: number
  readonly lon: number
}

export interface ObserverProfile {
  readonly get: Effect.Effect<ObserverLocation | null>
  readonly set: (location: ObserverLocation | null) => Effect.Effect<void, Error>
}

export const ObserverProfile = Context.Service<ObserverProfile>('ObserverProfile')

export const ObserverProfileLive = Layer.sync(ObserverProfile, () => {
  const file = path.join(app.getPath('userData'), 'observer-profile.json')
  let location: ObserverLocation | null | undefined
  return {
    get: Effect.tryPromise(async () => {
      if (location !== undefined) return location
      try {
        const raw: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
        const decoded = Schema.decodeUnknownResult(ObserverLocationSchema)(raw)
        location = decoded._tag === 'Success' ? decoded.success : null
      } catch {
        location = null
      }
      return location
    }).pipe(Effect.catch(() => Effect.succeed<ObserverLocation | null>(null))),
    set: (next) =>
      Effect.tryPromise({
        try: async () => {
          await fs.mkdir(path.dirname(file), { recursive: true })
          await fs.writeFile(file, JSON.stringify(next), 'utf8')
          location = next
        },
        catch: (cause) => new Error('Could not save observer profile', { cause }),
      }),
  } satisfies ObserverProfile
})
