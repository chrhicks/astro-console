import { Config, ConfigProvider, Effect, Option } from 'effect'
import type { ProcessorConfig } from './processor-config.ts'
import type { R2PublisherConfig } from './publisher-config.ts'
import {
  alpacaSimulationScenarios,
  type AlpacaSimulationScenario,
} from '../simulator/alpaca-simulator.ts'

const optional = (name: string) => Config.option(Config.string(name))
const text = (name: string, fallback?: string) =>
  fallback === undefined
    ? Config.string(name)
    : Config.string(name).pipe(Config.withDefault(fallback))
const migratedText = (name: string, alias: string, fallback?: string) =>
  Config.orElse(Config.string(name), () => Config.string(alias)).pipe(
    fallback === undefined ? (config) => config : Config.withDefault(fallback),
  )
const migratedOptional = (name: string, alias: string) =>
  Config.option(Config.orElse(Config.string(name), () => Config.string(alias)))
const configFailure = (message: string) =>
  Effect.fail(
    new Config.ConfigError(new ConfigProvider.SourceError({ message })),
  )
const validText = (value: string, message: string) =>
  value && !/[\r\n]/.test(value)
    ? Effect.succeed(value)
    : configFailure(message)

export type OriginServerConfig = {
  readonly runtime: {
    readonly databasePath: string
    readonly release: string
    readonly port: number
    readonly host: string
    readonly webDistPath: string
    readonly previewRoot: string
    readonly originalsRoot: string
    readonly localOwnerPort?: number
    readonly remoteDesktopPort?: number
  }
  readonly admission:
    | { readonly mode: 'development'; readonly client: string }
    | {
        readonly mode: 'production'
        readonly issuer: string
        readonly audience: string
        readonly jwksUrl: string
        readonly bootstrapPath: string
        readonly clientContext: 'desktop' | 'phone'
        readonly cacheTtlMs: number
      }
  readonly fixture:
    | 'm27'
    | 'preflight'
    | 'polar'
    | 'target-deep-sky'
    | 'target-lunar'
    | 'target-correction'
    | 'target-verification'
    | 'live-frame'
    | 'live-frame-library'
    | 'managed-capture'
    | 'acquire-recovery'
    | 'plan-draft'
    | 'library-published'
    | undefined
  readonly downloadGrant:
    { readonly url: string; readonly secretPath: string } | undefined
  readonly preflightProvider: PreflightProviderConfig | undefined
  readonly simulation: DevelopmentSimulationEnvironment | undefined
  readonly plateSolve: {
    readonly executable: string
    readonly indexesRoot: string
    readonly timeoutMs: number
    readonly solverVersion: string
    readonly scaleLowDeg: number
    readonly scaleHighDeg: number
    readonly searchRadiusDeg: number
  }
}

export type DevelopmentSimulationEnvironment = {
  readonly origin: string
  readonly launchScenario: AlpacaSimulationScenario
  readonly corpusRoot?: string
}

export type PreflightProviderConfig = {
  readonly kind: 'alpaca'
  readonly rigId: string
  readonly host: string
  readonly port: number
  readonly devices: {
    readonly camera?: AlpacaDeviceConfig
    readonly telescope?: AlpacaDeviceConfig
    readonly focuser?: AlpacaDeviceConfig
    readonly filterWheel?: AlpacaDeviceConfig
  }
}

export type AlpacaDeviceConfig = {
  readonly deviceNumber: number
  readonly uniqueId?: string
}

