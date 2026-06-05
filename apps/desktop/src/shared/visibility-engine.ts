import {
  Body,
  Equator,
  Horizon,
  Observer,
  SearchAltitude,
} from 'astronomy-engine'
import {
  evaluateBackyardMask,
  isAzimuthBlocked,
  type TargetPathSample,
} from './backyard-mask'
import type { CatalogTarget, RankedTarget, SiteProfile } from './planning'

const DEFAULT_STEP_MINUTES = 10
const MIN_USEFUL_VISIBLE_MINUTES = 30
const ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG = -18
const LOW_MOON_SEPARATION_DEG = 25

export interface VisibilityWindow {
  startAt: string
  endAt: string
  now: string
  stepMinutes: number
}

export interface RankTargetsInput {
  site: SiteProfile
  targets: CatalogTarget[]
  now?: Date
  window?: Partial<VisibilityWindow>
}

export function rankTargetsForTonight(input: RankTargetsInput): RankedTarget[] {
  const window = resolveTonightWindow(input.site, input.now, input.window)
  return rankTargetsForWindow({
    site: input.site,
    targets: input.targets,
    window,
  })
}

export function rankTargetsForWindow(input: {
  site: SiteProfile
  targets: CatalogTarget[]
  window: VisibilityWindow
}): RankedTarget[] {
  const observer = new Observer(input.site.lat, input.site.lon, 0)
  const sampleTimes = createSampleTimes(input.window)
  const evaluationTime = new Date(input.window.now)

  return input.targets
    .map((target) =>
      rankTarget(input.site, target, observer, evaluationTime, sampleTimes),
    )
    .sort(
      (left, right) =>
        right.score - left.score || left.targetId.localeCompare(right.targetId),
    )
}

export function resolveTonightWindow(
  site: SiteProfile,
  now = new Date(),
  window: Partial<VisibilityWindow> | undefined = undefined,
): VisibilityWindow {
  const observer = new Observer(site.lat, site.lon, 0)
  const currentTime = window?.now ? new Date(window.now) : now
  const sunAltitudeNow = readBodyAltitude(Body.Sun, observer, currentTime)
  const dusk = SearchAltitude(
    Body.Sun,
    observer,
    -1,
    currentTime,
    2,
    ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG,
  )
  const dawn = SearchAltitude(
    Body.Sun,
    observer,
    +1,
    currentTime,
    2,
    ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG,
  )

  const startAt = window?.startAt
    ? new Date(window.startAt)
    : sunAltitudeNow > ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG &&
        dusk &&
        dawn &&
        dusk.date > currentTime
      ? dusk.date
      : currentTime

  const dawnAfterStart = SearchAltitude(
    Body.Sun,
    observer,
    +1,
    startAt,
    2,
    ASTRONOMICAL_TWILIGHT_ALTITUDE_DEG,
  )
  const endAt = window?.endAt
    ? new Date(window.endAt)
    : (dawnAfterStart?.date ??
      dawn?.date ??
      new Date(startAt.getTime() + 12 * 60 * 60 * 1000))

  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    now: currentTime.toISOString(),
    stepMinutes: clampStepMinutes(window?.stepMinutes ?? DEFAULT_STEP_MINUTES),
  }
}

