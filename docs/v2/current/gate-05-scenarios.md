# Gate 5 Scenario And State-Ownership Draft

Status: **scenario and state-ownership baseline accepted July 22, 2026;
consequential-action map also accepted**

Gate 5 translates the accepted Gates 1–4 interaction model into executable
contracts. It does not redesign the workspaces. This first deliverable fixes
the shared scenarios and ownership boundaries in product language before
production schemas, transports, or persistence layouts are selected.

## How To Read This Draft

Each scenario describes one observable product promise. Later Gate 5 work must
give every consequential action in these scenarios:

- an authorization and eligibility rule;
- one named intent command;
- revision or freshness preconditions where relevant;
- a deterministic accepted result and durable evidence;
- a typed rejection before physical or durable action; and
- snapshot and event projections sufficient for desktop and read-only phone.

The scenario IDs are stable references for fixtures and tests. They are not
user-visible workflow names.

## State Classes

| Class | Meaning | Recovery expectation |
| --- | --- | --- |
| **Canonical durable** | Service truth that must survive browser loss and service restart | Restored from durable records and reconciled where physical truth may have changed |
| **Canonical ephemeral** | Service-owned coordination that is current but need not become permanent history | Recreated, expired, or reconciled without inventing durable history |
| **External observation** | Device, tool, host, or infrastructure fact reported across a trust boundary | Decoded and timestamped; never treated as fresh indefinitely |
| **Client-transient** | Navigation or an interaction not yet synchronized to the service | Exists only for the current page lifetime; refresh may discard it and the server snapshot always wins |
| **Derived presentation** | Labels, summaries, ordering, and visual emphasis computed from canonical facts | Recomputed from the latest authoritative projection |

### Stateless Web Contract

The web app holds no authoritative or durable domain state. On initial load or
refresh it installs the server snapshot as the complete current truth. It does
not merge that snapshot with an older browser copy of runs, leases, processing
sessions, assets, or synchronized settings.

Ordinary in-page interaction may exist briefly in memory. Anything that has
not reached the service is allowed to disappear on refresh. This includes a
slider movement still inside its debounce window, unsent text, selection,
focus, an open modal, and a held comparison gesture.

Process settings use automatic debounced synchronization:

1. The control changes immediately in the current page.
2. After a suitable debounce interval, the client sends the complete preview
   settings with the expected processing revision.
3. The service validates and stores the accepted temporary preview state and
   computes or updates its preview output.
4. A refresh discards browser memory and shows only the latest preview state
   accepted by the service. At most the still-unsent debounce window is lost.
5. **Apply** appends the previewed operation to the service-owned edit history.
6. **Save to Library** creates the selected durable Library artifacts.

Automatic preview synchronization is not Apply, and Apply is not Save to
Library. Those boundaries remain explicit even though all accepted state is
held by the service.

## Shared Scenario Set

### Shell, Workspaces, And Client Freshness

| ID | Starting truth | Intent or trigger | Deterministic outcome | Contract promise |
| --- | --- | --- | --- | --- |
| `SHELL-01` | An accepted run is active | The operator moves among Plan, Observe, Library, and Process | The workspace changes; the compact global surface continues to show the same run and `Return to Observe` | Navigation never starts, stops, transfers, or reconstructs service work |
| `SHELL-02` | A service-level warning becomes relevant outside its owning workspace | The service publishes attention | The shell announces it; the owning workspace contains the resolution action | The shell may route attention but never duplicates domain commands |
| `CLIENT-01` | A client has a current snapshot and event stream | Its stream disconnects during accepted work | Mutations disable; last-confirmed time and preview age remain visible; service work continues | Loss of browser freshness is not loss of observatory execution |
| `CLIENT-02` | Durable or synchronized service state changes while a client is disconnected | A fresh snapshot arrives | Browser domain state is discarded; the canonical projection is atomically replaced, changes while away are summarized, then newer events are consumed | Reconnect is snapshot-first; the server always overrides and commands are never buffered or replayed |
| `CLIENT-03` | A delayed or duplicate event predates the installed snapshot/cursor | The event arrives | It is ignored and cannot rewind the projection | Event ordering is subordinate to the installed snapshot boundary |
| `PHONE-01` | Desktop and phone consume the same observatory truth | The phone renders any accepted scenario | It shows current state, evidence, warnings, freshness, presence, and controller without mutations | Phone is a capability projection, not a separate state model |