export const originServerConfig = Config.all({
  admissionMode: text('ASTRO_ADMISSION_MODE', 'development'),
  audience: optional('CF_ACCESS_AUDIENCE'),
  bind: migratedText('ASTRO_SERVER_BIND', 'ASTRO_LOCAL_WEB_BIND', '127.0.0.1'),
  bootstrapPath: optional('ASTRO_MEMBERSHIP_BOOTSTRAP_PATH'),
  cacheTtl: text('CF_ACCESS_JWKS_CACHE_TTL_MS', '300000'),
  client: migratedText(
    'ASTRO_SERVER_CLIENT',
    'ASTRO_LOCAL_WEB_CLIENT',
    'owner',
  ),
  clientContext: optional('ASTRO_CLIENT_CONTEXT'),
  databasePath: migratedText(
    'ASTRO_SERVER_DB',
    'ASTRO_LOCAL_WEB_DB',
    './.astro-server/state.sqlite',
  ),
  fixture: migratedOptional('ASTRO_SERVER_FIXTURE', 'ASTRO_LOCAL_WEB_FIXTURE'),
  issuer: optional('CF_ACCESS_ISSUER'),
  jwksUrl: optional('CF_ACCESS_JWKS_URL'),
  port: migratedText('ASTRO_SERVER_PORT', 'ASTRO_LOCAL_WEB_PORT', '0'),
  localOwnerPort: optional('ASTRO_LOCAL_OWNER_PORT'),
  remoteDesktopPort: optional('ASTRO_REMOTE_DESKTOP_PORT'),
  release: text('ASTRO_RELEASE', 'server'),
  webDistPath: text('ASTRO_WEB_DIST', '../web/dist'),
  previewRoot: text('ASTRO_PREVIEW_ROOT', '/var/lib/astro-console/previews'),
  originalsRoot: text(
    'ASTRO_ORIGINALS_ROOT',
    '/var/lib/astro-console/originals',
  ),
  plateSolveExecutable: text(
    'ASTRO_PLATE_SOLVE_EXECUTABLE',
    '/usr/bin/solve-field',
  ),
  plateSolveIndexesRoot: text(
    'ASTRO_PLATE_SOLVE_INDEXES_ROOT',
    '/var/lib/astro-console/astrometry-indexes',
  ),
  plateSolveTimeoutMs: text('ASTRO_PLATE_SOLVE_TIMEOUT_MS', '90000'),
  plateSolveSolverVersion: text('ASTRO_PLATE_SOLVE_SOLVER_VERSION', '0.93'),
  plateSolveScaleLowDeg: text('ASTRO_PLATE_SOLVE_SCALE_LOW_DEG', '20'),
  plateSolveScaleHighDeg: text('ASTRO_PLATE_SOLVE_SCALE_HIGH_DEG', '30'),
  plateSolveSearchRadiusDeg: text('ASTRO_PLATE_SOLVE_SEARCH_RADIUS_DEG', '15'),
  downloadGrantUrl: optional('ASTRO_DOWNLOAD_GRANT_URL'),
  downloadGrantSecretPath: optional('ASTRO_DOWNLOAD_GRANT_SHARED_SECRET_PATH'),
  preflightProvider: text('ASTRO_PREFLIGHT_PROVIDER', 'disabled'),
  preflightRigId: text('ASTRO_PREFLIGHT_ALPACA_RIG_ID', 'configured-rig'),
  preflightHost: optional('ASTRO_PREFLIGHT_ALPACA_HOST'),
  preflightPort: optional('ASTRO_PREFLIGHT_ALPACA_PORT'),
  preflightTelescopeDeviceNumber: optional(
    'ASTRO_PREFLIGHT_ALPACA_TELESCOPE_DEVICE_NUMBER',
  ),
  preflightTelescopeUniqueId: optional(
    'ASTRO_PREFLIGHT_ALPACA_TELESCOPE_UNIQUE_ID',
  ),
  preflightCameraDeviceNumber: optional(
    'ASTRO_PREFLIGHT_ALPACA_CAMERA_DEVICE_NUMBER',
  ),
  preflightCameraUniqueId: optional('ASTRO_PREFLIGHT_ALPACA_CAMERA_UNIQUE_ID'),
  preflightFocuserDeviceNumber: optional(
    'ASTRO_PREFLIGHT_ALPACA_FOCUSER_DEVICE_NUMBER',
  ),
  preflightFocuserUniqueId: optional(
    'ASTRO_PREFLIGHT_ALPACA_FOCUSER_UNIQUE_ID',
  ),
  preflightFilterWheelDeviceNumber: optional(
    'ASTRO_PREFLIGHT_ALPACA_FILTER_WHEEL_DEVICE_NUMBER',
  ),
  preflightFilterWheelUniqueId: optional(
    'ASTRO_PREFLIGHT_ALPACA_FILTER_WHEEL_UNIQUE_ID',
  ),
  simulationMode: text('ASTRO_SIMULATION_MODE', 'disabled'),
  simulatorOrigin: optional('ASTRO_SIMULATOR_ORIGIN'),
  simulatorScenario: optional('ASTRO_SIMULATOR_SCENARIO'),
  simulatorCorpusRoot: optional('ASTRO_SIM_CORPUS_OUTPUT_ROOT'),
}).pipe(
  Config.mapOrFail(
    (input): Effect.Effect<OriginServerConfig, Config.ConfigError> => {
      if (input.bind !== '127.0.0.1' && input.bind !== '0.0.0.0')
        return configFailure('ASTRO_SERVER_BIND must be 127.0.0.1 or 0.0.0.0')
      if (!/^\d+$/.test(input.port) || Number(input.port) > 65_535)
        return configFailure(
          'ASTRO_SERVER_PORT must be an integer from 0 to 65535',
        )
      if (
        Option.isSome(input.localOwnerPort) &&
        (!/^\d+$/.test(input.localOwnerPort.value) ||
          Number(input.localOwnerPort.value) === 0 ||
          Number(input.localOwnerPort.value) > 65_535)
      )
        return configFailure(
          'ASTRO_LOCAL_OWNER_PORT must be an integer from 1 to 65535',
        )
      if (
        Option.isSome(input.remoteDesktopPort) &&
        (!/^\d+$/.test(input.remoteDesktopPort.value) ||
          Number(input.remoteDesktopPort.value) === 0 ||
          Number(input.remoteDesktopPort.value) > 65_535)
      )
        return configFailure(
          'ASTRO_REMOTE_DESKTOP_PORT must be an integer from 1 to 65535',
        )
      if (!/^\d+$/.test(input.cacheTtl))
        return configFailure(
          'Production admission requires Access issuer, audience, HTTPS JWKS URL, bootstrap path, client context, and integer JWKS cache TTL',
        )
      if (
        Option.isSome(input.fixture) &&
        input.fixture.value !== 'm27' &&
        input.fixture.value !== 'preflight' &&
        input.fixture.value !== 'polar' &&
        input.fixture.value !== 'target-deep-sky' &&
        input.fixture.value !== 'target-lunar' &&
        input.fixture.value !== 'target-correction' &&
        input.fixture.value !== 'target-verification' &&
        input.fixture.value !== 'live-frame' &&
        input.fixture.value !== 'live-frame-library' &&
        input.fixture.value !== 'managed-capture' &&
        input.fixture.value !== 'acquire-recovery' &&
        input.fixture.value !== 'plan-draft' &&
        input.fixture.value !== 'library-published'
      )
        return configFailure(
          'ASTRO_SERVER_FIXTURE must be m27, preflight, polar, target-deep-sky, target-lunar, target-correction, target-verification, live-frame, live-frame-library, managed-capture, acquire-recovery, plan-draft, or library-published when set',
        )
      if (
        Option.isNone(input.downloadGrantUrl) &&
        Option.isNone(input.downloadGrantSecretPath)
      ) {
        return originServer(input)
      }
      if (
        Option.isNone(input.downloadGrantUrl) ||
        Option.isNone(input.downloadGrantSecretPath) ||
        input.downloadGrantUrl.value !==
          'http://download-grant:8791/internal/download-grants' ||
        !/^\/run\/secrets\/[A-Za-z0-9._-]+$/.test(
          input.downloadGrantSecretPath.value,
        )
      )
        return configFailure(
          'Download grants require an internal URL and mounted shared secret',
        )
      return originServer(input)
    },
  ),
)

