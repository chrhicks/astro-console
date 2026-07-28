import * as Schema from "effect/Schema"

const PublisherConfig = Schema.Struct({ accountId: Schema.String, bucket: Schema.String, endpoint: Schema.String, credentialsPath: Schema.String, databasePath: Schema.String, outputsRoot: Schema.String })
export type R2PublisherConfig = typeof PublisherConfig.Type

export function publisherConfig(env: Record<string, string | undefined>): R2PublisherConfig {
  const accountId = env.R2_ACCOUNT_ID; const bucket = env.R2_BUCKET; const endpoint = env.R2_ENDPOINT; const credentialsPath = env.R2_CREDENTIALS_PATH; const databasePath = env.ASTRO_LOCAL_WEB_DB; const outputsRoot = env.ASTRO_PUBLISHER_OUTPUTS_ROOT
  if (!accountId || !bucket || !endpoint || !credentialsPath || !databasePath || !outputsRoot) throw new Error("Publisher requires R2 account, bucket, endpoint, credential path, database path, and outputs root")
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error("R2 account ID must be 32 lowercase hexadecimal characters")
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("R2 bucket name is invalid")
  if (endpoint !== `https://${accountId}.r2.cloudflarestorage.com`) throw new Error("R2 endpoint must be the account S3 endpoint")
  if (!credentialsPath.startsWith("/run/secrets/") || /[\r\n]/.test(credentialsPath)) throw new Error("R2 credential path must be a mounted secret")
  if (!databasePath.startsWith("/var/lib/astro-console/") || !/^\/var\/lib\/astro-console\/outputs(?:\/|$)/.test(outputsRoot) || [databasePath, outputsRoot].some((path) => /[\r\n]|(?:^|\/)\.\.(?:\/|$)/.test(path))) throw new Error("Publisher paths must be absolute app-owned container paths")
  return Schema.decodeUnknownSync(PublisherConfig)({ accountId, bucket, endpoint, credentialsPath, databasePath, outputsRoot })
}
