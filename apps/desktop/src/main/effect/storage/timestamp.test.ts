import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseCapturedAt } from './timestamp'

describe('parseCapturedAt valid timestamps', () => {
  it('parses a UTC timestamp with Z suffix', () => {
    assert.deepEqual(parseCapturedAt('2024-01-15T12:30:45Z'), {
      date: '2024-01-15',
      time: '123045',
    })
  })

  it('accepts a timestamp without timezone (parsed as local, normalized to UTC)', () => {
    // Without Z, new Date treats the input as local time. The result is
    // timezone-dependent, so only assert that the format is accepted and
    // produces well-formed components rather than specific UTC values.
    const result = parseCapturedAt('2024-01-15T12:30:45')
    assert.notEqual(result, null)
    assert.match(result!.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(result!.time, /^\d{6}$/)
  })

  it('parses a timestamp with fractional seconds', () => {
    assert.deepEqual(parseCapturedAt('2024-06-01T00:00:00.123Z'), {
      date: '2024-06-01',
      time: '000000',
    })
  })

  it('normalizes a timezone offset to UTC', () => {
    // 2024-01-15T12:00:00+05:00 → UTC 2024-01-15T07:00:00
    assert.deepEqual(parseCapturedAt('2024-01-15T12:00:00+05:00'), {
      date: '2024-01-15',
      time: '070000',
    })
  })

  it('normalizes a negative timezone offset to UTC', () => {
    // 2024-01-15T22:00:00-03:00 → UTC 2024-01-16T01:00:00
    assert.deepEqual(parseCapturedAt('2024-01-15T22:00:00-03:00'), {
      date: '2024-01-16',
      time: '010000',
    })
  })

  it('accepts midnight', () => {
    assert.deepEqual(parseCapturedAt('2024-12-31T00:00:00Z'), {
      date: '2024-12-31',
      time: '000000',
    })
  })

  it('accepts end of day', () => {
    assert.deepEqual(parseCapturedAt('2024-12-31T23:59:59Z'), {
      date: '2024-12-31',
      time: '235959',
    })
  })

  it('accepts Feb 29 in a leap year', () => {
    assert.deepEqual(parseCapturedAt('2024-02-29T12:00:00Z'), {
      date: '2024-02-29',
      time: '120000',
    })
  })
})

describe('parseCapturedAt rejects invalid calendar dates', () => {
  it('rejects Feb 30', () => {
    assert.equal(parseCapturedAt('2024-02-30T12:00:00Z'), null)
  })

  it('rejects Feb 29 in a non-leap year', () => {
    assert.equal(parseCapturedAt('2023-02-29T12:00:00Z'), null)
  })

  it('rejects April 31', () => {
    assert.equal(parseCapturedAt('2024-04-31T12:00:00Z'), null)
  })

  it('rejects month 13', () => {
    assert.equal(parseCapturedAt('2024-13-01T12:00:00Z'), null)
  })

  it('rejects month 00', () => {
    assert.equal(parseCapturedAt('2024-00-15T12:00:00Z'), null)
  })

  it('rejects day 00', () => {
    assert.equal(parseCapturedAt('2024-01-00T12:00:00Z'), null)
  })

  it('rejects hour 24', () => {
    assert.equal(parseCapturedAt('2024-01-15T24:00:00Z'), null)
  })

  it('rejects minute 60', () => {
    assert.equal(parseCapturedAt('2024-01-15T12:60:00Z'), null)
  })

  it('rejects second 60', () => {
    assert.equal(parseCapturedAt('2024-01-15T12:00:60Z'), null)
  })
})

describe('parseCapturedAt rejects malformed input', () => {
  it('rejects empty string', () => {
    assert.equal(parseCapturedAt(''), null)
  })

  it('rejects date-only string', () => {
    assert.equal(parseCapturedAt('2024-01-15'), null)
  })

  it('rejects space separator instead of T', () => {
    assert.equal(parseCapturedAt('2024-01-15 12:30:45'), null)
  })

  it('rejects non-ISO format', () => {
    assert.equal(parseCapturedAt('Jan 15 2024 12:30:45'), null)
  })

  it('rejects non-numeric components', () => {
    assert.equal(parseCapturedAt('2024-AB-15T12:30:45Z'), null)
  })
})