function originServer(input: {
  readonly admissionMode: string
  readonly audience: Option.Option<string>
  readonly bind: string
  readonly bootstrapPath: Option.Option<string>
  readonly cacheTtl: string
  readonly client: string
  readonly clientContext: Option.Option<string>
  readonly databasePath: string
  readonly fixture: Option.Option<string>
  readonly issuer: Option.Option<string>
  readonly jwksUrl: Option.Option<string>
  readonly localOwnerPort: Option.Option<string>
  readonly remoteDesktopPort: Option.Option<string>
  readonly port: string
  readonly release: string
  readonly webDistPath: string
  readonly previewRoot: string
  readonly originalsRoot: string
  readonly plateSolveExecutable: string
  readonly plateSolveIndexesRoot: string
  readonly plateSolveTimeoutMs: string
  readonly plateSolveSolverVersion: string
  readonly plateSolveScaleLowDeg: string
  readonly plateSolveScaleHighDeg: string
  readonly plateSolveSearchRadiusDeg: string
  readonly downloadGrantUrl: Option.Option<string>
  readonly downloadGrantSecretPath: Option.Option<string>
  readonly preflightProvider: string
  readonly preflightRigId: string
  readonly preflightHost: Option.Option<string>
  readonly preflightPort: Option.Option<string>
  readonly preflightTelescopeDeviceNumber: Option.Option<string>
  readonly preflightTelescopeUniqueId: Option.Option<string>
  readonly preflightCameraDeviceNumber: Option.Option<string>
  readonly preflightCameraUniqueId: Option.Option<string>
  readonly preflightFocuserDeviceNumber: Option.Option<string>
  readonly preflightFocuserUniqueId: Option.Option<string>
  readonly preflightFilterWheelDeviceNumber: Option.Option<string>
  readonly preflightFilterWheelUniqueId: Option.Option<string>
  readonly simulationMode: string
  readonly simulatorOrigin: Option.Option<string>
  readonly simulatorScenario: Option.Option<string>
  readonly simulatorCorpusRoot: Option.Option<string>
}) {
  return Effect.gen(function* () {
    const fixture =
      Option.isSome(input.fixture) &&
      (input.fixture.value === 'm27' ||
        input.fixture.value === 'preflight' ||
        input.fixture.value === 'polar' ||
        input.fixture.value === 'target-deep-sky' ||
        input.fixture.value === 'target-lunar' ||
        input.fixture.value === 'target-correction' ||
        input.fixture.value === 'target-verification' ||
        input.fixture.value === 'live-frame' ||
        input.fixture.value === 'live-frame-library' ||
        input.fixture.value === 'managed-capture' ||
        input.fixture.value === 'acquire-recovery' ||
        input.fixture.value === 'plan-draft' ||
        input.fixture.value === 'library-published')
        ? input.fixture.value
        : undefined
    const databasePath = yield* validText(
      input.databasePath,
      'Runtime configuration contains an invalid non-secret value',
    )
    const release = yield* validText(
      input.release,
      'Runtime configuration contains an invalid non-secret value',
    )
    const webDistPath = yield* validText(
      input.webDistPath,
      'Runtime configuration contains an invalid non-secret value',
    )
    const previewRoot = yield* validText(
      input.previewRoot,
      'Runtime configuration contains an invalid non-secret value',
    )
    const originalsRoot = yield* validText(
      input.originalsRoot,
      'Runtime configuration contains an invalid originals root',
    )
    const plateSolveExecutable = yield* validText(
      input.plateSolveExecutable,
      'Runtime configuration contains an invalid non-secret value',
    )
    const plateSolveIndexesRoot = yield* validText(
      input.plateSolveIndexesRoot,
      'Runtime configuration contains an invalid non-secret value',
    )
    const plateSolveTimeoutMs = Number(input.plateSolveTimeoutMs)
    if (
      !Number.isInteger(plateSolveTimeoutMs) ||
      plateSolveTimeoutMs < 1_000 ||
      plateSolveTimeoutMs > 300_000
    )
      return yield* configFailure(
        'ASTRO_PLATE_SOLVE_TIMEOUT_MS must be an integer between 1000 and 300000',
      )
    const plateSolveSolverVersion = yield* validText(
      input.plateSolveSolverVersion,
      'Runtime configuration contains an invalid non-secret value',
    )
    const scaleLowDeg = Number(input.plateSolveScaleLowDeg)
    const scaleHighDeg = Number(input.plateSolveScaleHighDeg)
    const searchRadiusDeg = Number(input.plateSolveSearchRadiusDeg)
    if (
      !Number.isFinite(scaleLowDeg) ||
      !Number.isFinite(scaleHighDeg) ||
      !Number.isFinite(searchRadiusDeg) ||
      scaleLowDeg <= 0 ||
      scaleHighDeg < scaleLowDeg ||
      searchRadiusDeg <= 0
    )
      return yield* configFailure(
        'Plate-solve scale and radius values must be positive finite bounds',
      )
    const preflightProvider = yield* configuredPreflightProvider(input)
    if (input.admissionMode === 'development') {
      if (input.bind !== '127.0.0.1')
        return yield* configFailure(
          'Fixture admission requires loopback development binding',
        )
      const simulation = yield* configuredDevelopmentSimulation(input)
      if (
        simulation !== undefined &&
        (preflightProvider === undefined ||
          alpacaProviderOrigin(preflightProvider) !== simulation.origin)
      )
        return yield* configFailure(
          'Alpaca simulation requires the executor Alpaca host and port to match the simulator origin.',
        )
      return yield* Effect.succeed<OriginServerConfig>({
        runtime: {
          databasePath,
          release,
          port: Number(input.port),
          host: input.bind,
          webDistPath,
          previewRoot,
          originalsRoot,
        },
        admission: { mode: 'development' as const, client: input.client },
        fixture,
        downloadGrant:
          Option.isSome(input.downloadGrantUrl) &&
          Option.isSome(input.downloadGrantSecretPath)
            ? {
                url: input.downloadGrantUrl.value,
                secretPath: input.downloadGrantSecretPath.value,
              }
            : undefined,
        preflightProvider,
        simulation,
        plateSolve: {
          executable: plateSolveExecutable,
          indexesRoot: plateSolveIndexesRoot,
          timeoutMs: plateSolveTimeoutMs,
          solverVersion: plateSolveSolverVersion,
          scaleLowDeg,
          scaleHighDeg,
          searchRadiusDeg,
        },
      })
    }
    if (input.admissionMode !== 'production')
      return yield* configFailure(
        'ASTRO_ADMISSION_MODE must be development or production',
      )
    if (
      Option.isNone(input.issuer) ||
      Option.isNone(input.audience) ||
      Option.isNone(input.jwksUrl) ||
      Option.isNone(input.bootstrapPath) ||
      Option.isNone(input.localOwnerPort) ||
      Option.isNone(input.clientContext) ||
      (input.clientContext.value !== 'desktop' &&
        input.clientContext.value !== 'phone')
    )
      return yield* configFailure(
        'Production admission requires Access issuer, audience, HTTPS JWKS URL, bootstrap path, local owner port, client context, and integer JWKS cache TTL',
      )
    if (Option.isSome(input.fixture))
      return yield* configFailure(
        'Local fixtures require development admission and loopback binding',
      )
    const clientContext = input.clientContext.value
    if (clientContext !== 'desktop' && clientContext !== 'phone')
      return yield* configFailure(
        'Production admission requires a desktop or phone client context',
      )
    if (
      !URL.canParse(input.jwksUrl.value) ||
      new URL(input.jwksUrl.value).protocol !== 'https:'
    )
      return yield* configFailure('CF Access JWKS URL must use HTTPS')
    if (Number(input.cacheTtl) < 1_000 || Number(input.cacheTtl) > 3_600_000)
      return yield* configFailure(
        'CF Access JWKS cache TTL must be between 1000 and 3600000 ms',
      )
    return yield* Effect.succeed<OriginServerConfig>({
      runtime: {
        databasePath,
        release,
        port: Number(input.port),
        host: input.bind,
        webDistPath,
        previewRoot,
        originalsRoot,
        localOwnerPort: Number(input.localOwnerPort.value),
        ...(Option.isSome(input.remoteDesktopPort)
          ? { remoteDesktopPort: Number(input.remoteDesktopPort.value) }
          : {}),
      },
      admission: {
        mode: 'production' as const,
        issuer: input.issuer.value,
        audience: input.audience.value,
        jwksUrl: input.jwksUrl.value,
        bootstrapPath: input.bootstrapPath.value,
        clientContext,
        cacheTtlMs: Number(input.cacheTtl),
      },
      fixture: undefined,
      downloadGrant:
        Option.isSome(input.downloadGrantUrl) &&
        Option.isSome(input.downloadGrantSecretPath)
          ? {
              url: input.downloadGrantUrl.value,
              secretPath: input.downloadGrantSecretPath.value,
            }
          : undefined,
      preflightProvider,
      simulation: undefined,
      plateSolve: {
        executable: plateSolveExecutable,
        indexesRoot: plateSolveIndexesRoot,
        timeoutMs: plateSolveTimeoutMs,
        solverVersion: plateSolveSolverVersion,
        scaleLowDeg,
        scaleHighDeg,
        searchRadiusDeg,
      },
    })
  })
}

