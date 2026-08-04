import { Effect, Schema } from 'effect'
import { type PreflightProviderConfig } from '../config/environment-config.ts'
import { type ReadOnlyPreflightProviderShape } from '../services/preflight-service.ts'

const AlpacaEnvelope = Schema.Struct({
  Value: Schema.optionalKey(Schema.Unknown),
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})

const observedAt = () => new Date().toISOString()

export const alpacaPreflightProvider = (
  config: Extract<PreflightProviderConfig, { readonly kind: 'alpaca' }>,
  request: typeof fetch = fetch,
): ReadOnlyPreflightProviderShape => ({
  observe: () =>
    Effect.fn('AlpacaPreflightProvider.observe')(function* () {
      const base = `http://${config.host}:${config.port}/api/v1/telescope/${config.telescopeDeviceNumber}`
      const [connected, parked, slewing, tracking] = yield* Effect.all([
        readBoolean(request, `${base}/connected`),
        readBoolean(request, `${base}/atpark`),
        readBoolean(request, `${base}/slewing`),
        readBoolean(request, `${base}/tracking`),
      ])
      const at = observedAt()
      const checks = [
        check(
          'mount-connected',
          connected ? 'ready' : 'blocked',
          at,
          connected
            ? 'The mount reports an active Alpaca connection.'
            : 'The mount reports no active Alpaca connection.',
        ),
        check(
          'mount-parked',
          parked ? 'blocked' : 'ready',
          at,
          parked ? 'The mount is parked.' : 'The mount is not parked.',
        ),
        check(
          'mount-slewing',
          slewing ? 'blocked' : 'ready',
          at,
          slewing ? 'The mount is moving.' : 'The mount is not moving.',
        ),
        check(
          'mount-tracking',
          tracking ? 'ready' : 'unknown',
          at,
          tracking
            ? 'The mount reports tracking.'
            : 'The mount does not report tracking.',
        ),
      ] as const
      const blocked = checks.find((entry) => entry.state === 'blocked')
      const unknown = checks.find((entry) => entry.state === 'unknown')
      const verdict: 'ready' | 'blocked' | 'unknown' =
        blocked === undefined
          ? unknown === undefined
            ? 'ready'
            : 'unknown'
          : 'blocked'
      return {
        observedAt: at,
        verdict,
        nextAction:
          blocked === undefined
            ? unknown === undefined
              ? 'Preflight facts are ready for the next accepted phase.'
              : 'Confirm the unknown preflight fact before any command.'
            : 'Resolve the blocked mount condition before any command.',
        checks,
      }
    })(),
})

function check(
  key: string,
  state: 'ready' | 'blocked' | 'unknown',
  at: string,
  reason: string,
) {
  return { key, state, observedAt: at, reason }
}

function readBoolean(request: typeof fetch, url: string) {
  return Effect.fn('AlpacaPreflightProvider.readBoolean')(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) => request(url, { signal }),
      catch: (cause) => cause,
    })
    if (!response.ok)
      return yield* Effect.fail(
        new Error(`Alpaca GET ${url} failed: HTTP ${response.status}`),
      )
    const envelope = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => cause,
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(AlpacaEnvelope)))
    if (envelope.ErrorNumber !== 0)
      return yield* Effect.fail(
        new Error(
          `Alpaca GET ${url} failed: ${envelope.ErrorMessage ?? `error ${envelope.ErrorNumber}`}`,
        ),
      )
    return yield* Schema.decodeUnknownEffect(Schema.Boolean)(envelope.Value)
  })()
}
