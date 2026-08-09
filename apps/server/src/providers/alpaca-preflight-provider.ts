import { Effect, Option, Schema } from 'effect'
import { PreflightSnapshot } from '@astro-console/v2-contracts'
import { type PreflightProviderConfig } from '../config/environment-config.ts'
import { type ReadOnlyPreflightProviderShape } from '../services/preflight-service.ts'

const AlpacaEnvelope = Schema.Struct({
  Value: Schema.optionalKey(Schema.Unknown),
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})
const ConfiguredDevice = Schema.Struct({
  DeviceName: Schema.optional(Schema.String),
  DeviceNumber: Schema.Number,
  DeviceType: Schema.String,
  UniqueID: Schema.optional(Schema.String),
})
const ConfiguredDevices = Schema.Array(ConfiguredDevice)
const observedAt = () => new Date().toISOString()

type DeviceKind = 'camera' | 'telescope' | 'focuser' | 'filterWheel'
type State = 'ready' | 'blocked' | 'unavailable' | 'unknown'

export const alpacaPreflightProvider = (
  config: Extract<PreflightProviderConfig, { readonly kind: 'alpaca' }>,
  request: typeof fetch = fetch,
): ReadOnlyPreflightProviderShape => ({
  unavailableSnapshot: () => unavailableSnapshot(config),
  observe: () =>
    Effect.fn('AlpacaPreflightProvider.observe')(function* () {
      yield* Effect.annotateCurrentSpan({
        'astro.provider': 'alpaca',
        'astro.workspace': 'observe',
      })
      const base = `http://${config.host}:${config.port}`
      const configured = yield* read(
        request,
        `${base}/management/v1/configureddevices`,
      ).pipe(
        Effect.flatMap((value) =>
          Schema.decodeUnknownEffect(ConfiguredDevices)(value),
        ),
      )
      const at = observedAt()
      const devices = yield* Effect.all(
        (
          [
            ['camera', config.devices.camera],
            ['telescope', config.devices.telescope],
            ['focuser', config.devices.focuser],
            ['filterWheel', config.devices.filterWheel],
          ] satisfies ReadonlyArray<
            readonly [
              DeviceKind,
              (
                | { readonly deviceNumber: number; readonly uniqueId?: string }
                | undefined
              ),
            ]
          >
        )
          .filter(
            (
              entry,
            ): entry is [
              DeviceKind,
              { deviceNumber: number; uniqueId?: string },
            ] => entry[1] !== undefined,
          )
          .map(([kind, device]) =>
            observeDevice(request, base, configured, kind, device, at),
          ),
      )
      const checks = devices.flatMap((device) => device.safety)
      const blocked = checks.find((entry) => entry.state === 'blocked')
      const unknown = checks.find(
        (entry) => entry.state === 'unknown' || entry.state === 'unavailable',
      )
      return {
        observedAt: at,
        verdict:
          blocked === undefined
            ? unknown === undefined
              ? 'ready'
              : 'unknown'
            : 'blocked',
        nextAction:
          blocked !== undefined
            ? 'Resolve the blocked rig condition before any command.'
            : unknown !== undefined
              ? 'Confirm unavailable rig facts before any command.'
              : 'Rig facts are ready for the next accepted phase.',
        checks:
          checks.length === 0
            ? [
                check(
                  'rig-inventory',
                  'unavailable',
                  at,
                  'No configured device could be observed.',
                ),
              ]
            : checks,
        rig: { rigId: config.rigId, observedAt: at, devices },
      }
    })(),
})

function unavailableSnapshot(
  config: Extract<PreflightProviderConfig, { readonly kind: 'alpaca' }>,
) {
  const at = observedAt()
  const devices = (
    [
      ['camera', config.devices.camera],
      ['telescope', config.devices.telescope],
      ['focuser', config.devices.focuser],
      ['filterWheel', config.devices.filterWheel],
    ] satisfies ReadonlyArray<
      readonly [DeviceKind, { readonly deviceNumber: number } | undefined]
    >
  )
    .filter(
      (entry): entry is [DeviceKind, { readonly deviceNumber: number }] =>
        entry[1] !== undefined,
    )
    .map(([kind]) =>
      unavailableDevice(
        kind,
        at,
        'Alpaca did not return a read-only observation.',
      ),
    )
  return Schema.decodeUnknownSync(PreflightSnapshot)({
    observedAt: at,
    verdict: 'unavailable' as const,
    nextAction: 'Restore the configured rig provider before any command.',
    checks: [
      check(
        'rig-provider',
        'unavailable',
        at,
        'Alpaca did not return a read-only observation.',
      ),
      ...devices.flatMap((device) => device.safety),
    ],
    rig: { rigId: config.rigId, observedAt: at, devices },
  })
}