function configuredDevelopmentSimulation(input: {
  readonly simulationMode: string
  readonly simulatorOrigin: Option.Option<string>
  readonly simulatorScenario: Option.Option<string>
  readonly simulatorCorpusRoot: Option.Option<string>
}) {
  if (input.simulationMode === 'disabled') return Effect.succeed(undefined)
  if (input.simulationMode !== 'alpaca')
    return configFailure('ASTRO_SIMULATION_MODE must be disabled or alpaca')
  const origin = Option.getOrUndefined(input.simulatorOrigin)
  const launchScenario = Option.getOrUndefined(input.simulatorScenario)
  if (
    origin === undefined ||
    launchScenario === undefined ||
    !URL.canParse(origin) ||
    !isSimulationScenario(launchScenario)
  )
    return configFailure(
      'Alpaca simulation requires a loopback simulator origin and known scenario.',
    )
  const url = new URL(origin)
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '[::1]') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  )
    return configFailure(
      'Alpaca simulation requires a plain HTTP loopback origin without credentials or a path.',
    )
  return Effect.succeed({
    origin: url.origin,
    launchScenario,
    ...(Option.isSome(input.simulatorCorpusRoot)
      ? { corpusRoot: input.simulatorCorpusRoot.value }
      : {}),
  })
}