### Plan And Active-Run Mutation

| ID | Starting truth | Intent or trigger | Deterministic outcome | Contract promise |
| --- | --- | --- | --- | --- |
| `RUN-01` | A validated plan draft exists, the desktop holds the current control lease, and no conflicting run start has occurred | `Run plan` is issued with the expected lease revision | The service creates an immutable `RunDefinition` and starts a distinct active run | Starting physical work requires the exclusive lease; later draft changes cannot silently mutate accepted execution |
| `RUN-02` | M27 is active at run revision 12 | Add future NGC 7000 work after M27 | The service classifies it `nonDisruptive`; Apply advances the run once and records the exact future diff | Current physical work and evidence remain untouched |
| `RUN-03` | Later targets remain queued | Reorder them in a way that changes forecast or viability | The service returns `notice` with exact schedule consequences; Apply occurs only after review | Clients do not infer impact from control names or phase |
| `RUN-04` | An exposure is active | Switch to another target now | The service returns `disruptive` with elapsed exposure loss, discarded provisional evidence, movement, and reacquisition; only explicit bound approval may apply it | High-impact approval is tied to the previewed revision and consequences |
| `RUN-05` | A proposed change is unsafe, impossible, stale, or unauthorized | The client requests a preview or apply | The service returns `ineligible` or a typed rejection with valid alternatives; nothing changes | An invalid proposal performs no partial mutation or physical action |
| `RUN-06` | A client prepared a revision-12 change; another client advanced the run to 13 | The first client applies its old preview | The service rejects it and returns current truth; an in-page unsent edit may remain for review, but refresh discards it | Every accepted runtime mutation advances exactly once; stale intent reaches no hardware |

### Presence And Exclusive Control

| ID | Starting truth | Intent or trigger | Deterministic outcome | Contract promise |
| --- | --- | --- | --- | --- |
| `LEASE-01` | The owner holds the exclusive lease; a friend is viewing | The friend requests control | A request becomes visible to its intended audience; the friend remains a viewer | Presence and request state grant no authority |
| `LEASE-02` | A valid request exists | The owner explicitly grants it | The lease revision advances once and the named desktop becomes eligible for future mutations | Grant is explicit, exclusive, and globally visible |
| `LEASE-03` | A remote controller disconnects during an accepted run | Presence becomes stale | The lease enters visible reconnect grace; the run continues; expiry releases to no controller | Disconnect neither stops work nor silently transfers control |
| `LEASE-04` | A friend holds or is reconnecting under the current lease | The owner takes control | The lease revision advances and future eligibility moves to the owner; already accepted work continues | Takeover is separate from stop, pause, or cancellation |
| `LEASE-05` | Maya issued `Skip remaining M27 frames` while controlling, but delivery is delayed until after takeover | The service receives the in-flight old-lease command | It rejects `ControlLeaseLost`, records no physical action, and does not retry | Lease revision protects races; browsers do not buffer or resend |
| `LEASE-06` | A viewer or phone lacks mutation capability | It attempts a guarded intent | The service rejects it as read-only or lease-required before domain action | Hidden controls are UX; server authorization is the invariant |

### Acquire: Image-Derived Verification And Recovery

| ID | Starting truth | Intent or trigger | Deterministic outcome | Contract promise |
| --- | --- | --- | --- | --- |
| `ACQ-01` | A valid solve is outside centering tolerance, inside the automatic bound, and a correction attempt remains | The policy evaluates the solve | The exact correction runs automatically and a new capture/solve verification begins | Eligible bounded correction is activity, not an approval prompt |
| `ACQ-02` | A solve has no solution and retry budget remains | The failed attempt is recorded | No offset or movement is offered; the next bounded solve attempt begins automatically | Failed evidence is append-only and unknown offset stays unknown |
| `ACQ-03` | The final allowed solve attempt fails | The budget becomes exhausted; the operator chooses a materially different longer exposure | Acquire starts one separately bounded recovery series under the changed parameters, or follows another explicit recovery choice | Parameter change may earn a new bounded chance; exhaustion never permits an indefinite retry loop |
| `ACQ-04` | A valid solve requests movement beyond the automatic bound | The correction is proposed | The exact RA/Dec or image-axis correction and consequence require approval or revision | Large physical movement never inherits automatic eligibility |
| `ACQ-05` | A correction command was accepted by the mount | A new frame is captured and solved | Acquire completes only if image evidence is within tolerance; otherwise another eligible correction or recovery follows | Driver acceptance is provisional; image evidence verifies outcome |
| `ACQ-06` | Polar measurement is outside tolerance | The latest solved geometry is evaluated | The service records the measurement and projects physical Alt/Az guidance; the user adjusts the mount and requests another measurement | Manual guidance is not represented as a motor command |
| `ACQ-07` | The latest polar measurement is within tolerance after operator adjustment | The operator selects `Accept and continue` | Acquire records the accepted completion evidence and continues | The operator who performed the physical adjustment decides when the guided activity is complete |