function rankTarget(
  site: SiteProfile,
  target: CatalogTarget,
  observer: Observer,
  evaluationTime: Date,
  sampleTimes: Date[],
): RankedTarget {
  const currentPosition = readHorizontalCoordinates(
    target,
    observer,
    evaluationTime,
  )
  const altitudeNowDeg = currentPosition.altitudeDeg
  const moonSeparationDeg = readMoonSeparation(target, observer, evaluationTime)
  const samples = sampleTimes.map((time) => {
    const horizontal = readHorizontalCoordinates(target, observer, time)
    return {
      at: time.toISOString(),
      altitudeDeg: horizontal.altitudeDeg,
      azimuthDeg: horizontal.azimuthDeg,
    } satisfies TargetPathSample
  })
  const maskResult = evaluateBackyardMask(site, samples)
  const bestAltitudeDeg = samples.reduce(
    (best, sample) => Math.max(best, sample.altitudeDeg),
    -90,
  )
  const skyVisibleMinutes = computeVisibleMinutes(
    maskResult.skyVisibleSampleCount,
    sampleTimes,
  )
  const visibleMinutes = computeVisibleMinutes(
    maskResult.usableSampleCount,
    sampleTimes,
  )
  const windowStartAt = maskResult.usableWindowStartAt
  const windowEndAt = maskResult.usableWindowEndAt
  const recommendation = decideRecommendation(
    altitudeNowDeg >= site.minAltitudeDeg &&
      !isAzimuthBlocked(site.blockedAzimuthRanges, currentPosition.azimuthDeg),
    visibleMinutes,
  )
  const positiveReasons: string[] = []
  const rejectionReasons: string[] = []

  if (recommendation === 'good_now') {
    positiveReasons.push(
      `Above the ${site.minAltitudeDeg} deg altitude floor now`,
    )
  } else if (recommendation === 'later_tonight') {
    positiveReasons.push(
      `Becomes visible later tonight around ${formatLocalTime(windowStartAt)}`,
    )
  } else {
    rejectionReasons.push(
      `No usable window clears the ${site.minAltitudeDeg} deg altitude floor tonight`,
    )
  }

  if (skyVisibleMinutes >= MIN_USEFUL_VISIBLE_MINUTES) {
    positiveReasons.push(
      `Sky-visible for about ${skyVisibleMinutes} minutes tonight`,
    )
  } else if (skyVisibleMinutes > 0) {
    rejectionReasons.push(
      `Only sky-visible for about ${skyVisibleMinutes} minutes tonight`,
    )
  }

  if (visibleMinutes >= MIN_USEFUL_VISIBLE_MINUTES) {
    positiveReasons.push(
      `Usable from this site for about ${visibleMinutes} minutes tonight`,
    )
  } else if (skyVisibleMinutes > 0 && visibleMinutes === 0) {
    rejectionReasons.push(
      maskResult.blockedLabels.length > 0
        ? `Backyard mask blocks the target from this site (${maskResult.blockedLabels.join(', ')})`
        : 'Backyard mask blocks the target from this site',
    )
  } else if (visibleMinutes > 0) {
    rejectionReasons.push(
      `Usable from this site for only about ${visibleMinutes} minutes tonight`,
    )
  }

  if (skyVisibleMinutes > visibleMinutes && visibleMinutes > 0) {
    rejectionReasons.push(
      `Backyard mask removes about ${skyVisibleMinutes - visibleMinutes} minutes of otherwise visible time`,
    )
  }

  if (bestAltitudeDeg >= site.minAltitudeDeg) {
    positiveReasons.push(
      `Peaks near ${bestAltitudeDeg.toFixed(1)} deg altitude`,
    )
  }

  if (moonSeparationDeg >= LOW_MOON_SEPARATION_DEG) {
    positiveReasons.push(
      `Moon separation is ${moonSeparationDeg.toFixed(1)} deg`,
    )
  } else {
    rejectionReasons.push(
      `Moon is close at ${moonSeparationDeg.toFixed(1)} deg`,
    )
  }

  if (typeof target.magnitude === 'number' && target.magnitude <= 6.5) {
    positiveReasons.push(
      `Catalog brightness is favorable at magnitude ${target.magnitude}`,
    )
  }

  return {
    targetId: target.id,
    siteId: site.id,
    score: scoreTarget({
      recommendation,
      altitudeNowDeg,
      bestAltitudeDeg,
      visibleMinutes,
      moonSeparationDeg,
      magnitude: target.magnitude,
    }),
    evaluatedAt: evaluationTime.toISOString(),
    skyVisibleMinutes,
    visibleMinutes,
    altitudeNowDeg: roundToOne(altitudeNowDeg),
    bestAltitudeDeg:
      bestAltitudeDeg > -90 ? roundToOne(bestAltitudeDeg) : undefined,
    windowStartAt,
    windowEndAt,
    moonSeparationDeg: roundToOne(moonSeparationDeg),
    recommendation,
    backyardVisible: maskResult.backyardVisible,
    positiveReasons,
    rejectionReasons,
  }
}

function createSampleTimes(window: VisibilityWindow): Date[] {
  const start = new Date(window.startAt)
  const end = new Date(window.endAt)
  const stepMs = clampStepMinutes(window.stepMinutes) * 60 * 1000
  const times: Date[] = []

  for (
    let current = start.getTime();
    current <= end.getTime();
    current += stepMs
  ) {
    times.push(new Date(current))
  }

  if (times.length === 0 || times.at(-1)?.getTime() !== end.getTime()) {
    times.push(end)
  }

  return times
}

