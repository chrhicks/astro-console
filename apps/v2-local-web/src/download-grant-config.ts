import { readFileSync } from "node:fs"
import * as Schema from "effect/Schema"
import type { DownloadGrantIssuer } from "./r2-download-grant.ts"

const GrantResponse = Schema.Struct({ url: Schema.NonEmptyString })
export function configuredDownloadGrantIssuer(env: Record<string, string | undefined>): DownloadGrantIssuer | undefined {
  const endpoint = env.ASTRO_DOWNLOAD_GRANT_URL; const secretPath = env.ASTRO_DOWNLOAD_GRANT_SHARED_SECRET_PATH
  if (endpoint === undefined && secretPath === undefined) return undefined
  if (!endpoint || !secretPath || !/^\/run\/secrets\/[A-Za-z0-9._-]+$/.test(secretPath)) throw new Error("Download grants require an internal URL and mounted shared secret")
  if (endpoint !== "http://download-grant:8791/internal/download-grants") throw new Error("Download grant URL must be the fixed private signer endpoint")
  const url = new URL(endpoint)
  let secret: string
  try { secret = readFileSync(secretPath, "utf8").trim() } catch { throw new Error("Download grant shared secret is unreadable") }
  if (secret.length < 32 || /[\r\n]/.test(secret)) throw new Error("Download grant shared secret is invalid")
  return { issue: async (input) => { const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(5_000) }); if (!response.ok) throw new Error("Download grant signer is unavailable"); const text = await response.text(); if (Buffer.byteLength(text) > 16_384) throw new Error("Download grant signer response is too large"); return Schema.decodeUnknownSync(GrantResponse)(JSON.parse(text)).url } }
}