function isSimulationScenario(
  value: string,
): value is AlpacaSimulationScenario {
  return alpacaSimulationScenarios.some((scenario) => scenario === value)
}

function alpacaProviderOrigin(provider: PreflightProviderConfig) {
  return new URL(`http://${provider.host}:${provider.port}`).origin
}

function configuredPreflightProvider(input: {
  readonly preflightProvider: string
  readonly preflightRigId: string
  readonly preflightHost: Option.Option<string>
  readonly preflightPort: Option.Option<string>
  readonly preflightTelescopeDeviceNumber: Option.Option<string>
  readonly preflightTelescopeUniqueId: Option.Option<string>
  readonly preflightCameraDeviceNumber: Option.Option<string>
  readonly preflightCameraUniqueId: Option.Option<string>
  readonly preflightFocuserDeviceNumber: Option.Option<string>
  readonly preflightFocuserUniqueId: Option.Option<string>
  readonly preflightFilterWheelDeviceNumber: Option.Option<string>
  readonly preflightFilterWheelUniqueId: Option.Option<string>
}) {
  if (input.preflightProvider === 'disabled') return Effect.succeed(undefined)
  if (input.preflightProvider !== 'alpaca')
    return configFailure('ASTRO_PREFLIGHT_PROVIDER must be disabled or alpaca')
  const host = Option.getOrUndefined(input.preflightHost)
  const port = Option.getOrUndefined(input.preflightPort)
  const device = (
    number: Option.Option<string>,
    uniqueId: Option.Option<string>,
  ): AlpacaDeviceConfig | undefined => {
    const value = Option.getOrUndefined(number)
    if (value === undefined) return undefined
    if (!/^\d+$/.test(value)) return { deviceNumber: -1 }
    const id = Option.getOrUndefined(uniqueId)
    return id === undefined
      ? { deviceNumber: Number(value) }
      : { deviceNumber: Number(value), uniqueId: id }
  }
  const devices = {
    camera: device(
      input.preflightCameraDeviceNumber,
      input.preflightCameraUniqueId,
    ),
    telescope: device(
      input.preflightTelescopeDeviceNumber,
      input.preflightTelescopeUniqueId,
    ),
    focuser: device(
      input.preflightFocuserDeviceNumber,
      input.preflightFocuserUniqueId,
    ),
    filterWheel: device(
      input.preflightFilterWheelDeviceNumber,
      input.preflightFilterWheelUniqueId,
    ),
  }
  if (
    host === undefined ||
    port === undefined ||
    !/^\d+$/.test(port) ||
    Number(port) > 65_535 ||
    Object.values(devices).some((entry) => entry?.deviceNumber === -1) ||
    Object.values(devices).every((entry) => entry === undefined)
  )
    return configFailure(
      'Alpaca preflight requires host, port, and at least one configured device number.',
    )
  return Effect.gen(function* () {
    const validHost = yield* validText(host, 'Alpaca preflight host is invalid')
    const rigId = yield* validText(
      input.preflightRigId,
      'Alpaca rig ID is invalid',
    )
    return {
      kind: 'alpaca' as const,
      rigId,
      host: validHost,
      port: Number(port),
      devices: {
        ...(devices.camera === undefined ? {} : { camera: devices.camera }),
        ...(devices.telescope === undefined
          ? {}
          : { telescope: devices.telescope }),
        ...(devices.focuser === undefined ? {} : { focuser: devices.focuser }),
        ...(devices.filterWheel === undefined
          ? {}
          : { filterWheel: devices.filterWheel }),
      },
    }
  })
}