### Process: Build, Develop, Recovery, And Library Handoff

| ID | Starting truth | Intent or trigger | Deterministic outcome | Contract promise |
| --- | --- | --- | --- | --- |
| `PROC-01` | Stable raw source asset IDs are selected | Open in Process | A service-owned session begins in Build with immutable source lineage | Storage paths and provider keys never become workflow identity |
| `PROC-02` | A compatible existing linear stack is selected | Open in Process | A service-owned session may begin directly in Develop with the stack as linear reference | Build work is not invented or rerun when a valid master already exists |
| `PROC-03` | A Develop step and compatible tool are selected | Parameters or sliders change | The client debounces and sends complete preview settings; the service validates and stores the accepted temporary preview, then computes from the current valid input while the prior image remains visible | At most the pre-debounce change is lost on refresh; synchronized preview is not applied history and never replaces the last valid image during computation |
| `PROC-04` | A valid preview exists at the expected processing revision | Apply is issued | One non-destructive operation and its provenance are appended; the revision advances once | Only explicit Apply changes the current history |
| `PROC-05` | Applied history has earlier and later positions | Undo or Redo is issued | The service moves the single history position and selects the corresponding output | Undo/redo is linear history, not user-visible branching |
| `PROC-06` | The user undoes and then applies a different operation | Apply is accepted | The redo path is replaced; temporary cached outputs may remain implementation detail | The product exposes one current result and history position |
| `PROC-07` | Assistant analysis has an explained suggestion | Preview suggestion is selected | Proposed values load as a temporary preview with visible differences; Apply remains explicit | Assistance may propose but never mutate by itself or steal focus |
| `PROC-08` | Stretch fails after a valid linear checkpoint | Retry Stretch is issued against the current revision and checkpoint | A new Stretch attempt begins; unaffected Build outputs remain untouched | Retry scope is stage-local and stated before execution |
| `PROC-09` | Ordinary capture is active and host pressure is healthy | Processing and capture overlap | Processing continues normally | Capture activity alone is never a throttle reason |
| `PROC-10` | Measured memory, storage, throughput, or thermal pressure threatens acquisition or host health | Host policy evaluates pressure | Processing throttles or exceptionally pauses with the measured reason; observatory health remains separately represented | Resource protection follows evidence, not a generic capture flag |
| `PROC-11` | A processing session continues without the browser | The browser refreshes or reconnects | A fresh authoritative session snapshot renders the ordinary current state | The browser does not reconstruct the processing job from local history |
| `PROC-12` | A synchronized working session has not been saved to Library or discarded | Switch data is requested | The user chooses Leave unfinished and switch, Save to Library and switch, Discard and switch, or Cancel; the service applies exactly that disposition | Source switching cannot silently destroy work; an unfinished session remains a resumable working resource rather than becoming a Library asset |
| `PROC-13` | One or more output formats are selected | Save to Library is issued | The service creates related durable assets with stable IDs, lineage, formats, and provenance | Several outputs may be saved; none is crowned the sole final |
| `PROC-14` | Unsaved derived work or scratch exists | Discard is explicitly confirmed | Eligible unsaved history, previews, and scratch are removed; sources and saved assets survive | Destructive scope is exact and source evidence is protected |

### Library, Assets, And Availability

| ID | Starting truth | Intent or trigger | Deterministic outcome | Contract promise |
| --- | --- | --- | --- | --- |
| `LIB-01` | Frames and derived outputs share lineage | The operator opens Library review or comparison | Library projects stable identities, evidence, provenance, and related artifacts without changing them | Library owns durable review and saved-result comparison |
| `LIB-02` | A local-only original is authorized for download | Download is requested | A LAN request streams from Arch; a remote request uses a valid staged R2 copy or progresses from preparing to ready before R2 delivery; failures are typed and the local original remains authoritative | Delivery routing follows access path while availability remains independent of asset identity and observing health |
| `LIB-03` | A published representation expires while a permanent local result remains | Republish is requested | A new delivery representation may be created under the same stable asset identity | Expiry never deletes or renames the canonical local asset |
| `LIB-04` | A saved asset or valid linear stack is selected | Open in Process is issued | Process receives stable asset IDs and starts at the phase justified by the source role | Workspace handoff transfers identity and lineage, not filesystem location |

