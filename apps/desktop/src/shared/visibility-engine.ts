import {
  Body,
  Equator,
  Horizon,
  Observer,
  SearchAltitude,
} from 'astronomy-engine'
import type { SolarSystemBody } from './catalog/catalog-schema'

export interface SiteAzimuthRange {
  startDeg: number
  endDeg: number
  label?: string
}

const ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG = -18
const DEFAULT_MIN_ALTITUDE_DEG = 10
const TONIGHT_STEP_MINUTES = 30
const TONIGHT_FALLBACK_HOURS = 12

export type VisibilityRecommendation = 'good_now' | 'later_tonight' | 'not_tonight'
export type VisibilityState = 'up' | 'later' | 'blocked'

export const RECOMMENDATION_TO_VISIBILITY: Record<VisibilityRecommendation, VisibilityState> = {
  good_now: 'up',
  later_tonight: 'later',
  not_tonight: 'blocked',
}

export const VISIBILITY_LABEL: Record<VisibilityState, string> = {
  up: 'Up now',
  later: 'Later tonight',
  blocked: 'Not tonight',
}

export interface VisibilityInput {
  lat: number
  lon: number
  minAltitudeDeg?: number
  blockedAzimuthRanges?: SiteAzimuthRange[]
}

export type VisibilityTarget =
  | { id: string; raHours: number; decDeg: number }
  | { id: string; body: SolarSystemBody }

export interface VisibilityResult {
  visibility: VisibilityState
  visibilityLabel: string
  altitudeNowDeg?: number
  bestAltitudeDeg?: number
}

export interface RankedVisibilityEntry extends VisibilityResult {
  id: string
}

export interface SolarSystemCoordinates {
  raHours: number
  decDeg: number
}

const BODY_BY_NAME: Record<SolarSystemBody, Body> = {
  sun: Body.Sun,
  moon: Body.Moon,
  mercury: Body.Mercury,
  venus: Body.Venus,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
}

export function computeSolarSystemCoordinates(
  body: SolarSystemBody,
  observer: Observer,
  time: Date,
): SolarSystemCoordinates {
  return bodyEquatorial(body, observer, time)
}

export function rankTargetsLight(
  targets: VisibilityTarget[],
  location: VisibilityInput,
  now: Date = new Date(),
): RankedVisibilityEntry[] {
  const observer = new Observer(location.lat, location.lon, 0)
  const window = resolveTonightWindow(observer, now)
  const sampleTimes = createSampleTimes(window)

  return targets
    .map((target) => ({
      id: target.id,
      ...evaluateVisibility(target, location, observer, now, sampleTimes),
    }))
    .sort((left, right) => rankEntry(left) - rankEntry(right))
}

function evaluateVisibility(
  target: VisibilityTarget,
  location: VisibilityInput,
  observer: Observer,
  now: Date,
  sampleTimes: Date[],
): VisibilityResult {
  const minAltitudeDeg = location.minAltitudeDeg ?? DEFAULT_MIN_ALTITUDE_DEG
  const currentRaDec = resolveEquatorial(target, observer, now)
  const currentHorizontal = Horizon(
    now,
    observer,
    currentRaDec.raHours,
    currentRaDec.decDeg,
    'normal',
  )
  const usableNow =
    currentHorizontal.altitude >= minAltitudeDeg &&
    !isAzimuthBlocked(location.blockedAzimuthRanges, currentHorizontal.azimuth)

  const samples = sampleTimes.map((time) => {
    const raDec = resolveEquatorial(target, observer, time)
    const horizontal = Horizon(time, observer, raDec.raHours, raDec.decDeg, 'normal')
    return {
      altitudeDeg: horizontal.altitude,
      azimuthDeg: horizontal.azimuth,
    }
  })
  const bestAltitudeDeg = samples.reduce(
    (best, sample) => Math.max(best, sample.altitudeDeg),
    -90,
  )
  const usableLaterTonight = samples.some(
    (sample) =>
      sample.altitudeDeg >= minAltitudeDeg &&
      !isAzimuthBlocked(location.blockedAzimuthRanges, sample.azimuthDeg),
  )

  const recommendation: VisibilityRecommendation = usableNow
    ? 'good_now'
    : usableLaterTonight
      ? 'later_tonight'
      : 'not_tonight'
  const visibility = RECOMMENDATION_TO_VISIBILITY[recommendation]

  return {
    visibility,
    visibilityLabel: VISIBILITY_LABEL[visibility],
    altitudeNowDeg: roundToOne(currentHorizontal.altitude),
    bestAltitudeDeg:
      bestAltitudeDeg > -90 ? roundToOne(bestAltitudeDeg) : undefined,
  }
}

