# Storage And Artifact Delivery

## 1. Selected Model

Use three storage tiers with different purposes:

| Tier | Location | Contents | Retention |
| --- | --- | --- | --- |
| Source archive | Arch host | Original camera files, acquired FITS, immutable source evidence | Long-lived; owner-controlled cleanup only |
| Processing workspace | Arch host | Working copies, calibration/alignment outputs, temporary stacks, caches | Disposable after job/retry window unless promoted |
| Published artifacts | Private Cloudflare R2 bucket | User-selected intermediates, copies of final outputs, previews, downloadable exports | Lifecycle-controlled by prefix/class |

The metadata database on Arch remains canonical for asset identity, provenance,
checksums, storage locations, publication state, and expiry. R2 is an artifact
store and delivery path, not the source of active-run or processing-job truth.

## 2. Why R2

R2 is a good fit for published processing artifacts because it provides:

- private buckets with an S3-compatible API;
- outbound upload from the Arch processing/publisher service;
- short-lived presigned browser downloads without exposing R2 credentials;
- lifecycle rules that delete objects by prefix after a configured age;
- multipart uploads for large FITS/stacks; and
- no internet egress-bandwidth charge under the documented pricing model.

As of July 21, 2026, R2 Standard costs `$0.015/GB-month` after a monthly
`10 GB-month` free tier, plus operation charges. Holding the current sample's
roughly 113 GiB of processing directories for a full month would cost about
`(113 - 10) × $0.015 = $1.55/month`, excluding operations. Real cost should be
lower when disposable artifacts expire sooner, but pricing must be rechecked
before deployment.

Use Standard rather than Infrequent Access for short-lived processing
artifacts: Standard has no minimum retention, while Infrequent Access has a
30-day minimum and retrieval charges.

## 3. Object Classes And Prefixes

One private bucket can start with explicit prefixes:

```text
published/
  <observatory-id>/
    <target-or-run-id>/
      previews/
      intermediates/
      finals/
      staged-raws/
```

- `previews/`: small browser representations; regenerate or expire quickly.
- `intermediates/`: promoted processing steps the user may inspect/download;
  expire after a moderate window.
- `finals/`: final exports; retain longer, but not necessarily forever.
- `staged-raws/`: temporary R2 copies created only when a remote raw download
  should avoid repeated home-upstream transfer; expire after download window.

Do not upload all processing scratch. A job explicitly promotes an artifact
before upload. This avoids paying to store Siril/RCAstro working trees that are
large, reproducible, and rarely downloaded.

## 4. Suggested Initial Retention

These are starting policies to validate with actual use:

| Prefix/class | Local | R2 | Starting expiry |
| --- | --- | --- | --- |
| Raw originals | Permanent archive | Not uploaded by default | Owner-controlled locally |
| Processing scratch | Working volume | Never uploaded automatically | Delete 7 days after successful job, or retain while failed/retryable |
| Published previews | Optional cache | Yes | 30 days; regenerate if source remains |
| Published intermediates | Until R2 upload/checksum succeeds | Yes | 30 days |
| Final outputs | Permanent local archive | Yes | R2 copy expires after 90 days |
| Staged raw downloads | Source stays local | On demand | 24–72 hours |

R2 lifecycle expiration is asynchronous and may occur after the nominal
expiry. The local metadata record should project `available`, `expiring`,
`expired`, or `republishing`; it must not promise that an object exists merely
because its database row remains.

Deletion of local scratch requires a successful terminal processing job and
verified publication for every promoted artifact. Never let a cloud lifecycle
rule delete the only raw source.

## 5. Publication Flow

1. Processing reads immutable local raws and writes local scratch.
2. The user selects one or more explicit output/format/role combinations.
3. The service materializes and checksums every selected permanent local file.
   No Library Asset may claim success while any selected file is incomplete.
4. After every file is durable, one metadata transaction creates all selected
   Asset roots, lineage/events, the recorded command result, and any publication
   outbox work. A crash before this transaction may leave removable orphan
   files, but never successful Asset metadata pointing to missing bytes.
5. The publisher computes or verifies size, media type, provenance, and expiry
   class, then uploads to private R2 using a least-privilege bucket token.
6. The publisher verifies object metadata/checksum and records the correlated
   R2 representation as ready.
7. The UI exposes the representation as downloadable.
8. Local scratch cleanup occurs independently according to retention policy.

The processing worker may upload through a narrow publisher service so it does
not hold general R2 delete/list credentials. Publication retries are
idempotent by stable object key and checksum.

## 6. Download Flow

### Initial Path: Short-Lived Presigned URLs

1. Friend authenticates to `observatory.chicks.dev` through Cloudflare Access
   using Google or email OTP.
2. Astro Console authorizes the requested asset ID and representation.
3. For an R2 object, Astro Console creates a short-lived presigned `GET` URL.
4. Browser downloads directly from R2, removing the Arch home's upstream link
   from the data path.

The R2 bucket remains private. A presigned URL is a bearer token: anyone who
receives it can download that one object until it expires. Use short expiries
(for example, five minutes), do not log full URLs, and issue a new grant for
each deliberate download. Presigned URLs use the R2 S3 endpoint rather than a
custom domain.

### Local-Only Original

One `Download` intent routes by the authorized request path:

- A LAN request streams directly from Astro Console on Arch with bounded
  concurrency.
- A remote request uses an existing valid staged R2 copy when present.
- Otherwise, the remote request starts asynchronous preparation: Arch stages
  the original into private `staged-raws/`, the asset reports `preparing`, and
  the browser downloads directly from R2 through a short-lived grant when
  ready.

The staging copy expires after the accepted 48-hour window. It is disposable
delivery state, not a second source of truth; the stable asset identity and
permanent local original remain on Arch.

### Later Path: Worker Download Gateway

If bearer URLs or the R2 hostname become undesirable, add a small Worker at a
custom hostname with an R2 binding. It can validate a short-lived Astro
Console-issued download grant and stream the object. Do not add this complexity
until the presigned path proves insufficient.

## 7. Download Scope

Trusted friends may download:

- original FITS and camera files;
- promoted intermediary processing artifacts;
- final FITS/TIFF/PNG/JPEG outputs;
- previews and diagnostics selected for publication.

“May download anything” does not mean public bucket listing or arbitrary object
keys. The Library enumerates authorized app-owned assets. Requests use stable
asset IDs and the service resolves the local path or R2 object key.

## 8. Failure Behavior

- R2 unavailable: processing and local raw retention continue; publication is
  retryable and downloads show temporarily unavailable.
- Arch offline: previously published R2 presigned URLs remain usable until
  expiry, but new grants require the local authoritative service.
- Upload interrupted: retain local artifact and resume/retry multipart upload.
- Lifecycle expiration: metadata remains as provenance but the R2
  representation is marked expired; permanent local finals may be republished
  directly, while intermediates can be regenerated from sources and recipes.
- Local disk pressure: delete eligible scratch/cache first; never silently
  delete raw originals.
- Checksum mismatch: do not publish or clean the local source artifact.

## 9. Credentials And Boundaries

- Keep the R2 bucket private; do not enable `r2.dev` public access.
- Give the publisher only required bucket/prefix permissions.
- Keep R2 credentials in a Compose secret mounted only into the publisher.
- Never send R2 API credentials to the browser.
- Treat presigned URLs as secrets and exclude their query strings from logs.
- Record actor, asset ID, representation, grant time, and expiry—not the signed
  URL itself.
- Lifecycle administration is an owner operation, separate from ordinary
  processing jobs.