## State Ownership Table

| State or decision | Class | Canonical owner | Client responsibility | Must not happen |
| --- | --- | --- | --- | --- |
| Observatory, rig, site, and capability identity | Canonical durable | Astro Console service | Render named capabilities and limitations | Infer capability from visible controls or browser history |
| Membership (`owner` or `viewer`) | Canonical durable | Astro Console service after ingress identity admission | Project permitted experience | Treat Cloudflare identity or client claims as local authorization |
| Immutable `RunDefinition` and active execution state | Canonical durable | Observing control plane | Render the accepted run across every workspace | Tie execution to the page that started it |
| Source plan revision and active run revision | Canonical durable | Observing control plane | Send expected revision with guarded intents; keep raw IDs secondary | Rewrite the source plan when the run changes |
| Pending mutation classification, eligibility, and exact consequences | Canonical ephemeral | Observing control plane | Explain the returned classification and available action | Reimplement impact policy from button names or phase |
| Accepted mutation classification and consequences | Canonical durable | Observing control plane | Preserve them with the applied mutation evidence | Reclassify accepted history from current client policy |
| Accepted mutation history and evidence | Canonical durable | Observing control plane | Show semantic summaries and inspectable detail | Record a rejected or partially applied mutation as success |
| Current physical/workflow projection | Canonical ephemeral | Observing control plane reconciled with external observation | Render freshness and uncertainty honestly | Equate command acceptance with verified physical outcome |
| Acquire policy snapshot and attempt budgets | Canonical durable | Observing control plane | Explain why automatic action or recovery is eligible | Let each browser count attempts independently |
| Acquisition attempts, frames, solves, corrections, and verification lineage | Canonical durable | Observing control plane and Library asset domain | Render latest evidence and selectable history | Replace failed attempts or manufacture an offset from no solution |
| Device state and command acknowledgement | External observation | MiniPC drivers and rig devices, decoded by Astro Console | Show timestamp and provisional status where appropriate | Treat driver success as lasting physical proof |
| Snapshot version and event cursor | Canonical ephemeral | Astro Console service | Atomically install snapshot, then accept only subsequent events | Merge a fresh snapshot into stale browser-owned domain state |
| Client freshness and last-confirmed time | Canonical ephemeral | Astro Console service and active connection | Disable mutations while stale and show age | Present disconnected evidence as current |
| Presence and connection quality | Canonical ephemeral | Astro Console service | Show viewers and freshness without implying authority | Convert presence into control |
| Control requests and exclusive lease | Canonical ephemeral | Observing control plane; transfer events are durable evidence | Send expected lease revision and project explicit eligibility | Grant on request, disconnect, navigation, or reconnect |
| Processing session identity, lifecycle, source lineage, applied operations, and history position | Canonical durable | Processing service within Astro Console; durability lasts through the resumable working-session lifecycle | Render the current or resumed editor from its snapshot | Treat the session itself as a Library asset or reconstruct history from mounted UI components |
| Parameter change still inside its debounce window | Client-transient | Active desktop page | Display it optimistically until synchronization succeeds or authoritative state replaces it | Persist it locally, present it as applied, or let it override the server after refresh |
| Accepted temporary preview identity, parameters, progress, and output | Canonical ephemeral | Processing service | Display against its input/revision and retain the last valid image while computing | Add it to applied history before Apply |
| Selected processing step, context tab, modal, and held-comparison gesture | Client-transient | Active page | Manage focus, navigation, and accessibility for the current page lifetime | Require durable domain events or local persistence for ordinary view state |
| Assistant findings and evidence | Canonical durable | Processing service; retained for the working-session lifecycle | Announce unread state without stealing focus; request preview explicitly | Auto-apply, silently dismiss, or invent findings in the renderer |
| Processing checkpoints, attempts, failures, and provenance | Canonical durable | Processing service; retention may differ after Save or Discard | Show retry scope and owner-safe diagnostics | Restart unaffected stages or expose secrets/paths |
| Tool installation, compatibility, version, and boundary output | External observation | Processing adapter registry/service normalizes it into current facts | Offer only returned compatible choices | Trust undecoded CLI output or client-declared compatibility |
| Host resource measurements | External observation | Host resource monitor | Show measured pressure with time and affected subsystem | Infer contention merely because capture is active |
| Throttle or pause decision | Canonical ephemeral | Host resource policy; measurements provide diagnostic evidence | Explain the returned reason and recovery | Let the browser pause work from generic heuristics |
| Asset identity, checksums, lineage, role, and saved representations | Canonical durable | Library domain within Astro Console | Refer only by stable asset ID and user-facing metadata | Expose filesystem paths or R2 keys as identity |
| Local/R2 availability and publication lifecycle | Canonical durable | Artifact publisher and Library domain reconcile external storage observations | Distinguish local, preparing, published, expiring, expired, and failed | Equate publication failure with asset loss or observatory failure |
| Workspace, selected row, open Inspector, and unsent text | Client-transient | Active page | Hold only for the current page lifetime; derive initial state from URL and server snapshot where applicable | Advance revisions, authorize operations, or override the server after refresh |
| Semantic labels, warning order, ages, progress summaries, and visual emphasis | Derived presentation | Client using service-provided facts and eligibility | Recompute accessibly from the current projection | Create new canonical truth or security policy in presentation code |
| Phone mutation capability | Canonical durable | Astro Console capability policy, enforced server-side | Render the same truth without mutation controls | Rely only on responsive CSS to prevent commands |
| Public tunnel availability | External observation | Cloudflare/cloudflared observed by Astro Console | Report remote-access health separately | Treat tunnel failure as stopped service, rig, or run |