export const publisherEnvironmentConfig = Config.all({
  accountId: text('R2_ACCOUNT_ID'),
  bucket: text('R2_BUCKET'),
  credentialsPath: text('R2_CREDENTIALS_PATH'),
  databasePath: migratedText('ASTRO_SERVER_DB', 'ASTRO_LOCAL_WEB_DB'),
  endpoint: text('R2_ENDPOINT'),
  outputsRoot: text('ASTRO_PUBLISHER_OUTPUTS_ROOT'),
}).pipe(
  Config.mapOrFail(
    (input): Effect.Effect<R2PublisherConfig, Config.ConfigError> => {
      if (!/^[a-f0-9]{32}$/.test(input.accountId))
        return configFailure(
          'R2 account ID must be 32 lowercase hexadecimal characters',
        )
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket))
        return configFailure('R2 bucket name is invalid')
      if (
        input.endpoint !== `https://${input.accountId}.r2.cloudflarestorage.com`
      )
        return configFailure('R2 endpoint must be the account S3 endpoint')
      if (!/^\/run\/secrets\/[A-Za-z0-9._-]+$/.test(input.credentialsPath))
        return configFailure('R2 credential path must be a mounted secret')
      if (
        !input.databasePath.startsWith('/var/lib/astro-console/') ||
        !/^\/var\/lib\/astro-console\/outputs(?:\/|$)/.test(
          input.outputsRoot,
        ) ||
        [input.databasePath, input.outputsRoot].some((path) =>
          /[\r\n]|(?:^|\/)\.\.(?:\/|$)/.test(path),
        )
      )
        return configFailure(
          'Publisher paths must be absolute app-owned container paths',
        )
      return Effect.succeed(input)
    },
  ),
)

