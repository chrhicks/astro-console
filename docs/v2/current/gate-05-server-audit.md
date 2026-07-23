# Gate 5 Server-Perspective Audit

Status: **complete — Gate 5 closed after hardening July 22, 2026**

This audit asks a stricter question than “does the fixture pass?”:

> If a future server implemented this contract literally, does the fixture
> prove the consequential product claim, including what changes, what survives,
> what work is emitted, and what must happen atomically?

It does not select HTTP routes, database tables, or adapters. It does identify
transaction, durable-work, and error-channel requirements that those later
choices must preserve.

## Evidence Grades

- **Transition proof** — executes the domain decision and asserts its important
  result, rejection, or invariant.
- **Partial proof** — exercises a real component but omits a consequential part
  of the accepted scenario.
- **Shape only** — proves that data can be constructed or decoded, not that the
  server behavior is correct.

These evidence grades are tracked independently from test filenames. The
repository reserves `[domain].proof.test.ts` for deterministic server
simulations; ordinary `*.test.ts` files remain schema, pure-decision, invariant,
and regression tests.

## Proof-Test Contract

A server-impacting scenario earns proof coverage only when a
`*.proof.test.ts` exercises the relevant composition:

```text
unknown request + trusted request context
  -> decode
  -> authority/freshness/idempotency
  -> pure domain decision
  -> atomic aggregate/event/result/outbox commit
  -> authoritative projection
```

The proof asserts both positive and negative evidence. Rejection must leave no
aggregate change, durable event, accepted receipt, or queued external work.
Acceptance must not execute the adapter inside the transaction. Races use
`Deferred`, `Latch`, `Queue`, `Ref`, or explicit transaction hooks rather than
timing sleeps.

Not every scenario requires its own file. Proofs should be organized by domain
and race boundary—for example:

- `run-start.proof.test.ts`
- `run-mutation.proof.test.ts`
- `control-authority.proof.test.ts`
- `acquire-evidence.proof.test.ts`
- `processing-session.proof.test.ts`
- `asset-delivery.proof.test.ts`

Every server-impacting accepted scenario must map to at least one proof. A
presentation-only scenario may remain a focused unit test when the audit states
why no server composition is involved. Real SQLite, filesystem, CLI, worker, or
R2 behavior uses `*.integration.test.ts` and does not replace the deterministic
proof.

## Reopened Baseline

| Grade | Scenarios | What it means now |
| --- | --- | --- |
| Transition proof | `SHELL-01..02`, `PROC-09` | The narrow claim exercised by the fixture is actually decided and asserted; later integration does not own the missing product meaning |
| Partial proof | `CLIENT-01..03`, `PHONE-01`, `RUN-01..06`, `LEASE-01..06`, `ACQ-01..07`, `PROC-03..08`, `PROC-10..14`, `LIB-02..04` | A real rule or function is present, but the fixture omits consequential state, evidence, work, rejection, projection, or atomicity from the accepted scenario |
| Shape only | `PROC-01..02`, `LIB-01` | The fixture currently constructs state or checks identity without executing the named handoff or review behavior |

`RUN-01` improved from shape-only to partial proof after the audit added
`RunDefinition`, readiness evaluation, active-run exclusion, precondition-token
validation, initial `ActiveRun` state, and an explicit `BeginRun` work item. It
does not yet freeze enough plan content to execute independently or prove that
state, event, idempotency result, and outbox work commit atomically.

## Final Regrade

| Evidence | Scenarios | Result |
| --- | --- | --- |
| Presentation-state proof | `SHELL-01..02` | Workspace selection and attention routing have no server mutation; focused tests prove they preserve domain authority |
| Client composition proof | `CLIENT-01..03`, `PHONE-01` | Snapshot-first reconnect, cursor gaps, disconnected commands, last-confirmed truth, and per-action phone eligibility share one canonical projection |
| Run composition proof | `RUN-01..06` | Executable frozen definitions, exact limitation acceptance, server-derived mutation impact, named interventions, atomic outbox acceptance, replay, and races |
| Control composition proof | `LEASE-01..06` | Exclusive ownership, requests, presence/grace, takeover, expiry, stale rejection, and independent ownership revision |
| Acquire composition proof | `ACQ-01..07` | Append-only solve evidence, bounded and changed-parameter recovery, exact correction acknowledgement and verification, proposal binding, and explicit polar acceptance |
| Process composition proof | `PROC-01..14` | Source handoff, synchronized preview, full-resolution Apply, linear history, assistance, retry, reconnect, multi-asset Save, discard, and switching |
| Asset composition proof | `LIB-01..04` | Stable identity, atomic multi-artifact creation, projection/comparison, local versus remote delivery, expiry, republication, and Process handoff |

All 43 baseline scenarios now have evidence proportional to their claim. The
full package passes 176 tests across 21 suites. The scenario catalog remains a
readable trace index; the proof files, rather than a filename change to that
catalog, establish the server-facing claims.

## Correctness Defects Found

These were not merely missing assertions. A future server implementing the
baseline functions literally would have violated accepted behavior. Each
defect below was corrected during hardening.

1. **Control ownership revision was over-advanced.** It is now an ownership
   epoch advanced only by grant, release, takeover, and expiry. Request
   coordination and reconnect presence serialize through an internal version.
2. **Process Apply claimed completion too early.** It now starts a correlated
   full-resolution attempt, preserves the prior valid image, and changes
   applied history only after worker completion.
3. **Process Save terminated the working session.** It now materializes all
   selected outputs, creates several Assets atomically after bytes are durable,
   and leaves the ProcessingSession available for continued work.
4. **Open in Process accepted unsupported Asset roles.** It now accepts only
   source roles that justify Build or Develop and handles both new and resumable
   Processing sessions through the shared authority.