## Contract Details To Set During Gate 5

These are bounded contract choices, not reopened UX questions:

1. **Acquire evidence retention.** Attempts remain append-only for the active
   run and its durable diagnostic record. Gate 5 must distinguish permanent
   asset evidence from disposable detailed diagnostics without changing the
   visible attempt history during the run.
2. **Policy values.** Centering tolerance, correction bounds, retry budgets,
   polar tolerance, and controller grace are versioned policy values in
   fixtures—not universal constants embedded in commands.
3. **Control-request audience.** Authorization and lease semantics are fixed;
   the precise audience for a pending request remains a projection policy.
4. **Reconnect summaries.** Durable events remain canonical. How many are
   summarized in the immediate reconnect surface is a projection concern.
5. **Idempotency.** Physically consequential and durable commands require an
   idempotency boundary in addition to revision checks so transport retry
   cannot duplicate an accepted action.

The stateless-browser and debounced-preview behavior are now accepted contract
requirements, not open details.

## Accepted Owner Decisions

- `RUN-01`: `Run plan` requires the current exclusive control lease.
- `ACQ-03`: materially changed solve parameters start a new, separately
  bounded recovery series after ordinary attempts are exhausted.
- `ACQ-07`: polar alignment waits for the operator's explicit
  `Accept and continue` after reaching tolerance.
- `PROC-12`: a synchronized Process session may remain unfinished and
  resumable while the operator switches data. The session is a durable working
  resource, not a Library asset. Save creates Library assets; Discard removes
  eligible working state and scratch.
- `LIB-02`: the permanent original stays on the Arch host and one `Download`
  intent routes by access path:

    - a LAN request streams directly from Arch;
    - a remote request uses an existing valid temporary R2 copy when present;
    - otherwise Arch stages a temporary private R2 copy, the asset becomes
      `preparing`, and the browser downloads from R2 through a short-lived
      grant when ready.

  The staged copy is disposable delivery state, not a second source of truth.
  Its expiry does not affect the stable asset or permanent local original.

## First Deliverable Acceptance

The owner reviewed the shared scenarios and accepted the state-ownership
baseline after resolving the decisions above. No material product choice
remains open before consequential-action mapping. Policy values and projection
details may remain configurable without changing the accepted contract.

## Review Checkpoint

Before writing schemas, confirm that:

- the scenario set covers every product promise that could materially change
  the service contract;
- the ownership table places no observatory, run, lease, processing, or asset
  truth in the browser;
- client-transient state is limited to the current page's navigation and
  genuinely unsynchronized work;
- external observations remain timestamped and decoded at their boundaries;
- the bounded contract details above preserve the accepted UX; and
- no scenario introduces recipes, processing branches, automatic Assistant
  application, capture-triggered processing pause, or phone mutation.
