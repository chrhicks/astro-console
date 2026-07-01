import type { SiteProfile } from './planning'

const TIMEZONE_LONGITUDE_MISMATCH_THRESHOLD_HOURS = 2.5

export interface SiteDiagnostic {
  code: 'timezone_longitude_mismatch'
  level: 'warning'
  summary: string
  repairHint: string
}

export function evaluateSiteDiagnostics(
  site: Pick<SiteProfile, 'name' | 'lon' | 'timezone'>,
): SiteDiagnostic[] {
  const timezoneOffsetHours = readTimeZoneOffsetHours(site.timezone, new Date())
  if (timezoneOffsetHours === undefined) {
    return []
  }

  const solarOffsetHours = clampSolarOffsetHours(site.lon / 15)
  const driftHours = Math.abs(timezoneOffsetHours - solarOffsetHours)
  if (driftHours < TIMEZONE_LONGITUDE_MISMATCH_THRESHOLD_HOURS) {
    return []
  }

  return [
    {
      code: 'timezone_longitude_mismatch',
      level: 'warning',
      summary:
        `Active site timezone ${site.timezone} (UTC${formatUtcOffset(timezoneOffsetHours)}) appears mismatched for longitude ${site.lon.toFixed(4)} ` +
        `(solar UTC${formatUtcOffset(solarOffsetHours)}; drift ${driftHours.toFixed(1)}h).`,
      repairHint:
        'Review Planning -> Sites before connect, or override with --site-lat/--site-lon/--site-timezone for this run.',
    },
  ]
}

function readTimeZoneOffsetHours(
  timeZone: string,
  at: Date,
): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at)

    const rawOffset = parts.find((part) => part.type === 'timeZoneName')?.value
    return parseOffsetHours(rawOffset)
  } catch {
    return undefined
  }
}

function parseOffsetHours(value: string | undefined): number | undefined {
  if (!value) return undefined

  const normalized = value
    .replace(/\u2212/gu, '-')
    .replace(/\s+/gu, '')
    .toUpperCase()
  if (normalized === 'UTC' || normalized === 'GMT') {
    return 0
  }

  const match = normalized.match(/^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/u)
  if (!match) {
    return undefined
  }

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = match[3] ? Number(match[3]) : 0
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return undefined
  }

  return sign * (hours + minutes / 60)
}

function formatUtcOffset(offsetHours: number): string {
  const sign = offsetHours < 0 ? '-' : '+'
  const absoluteMinutes = Math.round(Math.abs(offsetHours) * 60)
  const hoursPart = Math.floor(absoluteMinutes / 60)
  const minutesPart = absoluteMinutes % 60
  if (minutesPart === 0) {
    return `${sign}${hoursPart}`
  }

  return `${sign}${hoursPart}:${String(minutesPart).padStart(2, '0')}`
}

function clampSolarOffsetHours(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(-12, Math.min(14, value))
}