function observeDevice(
  request: typeof fetch,
  base: string,
  configured: ReadonlyArray<typeof ConfiguredDevice.Type>,
  kind: DeviceKind,
  device: { readonly deviceNumber: number; readonly uniqueId?: string },
  at: string,
) {
  return Effect.fn('AlpacaPreflightProvider.observeDevice')(function* () {
    const managed = configured.find(
      (entry) =>
        entry.DeviceType.toLowerCase() === alpacaType(kind) &&
        entry.DeviceNumber === device.deviceNumber,
    )
    if (
      managed === undefined ||
      (device.uniqueId !== undefined && managed.UniqueID !== device.uniqueId)
    )
      return unavailableDevice(
        kind,
        at,
        'The configured device was not returned by Alpaca management.',
      )
    const endpoint = `${base}/api/v1/${alpacaType(kind)}/${device.deviceNumber}`
    const connected = yield* readBoolean(request, `${endpoint}/connected`).pipe(
      Effect.option,
    )
    if (Option.isNone(connected))
      return unavailableDevice(
        kind,
        at,
        'The configured device did not return a connection fact.',
      )
    const name = yield* readString(request, `${endpoint}/name`).pipe(
      Effect.option,
    )
    const facts = yield* deviceFacts(request, endpoint, kind).pipe(
      Effect.option,
    )
    const safety = [
      check(
        `${kind}-connected`,
        connected.value ? 'ready' : 'blocked',
        at,
        connected.value
          ? 'The device reports an active Alpaca connection.'
          : 'The device reports no active Alpaca connection.',
      ),
      ...(Option.isNone(facts)
        ? [
            check(
              `${kind}-facts`,
              'unavailable',
              at,
              'The device did not return its read-only capability facts.',
            ),
          ]
        : facts.value.safety.map((fact) =>
            check(`${kind}-${fact.key}`, fact.state, at, fact.reason),
          )),
    ]
    return {
      kind,
      state: connected.value
        ? Option.isNone(facts)
          ? 'unknown'
          : 'ready'
        : 'blocked',
      observedAt: at,
      ...(Option.isSome(name) ? { name: name.value } : {}),
      ...(managed.UniqueID === undefined ? {} : { uniqueId: managed.UniqueID }),
      capabilities: Option.isNone(facts) ? [] : facts.value.capabilities,
      safety,
    } as const
  })()
}

function deviceFacts(request: typeof fetch, base: string, kind: DeviceKind) {
  const reads: Record<DeviceKind, ReadonlyArray<readonly [string, string]>> = {
    camera: [
      ['canabortexposure', 'abort exposure'],
      ['canstopexposure', 'stop exposure'],
    ],
    telescope: [
      ['atpark', 'parked'],
      ['slewing', 'slewing'],
      ['canpark', 'park'],
    ],
    focuser: [
      ['ismoving', 'moving'],
      ['absolute', 'absolute position'],
    ],
    filterWheel: [['position', 'position']],
  }
  return Effect.forEach(reads[kind], ([path, label]) =>
    read(request, `${base}/${path}`).pipe(
      Effect.map((value) => [path, label, value] as const),
    ),
  ).pipe(
    Effect.map((values) => ({
      capabilities: values
        .filter(([path, , value]) => path.startsWith('can') && value === true)
        .map(([, label]) => label),
      safety: values.flatMap(([path, label, value]) => {
        if (kind === 'telescope' && path === 'atpark')
          return [
            {
              key: 'parked',
              state: value === true ? ('blocked' as const) : ('ready' as const),
              reason:
                value === true
                  ? 'The mount is parked.'
                  : 'The mount is not parked.',
            },
          ]
        if (
          (kind === 'telescope' && path === 'slewing') ||
          (kind === 'focuser' && path === 'ismoving')
        )
          return [
            {
              key: path,
              state: value === true ? ('blocked' as const) : ('ready' as const),
              reason:
                value === true
                  ? `The device reports ${label}.`
                  : `The device does not report ${label}.`,
            },
          ]
        return []
      }),
    })),
  )
}

function unavailableDevice(kind: DeviceKind, at: string, reason: string) {
  return {
    kind,
    state: 'unavailable' as const,
    observedAt: at,
    capabilities: [],
    safety: [check(`${kind}-available`, 'unavailable', at, reason)],
  }
}
function alpacaType(kind: DeviceKind) {
  return kind === 'filterWheel' ? 'filterwheel' : kind
}
function check(key: string, state: State, at: string, reason: string) {
  return { key, state, observedAt: at, reason }
}
function readBoolean(request: typeof fetch, url: string) {
  return read(request, url).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Boolean)),
  )
}
function readString(request: typeof fetch, url: string) {
  return read(request, url).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.String)),
  )
}
function read(request: typeof fetch, url: string) {
  return Effect.fn('AlpacaPreflightProvider.read')(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) => request(url, { method: 'GET', signal }),
      catch: (cause) => cause,
    })
    if (!response.ok)
      return yield* Effect.fail(
        new Error(`Alpaca GET failed: HTTP ${response.status}`),
      )
    const envelope = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => cause,
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(AlpacaEnvelope)))
    if (envelope.ErrorNumber !== 0)
      return yield* Effect.fail(
        new Error(
          envelope.ErrorMessage ?? `Alpaca error ${envelope.ErrorNumber}`,
        ),
      )
    return envelope.Value
  })()
}