5. **Run mutation trusted caller-supplied impact.** The service now derives
   typed consequences from the proposal, binds disruptive approval to exact
   evidence, mutates only future work, and emits the required outbox work.
6. **Acquire evidence was not correlated.** Append-only attempts now bind solve
   frames, exact correction vectors, movement acknowledgements, verification
   images, bounded recovery series, and the latest polar measurement.

## Shared Server Acceptance Thought Experiment

Every command that mutates durable state or starts asynchronous work must fit
this ordering:

```text
decode command and trusted request context
  -> begin authoritative transaction
  -> reserve or classify idempotency key
  -> read and lock/CAS current aggregate revisions and authority
  -> run shared gate and pure domain decision
  -> atomically persist:
       aggregate changes
       durable events
       recorded command result
       outbox work
       projection cursor/version facts
  -> commit
  -> execute hardware, CLI, filesystem, R2, or network work outside transaction
  -> commit correlated worker completion/failure in a later transaction
```

The pure gate alone cannot close a race. If Maya reads lease 5, the owner commits
takeover to lease 6, and Maya then commits from her stale read, physical work can
escape unless revision comparison and outbox insertion share the authoritative
transaction.

Required race fixtures include both serializations:

- takeover first: delayed command becomes `ControlLeaseLost` and creates no
  accepted event, result, or work;
- old command first: its already accepted work survives later takeover, which
  affects only future eligibility.

## Completed Hardening

### P0 — Establish truthful foundations

1. **Atomic acceptance/outbox contract** — model the database-visible unit
   described above, canonical idempotency uniqueness/hash rules, and safe replay
   ordering. Sensitive recorded results such as download grants require current
   resource authorization even when rig commands replay before lease freshness.
2. **Correct known contradictions** — ownership revision, Process Apply, Process
   Save, and Open-in-Process role validation must be fixed before adding more
   green fixtures around them.
3. **Cross-field state invariants** — reject impossible states such as an
   available lease with a holder, reconnecting without holder/deadline, or a
   Process history position beyond history length.

### P1 — Rebuild consequential domain slices

1. **Start Process from sources** — decide Build versus Develop from source
   roles, freeze source lineage, reject unavailable or incompatible sources, and
   emit only the required initial work.
2. **Run execution content and mutation preview** — expand `RunDefinition` to
   contain executable accepted plan settings; classify mutations server-side;
   compute typed consequences, expiry, and approval binding; emit abort,
   movement, and reacquisition work where required.
3. **Acquire evidence model** — replace the counter sketch with stored bounded
   recovery series and immutable, correlated acquisition/solve/correction/polar
   attempts. Exact movement comes from vector evidence, never scalar magnitude.
4. **Assistant proposal** — prove that an explained finding can populate
   temporary Preview without changing applied history or focus.
5. **Process reconnect** — install one authoritative `ProcessingSession`
   snapshot and prove synchronized preview, history position, active attempt,
   and failure state survive without browser reconstruction.
6. **Protected switching** — prove all dispositions. `saveAndSwitch` must fail
   closed if any selected save fails; `discardAndSwitch` may proceed after a
   durable tombstone even if asynchronous scratch cleanup later warns.
7. **Save to Library** — create several related Assets with stable IDs,
   lineage, formats, and provenance in one accepted result; do not merely mark
   the Process session saved.
8. **Library and delivery lifecycle** — project related saved results without
   mutating them and without introducing Process branches.
   Model requested representation selection, expiry, begin/reuse staging,
   publication completion/failure, checksums, and stable identity.
9. **Authority scenario composition** — make `LEASE-05`, `LEASE-06`, and
   `PHONE-01` exercise the shared command gate and resulting projection as one
   scenario rather than proving the halves in unrelated tests.

### P2 — Strengthen canonical projections

- Phone and desktop must derive from one canonical core while receiving
  different per-action eligibility. A single `mutationsEnabled` Boolean is too
  broad.
- `AppSnapshot` needs enough controller identity/device, named control request,
  presence, run/evidence/warning, preview age, and last-confirmed information to
  render the accepted scenarios.
- Process snapshots require source facts, base/current valid output, preview
  specification/progress, attempts, checkpoint/failure state, findings, saved
  asset links, and pressure facts.
- Asset projections require checksum, format, source lineage, provenance, and
  comparison grouping rather than only `relatedAssetIds`.

## External Work Boundary

Actual hardware, Siril/RCAstro, filesystem, and R2 behavior remains later
integration work, but its acceptance contract is not deferred. In particular,
Save is two-phase because permanent bytes cannot share a SQLite transaction:

1. safely materialize and checksum every selected output without publishing
   successful Asset metadata;
2. only after all bytes are durable, atomically create all Asset roots/events
   and record the idempotent result.

A crash may leave removable orphan bytes. It must never leave an Asset that
claims nonexistent bytes.

## Effect Handling Rule

The audit also found excessive manual discriminator checks. Repository guidance
now requires:

- exhaustive `$match` for `Data.TaggedEnum` decisions;
- exhaustive `match` for `Schema.TaggedUnion` boundary data;
- `Schema.TaggedErrorClass` for expected Effect service failures; and
- `Effect.catchTag`, `catchTags`, or another typed recovery operator instead of
  manual error-tag string checks.

See [Effect Guidance](../../../EFFECT_GUIDANCE.md). Direct `_tag` comparison is
not the primary dispatch or recovery mechanism in production contract source.

## Exit Rule

Gate 5 closed after every partial or shape-only scenario either:

1. maps to a passing proof test that establishes the consequential server
   behavior it claims; or
2. has an explicit, reviewed reason that the behavior belongs to a later
   integration layer, plus a precise contract that layer must prove.

The exit decision rests on that mapping and the reviewed external-work
boundary, not on the passing test count alone.
