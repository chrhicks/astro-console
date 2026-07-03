import { app } from 'electron'
import { Effect, Layer, Schema } from 'effect'
import { resolvePlanningActiveSite } from '../../legacy/planning-context'
import { PlanningStore } from '../../legacy/planning-store'
import type { SiteProfile } from '../../../shared/legacy/planning'
import type { ObserverContext } from '../../../shared/observer-context'
import type { LiveDeviceSession } from '../device/device-plugin'
import { SessionManager } from '../session/session-manager'
import { ObserverContextStore } from './observer-context-store'

export const ObserverContextStoreLive = Layer.effect(
  ObserverContextStore,
  Effect.gen(function* () {
    const sessions = yield* SessionManager

    return {
      getCurrent: () =>
        Effect.gen(function* () {
          const session = yield* sessions.getCurrent
          const deviceContext = session ? resolveDeviceLocation(session) : null
          if (deviceContext) {
            return deviceContext
          }

          const site = yield* resolveActiveSite
          if (!site) {
            return null
          }
          return toObserverContext(site)
        }),
    } satisfies ObserverContextStore
  }),
)

const resolveActiveSite = Effect.tryPromise({
  try: async (): Promise<SiteProfile | null> => {
    const store = createPlanningStore()
    if (!store) return null
    const snapshot = await store.getSnapshot()
    const resolved = resolvePlanningActiveSite(snapshot, {
      allowFirstSiteFallback: false,
    })
    return resolved ? resolved.site : null
  },
  catch: () => new Error('observer context resolution failed'),
}).pipe(Effect.orElseSucceed((): SiteProfile | null => null))

function createPlanningStore(): PlanningStore | null {
  const envPath = process.env.SEESTAR_PLANNING_STATE?.trim()
  if (envPath) {
    return new PlanningStore({ getPlanningFilePath: () => envPath })
  }

  if (process.versions.electron) {
    return new PlanningStore({ getUserDataDir: () => app.getPath('userData') })
  }

  return null
}

const LatLon = Schema.Struct({
  lat: Schema.Number,
  lon: Schema.Number,
})

const WithLocation = Schema.Struct({
  location: Schema.optional(LatLon),
})

const decodeLocation = Schema.decodeUnknownEither(WithLocation)

function resolveDeviceLocation(session: LiveDeviceSession): ObserverContext | null {
  const location = extractLocation(session) ?? extractLocation(session.device)
  if (!location) return null
  return { ...location, source: 'device' }
}

function extractLocation(value: object | null | undefined): { lat: number; lon: number } | null {
  if (!value) return null
  const decoded = decodeLocation(value)
  if (decoded._tag === 'Left') return null
  return decoded.right.location ?? null
}

function toObserverContext(site: SiteProfile): ObserverContext {
  return {
    lat: site.lat,
    lon: site.lon,
    minAltitudeDeg: site.minAltitudeDeg,
    blockedAzimuthRanges: site.blockedAzimuthRanges,
    source: 'site',
  }
}