function readAltitude(
  target: CatalogTarget,
  observer: Observer,
  time: Date,
): number {
  return readHorizontalCoordinates(target, observer, time).altitudeDeg
}

function readMoonSeparation(
  target: CatalogTarget,
  observer: Observer,
  time: Date,
): number {
  const moonEquator = Equator(Body.Moon, time, observer, true, true)
  return sphericalSeparationDeg(
    target.raHours,
    target.decDeg,
    moonEquator.ra,
    moonEquator.dec,
  )
}

function computeVisibleMinutes(
  visibleSampleCount: number,
  allSamples: Date[],
): number {
  if (visibleSampleCount === 0) return 0
  if (visibleSampleCount === 1) return 0
  const averageStepMinutes =
    allSamples.length > 1
      ? Math.round(
          (allSamples[1].getTime() - allSamples[0].getTime()) / 60000,
        ) || DEFAULT_STEP_MINUTES
      : DEFAULT_STEP_MINUTES
  return Math.max(0, (visibleSampleCount - 1) * averageStepMinutes)
}

function decideRecommendation(
  usableNow: boolean,
  visibleMinutes: number,
): RankedTarget['recommendation'] {
  if (usableNow && visibleMinutes >= MIN_USEFUL_VISIBLE_MINUTES) {
    return 'good_now'
  }
  if (visibleMinutes >= MIN_USEFUL_VISIBLE_MINUTES) {
    return 'later_tonight'
  }
  return 'not_tonight'
}

function scoreTarget(input: {
  recommendation: RankedTarget['recommendation']
  altitudeNowDeg: number
  bestAltitudeDeg: number
  visibleMinutes: number
  moonSeparationDeg: number
  magnitude?: number
}): number {
  const recommendationWeight =
    input.recommendation === 'good_now'
      ? 45
      : input.recommendation === 'later_tonight'
        ? 25
        : 0
  const altitudeWeight = Math.max(0, input.bestAltitudeDeg) * 0.8
  const visibilityWeight = Math.min(input.visibleMinutes, 360) * 0.12
  const moonWeight = Math.min(input.moonSeparationDeg, 120) * 0.15
  const brightnessWeight =
    typeof input.magnitude === 'number' ? Math.max(0, 10 - input.magnitude) : 0
  const nowBonus =
    input.altitudeNowDeg > 0 ? Math.min(input.altitudeNowDeg, 70) * 0.35 : 0

  return roundToOne(
    recommendationWeight +
      altitudeWeight +
      visibilityWeight +
      moonWeight +
      brightnessWeight +
      nowBonus,
  )
}

function sphericalSeparationDeg(
  ra1Hours: number,
  dec1Deg: number,
  ra2Hours: number,
  dec2Deg: number,
): number {
  const ra1Rad = toRadians(ra1Hours * 15)
  const dec1Rad = toRadians(dec1Deg)
  const ra2Rad = toRadians(ra2Hours * 15)
  const dec2Rad = toRadians(dec2Deg)
  const cosine =
    Math.sin(dec1Rad) * Math.sin(dec2Rad) +
    Math.cos(dec1Rad) * Math.cos(dec2Rad) * Math.cos(ra1Rad - ra2Rad)
  return toDegrees(Math.acos(Math.min(1, Math.max(-1, cosine))))
}

function clampStepMinutes(value: number): number {
  return Math.min(30, Math.max(5, Math.round(value)))
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10
}

function formatLocalTime(value: string | undefined): string {
  if (!value) return 'later tonight'
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function readHorizontalCoordinates(
  target: CatalogTarget,
  observer: Observer,
  time: Date,
): {
  azimuthDeg: number
  altitudeDeg: number
} {
  const horizontal = Horizon(
    time,
    observer,
    target.raHours,
    target.decDeg,
    'normal',
  )
  return {
    azimuthDeg: horizontal.azimuth,
    altitudeDeg: horizontal.altitude,
  }
}

function readBodyAltitude(body: Body, observer: Observer, time: Date): number {
  const equator = Equator(body, time, observer, true, true)
  return Horizon(time, observer, equator.ra, equator.dec, 'normal').altitude
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI
}
