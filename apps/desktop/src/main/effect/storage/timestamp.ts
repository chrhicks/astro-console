// Strictly validates an ISO 8601 timestamp and derives filesystem-safe date
// and time components from the parsed canonical UTC instant. Rejects
// normalized-but-invalid dates (e.g. Feb 30) by validating calendar
// components before Date parsing can silently roll them over. Returns null
// when the input is not a valid YYYY-MM-DDTHH:MM:SS[.s][Z|±HH:MM] timestamp
// so the caller fails honestly instead of building a path from untrusted
// input.
export function parseCapturedAt(
  raw: string,
): { date: string; time: string } | null {
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
  )
  if (!match) return null
  const y = Number(match[1])
  const mo = Number(match[2])
  const d = Number(match[3])
  const h = Number(match[4])
  const mi = Number(match[5])
  const s = Number(match[6])
  if (mo < 1 || mo > 12) return null
  if (d < 1 || d > new Date(y, mo, 0).getDate()) return null
  if (h > 23 || mi > 59 || s > 59) return null
  // Parse to a canonical instant and derive path components from UTC so
  // a timezone offset is normalized before directory/filename construction.
  const instant = new Date(raw)
  if (Number.isNaN(instant.getTime())) return null
  return {
    date: formatUtcDate(instant),
    time: formatUtcTime(instant),
  }
}

function formatUtcDate(instant: Date): string {
  return `${pad(instant.getUTCFullYear(), 4)}-${pad(instant.getUTCMonth() + 1, 2)}-${pad(instant.getUTCDate(), 2)}`
}

function formatUtcTime(instant: Date): string {
  return `${pad(instant.getUTCHours(), 2)}${pad(instant.getUTCMinutes(), 2)}${pad(instant.getUTCSeconds(), 2)}`
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}