function resolveTonightWindow(
  observer: Observer,
  now: Date,
): { startAt: Date; endAt: Date } {
  const sunAltitudeNow = readBodyAltitude(Body.Sun, observer, now)
  const dusk = SearchAltitude(
    Body.Sun,
    observer,
    -1,
    now,
    2,
    ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG,
  )
  const dawn = SearchAltitude(
    Body.Sun,
    observer,
    +1,
    now,
    2,
    ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG,
  )

  const startAt =
    sunAltitudeNow > ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG &&
    dusk &&
    dawn &&
    dusk.date > now
      ? dusk.date
      : now

  const dawnAfterStart = SearchAltitude(
    Body.Sun,
    observer,
    +1,
    startAt,
    2,
    ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG,
  )
  const endAt =
    dawnAfterStart?.date ??
    dawn?.date ??
    new Date(startAt.getTime() + TONIGHT_FALLBACK_HOURS * 60 * 60 * 1000)

  return { startAt, endAt }
}

function createSampleTimes(window: {
  startAt: Date
  endAt: Date
}): Date[] {
  const stepMs = TONIGHT_STEP_MINUTES * 60 * 1000
  const times: Date[] = []

  for (
    let current = window.startAt.getTime();
    current <= window.endAt.getTime();
    current += stepMs
  ) {
    times.push(new Date(current))
  }

  if (times.length === 0 || times.at(-1)?.getTime() !== window.endAt.getTime()) {
    times.push(window.endAt)
  }

  return times
}

function resolveEquatorial(
  target: VisibilityTarget,
  observer: Observer,
  time: Date,
): SolarSystemCoordinates {
  if ('body' in target) {
    return bodyEquatorial(target.body, observer, time)
  }
  return { raHours: target.raHours, decDeg: target.decDeg }
}

function bodyEquatorial(
  body: SolarSystemBody,
  observer: Observer,
  time: Date,
): SolarSystemCoordinates {
  const equatorial = Equator(BODY_BY_NAME[body], time, observer, true, true)
  return { raHours: equatorial.ra, decDeg: equatorial.dec }
}

function readBodyAltitude(body: Body, observer: Observer, time: Date): number {
  const equatorial = Equator(body, time, observer, true, true)
  return Horizon(time, observer, equatorial.ra, equatorial.dec, 'normal').altitude
}

function rankEntry(entry: RankedVisibilityEntry): number {
  const visibilityRank =
    entry.visibility === 'up' ? 0 : entry.visibility === 'later' ? 1 : 2
  const altitude = entry.altitudeNowDeg ?? entry.bestAltitudeDeg ?? -90
  return visibilityRank * 1000 - altitude
}

function isAzimuthBlocked(
  ranges: SiteAzimuthRange[] | undefined,
  azimuthDeg: number,
): boolean {
  if (!ranges || ranges.length === 0) return false
  return ranges.some((range) => matchesAzimuthRange(azimuthDeg, range))
}

function matchesAzimuthRange(
  azimuthDeg: number,
  range: SiteAzimuthRange,
): boolean {
  const azimuth = normalizeAzimuth(azimuthDeg)
  const start = normalizeAzimuth(range.startDeg)
  const end = normalizeAzimuth(range.endDeg)
  if (start <= end) return azimuth >= start && azimuth <= end
  return azimuth >= start || azimuth <= end
}

function normalizeAzimuth(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10
}
