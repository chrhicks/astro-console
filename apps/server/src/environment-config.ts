import { Config, ConfigProvider, Effect, Option } from 'effect'
import type { ProcessorConfig } from './processor-config.ts'
import type { R2PublisherConfig } from './publisher-config.ts'
import type { RigWorkerConfig } from './rig-worker-config.ts'

const optional = (name: string) => Config.option(Config.string(name))
const text = (name: string, fallback?: string) =>
  fallback === undefined
    ? Config.string(name)
    : Config.string(name).pipe(Config.withDefault(fallback))
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
  readonly fixture: 'm27' | 'plan-draft' | undefined
  readonly downloadGrant:
    { readonly url: string; readonly secretPath: string } | undefined
}

export const originServerConfig = Config.all({
  admissionMode: text('ASTRO_ADMISSION_MODE', 'development'),
  audience: optional('CF_ACCESS_AUDIENCE'),
  bind: text('ASTRO_LOCAL_WEB_BIND', '127.0.0.1'),
  bootstrapPath: optional('ASTRO_MEMBERSHIP_BOOTSTRAP_PATH'),
  cacheTtl: text('CF_ACCESS_JWKS_CACHE_TTL_MS', '300000'),
  client: text('ASTRO_LOCAL_WEB_CLIENT', 'owner'),
  clientContext: optional('ASTRO_CLIENT_CONTEXT'),
  databasePath: text('ASTRO_LOCAL_WEB_DB', './.astro-local-web/state.sqlite'),
  fixture: optional('ASTRO_LOCAL_WEB_FIXTURE'),
  issuer: optional('CF_ACCESS_ISSUER'),
  jwksUrl: optional('CF_ACCESS_JWKS_URL'),
  port: text('ASTRO_LOCAL_WEB_PORT', '0'),
  release: text('ASTRO_RELEASE', 'local-web-fixture'),
  webDistPath: text('ASTRO_WEB_DIST', '../web/dist'),
  downloadGrantUrl: optional('ASTRO_DOWNLOAD_GRANT_URL'),
  downloadGrantSecretPath: optional('ASTRO_DOWNLOAD_GRANT_SHARED_SECRET_PATH'),
}).pipe(
  Config.mapOrFail(
    (input): Effect.Effect<OriginServerConfig, Config.ConfigError> => {
      if (input.bind !== '127.0.0.1' && input.bind !== '0.0.0.0')
        return configFailure(
          'ASTRO_LOCAL_WEB_BIND must be 127.0.0.1 or 0.0.0.0',
        )
      if (!/^\d+$/.test(input.port) || Number(input.port) > 65_535)
        return configFailure(
          'ASTRO_LOCAL_WEB_PORT must be an integer from 0 to 65535',
        )
      if (!/^\d+$/.test(input.cacheTtl))
        return configFailure(
          'Production admission requires Access issuer, audience, HTTPS JWKS URL, bootstrap path, client context, and integer JWKS cache TTL',
        )
      if (
        Option.isSome(input.fixture) &&
        input.fixture.value !== 'm27' &&
        input.fixture.value !== 'plan-draft'
      )
        return configFailure(
          'ASTRO_LOCAL_WEB_FIXTURE must be m27 or plan-draft when set',
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
  readonly port: string
  readonly release: string
  readonly webDistPath: string
  readonly downloadGrantUrl: Option.Option<string>
  readonly downloadGrantSecretPath: Option.Option<string>
}) {
  return Effect.gen(function* () {
    const fixture =
      Option.isSome(input.fixture) &&
      (input.fixture.value === 'm27' || input.fixture.value === 'plan-draft')
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
    if (input.admissionMode === 'development') {
      if (input.bind !== '127.0.0.1')
        return yield* configFailure(
          'Fixture admission requires loopback development binding',
        )
      return yield* Effect.succeed<OriginServerConfig>({
        runtime: {
          databasePath,
          release,
          port: Number(input.port),
          host: input.bind,
          webDistPath,
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
      Option.isNone(input.clientContext) ||
      (input.clientContext.value !== 'desktop' &&
        input.clientContext.value !== 'phone')
    )
      return yield* configFailure(
        'Production admission requires Access issuer, audience, HTTPS JWKS URL, bootstrap path, client context, and integer JWKS cache TTL',
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
    })
  })
}

export const rigWorkerEnvironmentConfig = Config.all({
  databasePath: text('ASTRO_LOCAL_WEB_DB'),
  host: optional('ASTRO_SEESTAR_HOST'),
  mode: text('ASTRO_RIG_WORKER_MODE', 'disabled'),
  pemPath: optional('ASTRO_SEESTAR_PEM_PATH'),
}).pipe(
  Config.mapOrFail(
    (input): Effect.Effect<RigWorkerConfig, Config.ConfigError> => {
      if (!input.databasePath || /[\r\n]/.test(input.databasePath))
        return configFailure('Rig worker requires ASTRO_LOCAL_WEB_DB')
      if (input.mode === 'disabled')
        return Effect.succeed({
          mode: 'disabled',
          databasePath: input.databasePath,
        })
      if (input.mode !== 'seestar')
        return configFailure(
          'ASTRO_RIG_WORKER_MODE must be disabled or seestar',
        )
      if (Option.isNone(input.host) || input.host.value !== '192.168.4.63')
        return configFailure(
          'Seestar worker requires ASTRO_SEESTAR_HOST=192.168.4.63',
        )
      if (
        Option.isNone(input.pemPath) ||
        !input.pemPath.value ||
        /[\r\n]/.test(input.pemPath.value)
      )
        return configFailure('Seestar worker requires ASTRO_SEESTAR_PEM_PATH')
      return Effect.succeed({
        mode: 'seestar',
        databasePath: input.databasePath,
        rigId: 'seestar-s30',
        host: input.host.value,
        pemPath: input.pemPath.value,
      })
    },
  ),
)

export const publisherEnvironmentConfig = Config.all({
  accountId: text('R2_ACCOUNT_ID'),
  bucket: text('R2_BUCKET'),
  credentialsPath: text('R2_CREDENTIALS_PATH'),
  databasePath: text('ASTRO_LOCAL_WEB_DB'),
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
  databasePath: optional('ASTRO_LOCAL_WEB_DB'),
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

export type SolarCliConfig = {
  readonly databasePath: string
  readonly subject: string
  readonly command:
    | { readonly action: 'stop'; readonly intentId: string }
    | {
        readonly action: 'submit'
        readonly name: string
        readonly idempotencyKey: string
      }
}

export const solarCliConfig = Config.all({
  action: text('ASTRO_SOLAR_TEST_ACTION', 'submit'),
  confirm: text('ASTRO_SOLAR_TEST_CONFIRM'),
  databasePath: text('ASTRO_LOCAL_WEB_DB', './.astro-local-web/state.sqlite'),
  idempotencyKey: optional('ASTRO_SOLAR_TEST_IDEMPOTENCY_KEY'),
  intentId: optional('ASTRO_SOLAR_TEST_INTENT_ID'),
  name: optional('ASTRO_SOLAR_TEST_NAME'),
  subject: text('ASTRO_SOLAR_TEST_SUBJECT'),
}).pipe(
  Config.mapOrFail(
    (input): Effect.Effect<SolarCliConfig, Config.ConfigError> => {
      if (input.confirm !== 'submit-solar-test')
        return configFailure(
          'Solar test intent requires ASTRO_SOLAR_TEST_CONFIRM=submit-solar-test',
        )
      if (input.action !== 'submit' && input.action !== 'stop')
        return configFailure('ASTRO_SOLAR_TEST_ACTION must be submit or stop')
      const required = input.action === 'stop' ? input.intentId : input.name
      if (
        Option.isNone(required) ||
        !required.value ||
        /[\r\n]/.test(required.value)
      )
        return configFailure(
          `Solar test intent requires ${input.action === 'stop' ? 'ASTRO_SOLAR_TEST_INTENT_ID' : 'ASTRO_SOLAR_TEST_NAME'}`,
        )
      if (input.action === 'stop')
        return Effect.succeed({
          databasePath: input.databasePath,
          subject: input.subject,
          command: { action: 'stop' as const, intentId: required.value },
        })
      if (
        Option.isNone(input.idempotencyKey) ||
        !input.idempotencyKey.value ||
        /[\r\n]/.test(input.idempotencyKey.value)
      )
        return configFailure(
          'Solar test intent requires ASTRO_SOLAR_TEST_IDEMPOTENCY_KEY',
        )
      return Effect.succeed({
        databasePath: input.databasePath,
        subject: input.subject,
        command: {
          action: 'submit' as const,
          name: required.value,
          idempotencyKey: input.idempotencyKey.value,
        },
      })
    },
  ),
)