export const processorEnvironmentConfig = Config.all({
  databasePath: migratedOptional('ASTRO_SERVER_DB', 'ASTRO_LOCAL_WEB_DB'),
  manifestPath: optional('ASTRO_PROCESSOR_MANIFEST_PATH'),
  mode: text('ASTRO_PROCESSOR_MODE', 'disabled'),
  originalsRoot: optional('ASTRO_PROCESSOR_ORIGINALS_ROOT'),
  outputsRoot: optional('ASTRO_PROCESSOR_OUTPUTS_ROOT'),
  ownerPersonId: optional('ASTRO_PROCESSOR_OWNER_PERSON_ID'),
  sourcesRoot: optional('ASTRO_PROCESSOR_SOURCES_ROOT'),
}).pipe(
  Config.mapOrFail(
    (input): Effect.Effect<ProcessorConfig, Config.ConfigError> => {
      if (input.mode === 'disabled') return Effect.succeed({ mode: 'disabled' })
      if (input.mode !== 'manifest')
        return configFailure(
          'ASTRO_PROCESSOR_MODE must be disabled or manifest',
        )
      if (
        Option.isNone(input.databasePath) ||
        Option.isNone(input.sourcesRoot) ||
        Option.isNone(input.originalsRoot) ||
        Option.isNone(input.outputsRoot) ||
        Option.isNone(input.manifestPath) ||
        Option.isNone(input.ownerPersonId)
      )
        return configFailure(
          'Manifest processor requires database, source root, originals root, output root, manifest path, and owner person ID',
        )
      const databasePath = input.databasePath.value
      const sourcesRoot = input.sourcesRoot.value
      const originalsRoot = input.originalsRoot.value
      const outputsRoot = input.outputsRoot.value
      const manifestPath = input.manifestPath.value
      const ownerPersonId = input.ownerPersonId.value
      if (
        !databasePath.startsWith('/var/lib/astro-console/') ||
        !sourcesRoot.startsWith('/var/lib/astro-console/') ||
        !originalsRoot.startsWith('/var/lib/astro-console/') ||
        !outputsRoot.startsWith('/var/lib/astro-console/') ||
        !manifestPath.startsWith('/run/config/') ||
        /[\r\n]|(?:^|\/)\.\.(?:\/|$)/.test(
          `${databasePath}/${sourcesRoot}/${originalsRoot}/${outputsRoot}/${manifestPath}`,
        ) ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ownerPersonId)
      )
        return configFailure(
          'Manifest processor paths must be app-owned and manifest host-managed',
        )
      return Effect.succeed({
        mode: 'manifest',
        databasePath,
        sourcesRoot,
        originalsRoot,
        outputsRoot,
        manifestPath,
        ownerPersonId,
      })
    },
  ),
)

