import { createHash, createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import * as Schema from "effect/Schema"

const Credentials = Schema.Struct({ accessKeyId: Schema.NonEmptyString, secretAccessKey: Schema.NonEmptyString })
export type DownloadGrantIssuer = { readonly issue: (input: { readonly objectKey: string; readonly expiresAt: string }) => Promise<string> }

export function createR2DownloadGrantIssuer(config: { readonly bucket: string; readonly endpoint: string; readonly credentialsPath: string; readonly now?: () => Date }): DownloadGrantIssuer {
  let rawCredentials: unknown
  try { rawCredentials = JSON.parse(readFileSync(config.credentialsPath, "utf8")) } catch { throw new Error("R2 credentials are unreadable") }
  if (typeof rawCredentials !== "object" || rawCredentials === null || Object.keys(rawCredentials).sort().join(",") !== "accessKeyId,secretAccessKey") throw new Error("R2 credentials are invalid")
  let credentials: typeof Credentials.Type
  try { credentials = Schema.decodeUnknownSync(Credentials)(rawCredentials) } catch { throw new Error("R2 credentials are invalid") }
  const now = config.now ?? (() => new Date())
  return { issue: async ({ objectKey, expiresAt }) => {
    if (!/^published\/[A-Za-z0-9._/-]+$/.test(objectKey) || objectKey.includes("//") || objectKey.includes("..")) throw new Error("R2 object key is outside the publisher prefix")
    const expiresSeconds = Math.floor((Date.parse(expiresAt) - now().valueOf()) / 1_000)
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > 300) throw new Error("R2 download grant expiry must be between one second and five minutes")
    const url = new URL(`/${config.bucket}/${objectKey.split("/").map(encodeURIComponent).join("/")}`, config.endpoint)
    const amzDate = now().toISOString().replace(/[:-]|\.\d{3}/g, ""); const date = amzDate.slice(0, 8); const scope = `${date}/auto/s3/aws4_request`
    const query = new URLSearchParams({ "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${credentials.accessKeyId}/${scope}`, "X-Amz-Date": amzDate, "X-Amz-Expires": String(expiresSeconds), "X-Amz-SignedHeaders": "host" })
    const canonicalQuery = [...query.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&")
    const canonicalRequest = `GET\n${url.pathname}\n${canonicalQuery}\nhost:${url.host}\n\nhost\nUNSIGNED-PAYLOAD`; const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), "auto"), "s3"), "aws4_request")
    query.set("X-Amz-Signature", createHmac("sha256", signingKey).update(`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`).digest("hex")); url.search = query.toString()
    return url.toString()
  } }
}

function hmac(key: string | Buffer, value: string) { return createHmac("sha256", key).update(value).digest() }
