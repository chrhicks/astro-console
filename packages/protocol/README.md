# Astro Console Protocol

`@astro-console/protocol` is the private, version-matched wire module shared by
the Astro Console origin and browser. It owns Effect Schema validation for the
remote-but-owned HTTP and SSE seam:

- stable wire identities and primitives;
- HTTP request, response, and failure schemas;
- bootstrap and SSE projection schemas; and
- wire notices and focused validation tests.

It does not own aggregate state, authority, eligibility, transitions, receipts,
work, settlement, cursor policy, presentation helpers, fixtures, or simulation.
Those responsibilities stay behind the existing server lifecycle interfaces or
inside the web runtime.

## Verification

```sh
npm run check --workspace @astro-console/protocol
```

The root `build`, `check`, and `test` workflows build this module before the
server and web callers. This is the required ordering because the private
package exports generated `dist` files.

## Former root classification

Issue #2 classified every module exported by the former
`@astro-console/v2-contracts` root before the prototype harness was removed.

| Former root module          | Classification                            | Disposition                                                                                                                                 |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `acquire`                   | mixed shared protocol and server domain   | Retained only wire projection fields; aggregate state and transitions moved to the Acquire lifecycle.                                       |
| `acquire-command`           | shared protocol                           | Retained as request and response schemas.                                                                                                   |
| `camera-command`            | shared protocol                           | Retained as request, response, and observation schemas.                                                                                     |
| `commands`                  | shared protocol                           | Retained as the generic command wire union; policy helpers were removed.                                                                    |
| `client`                    | browser runtime                           | Removed; cursor and connection behavior is tested through the web bootstrap client.                                                         |
| `control`                   | server domain                             | Removed; production authority and transitions stay in the Control lifecycle.                                                                |
| `events`                    | mixed server domain and browser runtime   | Removed; server events stay with their lifecycle and SSE cursor policy stays in the web bootstrap client.                                   |
| `failures`                  | shared protocol                           | Retained as serialized command and operation failures.                                                                                      |
| `gate`                      | server domain                             | Removed; production lifecycle interfaces own authority and eligibility.                                                                     |
| `idempotency`               | server domain                             | Removed; production lifecycle receipts own idempotency.                                                                                     |
| `asset-domain`              | mixed shared protocol and server domain   | Retained only Library wire review and inspection schemas; intake and asset decisions stay in the server.                                    |
| `bootstrap`                 | mixed shared protocol and browser runtime | Retained only bootstrap and SSE schemas; presentation helpers moved to server projection and web presentation modules.                      |
| `bootstrap-fixtures`        | test-only                                 | Moved to the web test runtime.                                                                                                              |
| `processing-project-domain` | mixed shared protocol and server domain   | Retained only Project requests, projections, evidence, notices, and errors; aggregate state and transitions moved to the Project lifecycle. |
| `processing-pressure`       | unused server prototype                   | Deleted; it was not used by the production lifecycle.                                                                                       |
| `plan-command`              | shared protocol                           | Retained as request and response schemas.                                                                                                   |
| `observe-command`           | shared protocol                           | Retained as request and response schemas.                                                                                                   |
| `observe`                   | shared protocol                           | Retained as the Observe projection schema.                                                                                                  |
| `primitives`                | shared protocol                           | Retained stable wire identities and constrained values; freshness helper objects were removed.                                              |
| `snapshots`                 | shared protocol                           | Retained actual Acquire and Library HTTP projection schemas; legacy aggregate projection helpers were removed.                              |
| `run`                       | server domain                             | Removed; accepted Run codecs stay with the Run lifecycle.                                                                                   |
| `preflight`                 | shared protocol                           | Retained as Preflight request, response, and projection schemas.                                                                            |

## Production proof replacement

The deleted Gate simulations and proof harnesses no longer establish product
behavior. Their consequential cases are covered at the owning production
interfaces:

| Former proof area                                                                          | Current production-level coverage                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Control authority, freshness, idempotency, and SSE publication                             | `apps/server/src/server.integration.test.ts` through the Control HTTP lifecycle.                            |
| Run start, mutation, intervention, worker settlement, and restart                          | `apps/server/src/server.integration.test.ts` and `apps/server/src/integration/run-executor-worker.test.ts`. |
| Acquire recovery, correction, evidence, settlement, and restart                            | Server integration coverage plus `development-target-acquisition.test.ts`.                                  |
| Library intake, review, delivery, lineage, and restart                                     | Server integration coverage through the Library lifecycle.                                                  |
| Processing Project authority, revisions, attempts, results, evidence, work, and settlement | `apps/server/src/integration/processing-project-lifecycle.test.ts`.                                         |
| Snapshot/SSE cursor, reconnect, malformed payload, and presentation behavior               | Actual web bootstrap, command client, projection, and promoted workspace tests.                             |

These checks prove local wire compatibility and server/browser behavior. They
do not prove external providers, observatory hardware, physical capture, or
real processing quality.