export const downloadGrantSignerConfig = Config.all({
  accountId: text('R2_ACCOUNT_ID'),
  bucket: text('R2_BUCKET'),
  credentialsPath: text('R2_DOWNLOAD_CREDENTIALS_PATH'),
  endpoint: text('R2_ENDPOINT'),
  port: text('ASTRO_DOWNLOAD_GRANT_PORT', '8791'),
  secretPath: text('ASTRO_DOWNLOAD_GRANT_SHARED_SECRET_PATH'),
}).pipe(
  Config.mapOrFail((input) => {
    if (!/^\d+$/.test(input.port) || Number(input.port) > 65_535)
      return configFailure(
        'ASTRO_DOWNLOAD_GRANT_PORT must be an integer from 0 to 65535',
      )
    if (
      !/^[a-f0-9]{32}$/.test(input.accountId) ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket) ||
      !/^\/run\/secrets\/[A-Za-z0-9._-]+$/.test(input.credentialsPath) ||
      !/^\/run\/secrets\/[A-Za-z0-9._-]+$/.test(input.secretPath)
    )
      return configFailure(
        'Download grant signer requires bounded R2 read credentials and a shared secret',
      )
    if (
      input.endpoint !== `https://${input.accountId}.r2.cloudflarestorage.com`
    )
      return configFailure(
        'Download grant signer requires the account R2 endpoint',
      )
    return Effect.succeed({ ...input, port: Number(input.port) })
  }),
)
