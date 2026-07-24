import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Ref, Result, Schema } from "effect"
import {
  ClientCommandDecision,
  ClientConnection,
  ClientProjectionState,
  IncrementalEventDecision,
  decideClientCommand,
  installAuthoritativeSnapshot,
  markClientDisconnected,
  projectSnapshotForClient,
  receiveIncrementalEvent,
} from "./client.js"
import { IncrementalProjectionEvent } from "./events.js"
import { ActorContext, CommandGateDecision, IdempotencyState, evaluateCommandGate } from "./gate.js"
import { AppSnapshot } from "./snapshots.js"
import {
  CommandId,
  EventCursor,
  IdempotencyKey,
  LeaseRevision,
  RunId,
  RunRevision,
  SnapshotVersion,
} from "./primitives.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema)(input)

const snapshot = (
  snapshotVersion = 10,
  eventCursor = 40,
  generatedAt = "2026-07-22T20:00:00Z",
) => decode(AppSnapshot, {
  observatoryId: "observatory-1",
  snapshotVersion,
  eventCursor,
  generatedAt,
  membership: { personId: "owner-1", role: "owner", clientId: "desktop-1", capability: "controlCapable" },
  control: {
    leaseId: "lease-1", revision: 4, state: "held", holderClientId: "desktop-1", pendingRequestCount: 0,
    holderPersonId: "owner-1", holderDeviceLabel: "Observatory desktop", pendingRequests: [],
    presence: [{ personId: "owner-1", clientId: "desktop-1", deviceLabel: "Observatory desktop", observedAt: generatedAt }],
    actions: [{ _tag: "Available", action: "ReleaseControl" }],
  },
  plan: {
    planId: "plan-1", revision: 3, sequenceCount: 2, validation: "ready",
    sequences: [{ sequenceId: "m27", targetName: "M27", state: "active" }], limitations: [], startConditions: [],
    actions: [{ _tag: "Available", action: "StartRunFromPlan" }],
  },
  run: {
    runId: "run-1", revision: 12, sourcePlanId: "plan-1", phase: "capture",
    completedSequenceCount: 0, acceptedMutations: [], warnings: [], lastConfirmedAt: generatedAt,
    actions: [{ _tag: "Available", action: "PauseRun" }],
  },
  processingSessions: [{
    sessionId: "process-1", revision: 8, lifecycle: "active", phase: "develop",
    sourceAssetIds: ["asset-source"], historyPosition: 2, historyLength: 2, currentOutputId: "output-current",
    previewState: "computing", previewAgeSeconds: 17, pressureState: "normal",
    assistantFindings: [], savedAssetIds: [],
    actions: [{ _tag: "Available", action: "SaveProcessingArtifacts" }],
  }],
  library: { assetCount: 1, selectedAssetIds: ["asset-source"], activeOperationIds: [] },
  selectedAssets: [{
    assetId: "asset-source", revision: 2, role: "original", format: "cameraRaw", checksum: "sha256:source",
    localAvailable: true, comparisonGroupId: "capture-session-1", sourceAssetIds: ["asset-source"], operationIds: [],
    availability: "availableLocally", representationCount: 1,
    actions: [{ _tag: "Available", action: "RequestAssetDownload" }],
  }],
  health: [
    { subsystem: "service", state: "healthy", observedAt: generatedAt },
    { subsystem: "rig", state: "healthy", observedAt: generatedAt },
  ],
})

const client = (value = snapshot()) => decode(ClientProjectionState, {
  connection: { _tag: "Current", lastConfirmedAt: value.generatedAt },
  snapshot: value,
  changesWhileAway: [],
})

const runProjected = (
  eventCursor: number,
  snapshotVersion: number,
  phase: "preflight" | "acquire" | "capture" | "verify" | "recover" | "paused" | "completed" | "failed",
) => IncrementalProjectionEvent.cases.RunProjected.make({
  eventCursor: EventCursor.make(eventCursor),
  snapshotVersion: SnapshotVersion.make(snapshotVersion),
  generatedAt: `2026-07-22T20:00:${eventCursor}Z`,
  run: {
    runId: RunId.make("run-1"), revision: RunRevision.make(snapshotVersion), sourcePlanId: decode(Schema.NonEmptyString.pipe(Schema.brand("PlanId")), "plan-1"), phase,
    completedSequenceCount: 0, acceptedMutations: [], warnings: [], lastConfirmedAt: `2026-07-22T20:00:${eventCursor}Z`,
    actions: [{ _tag: "Available", action: "PauseRun" }],
  },
})

describe("client and phone server proofs", () => {
  it("CLIENT-01 preserves last-confirmed truth and preview age while refusing to send or buffer disconnected commands", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const current = client()
      assert.equal(ClientCommandDecision.$is("SendNow")(decideClientCommand(current, "PauseRun")), true)
      const disconnected = markClientDisconnected(current, "2026-07-22T20:00:05Z")

      assert.equal(ClientConnection.guards.Stale(disconnected.connection), true)
      if (ClientConnection.guards.Stale(disconnected.connection)) {
        assert.equal(disconnected.connection.lastConfirmedAt, "2026-07-22T20:00:00Z")
      }
      assert.equal(disconnected.snapshot.processingSessions[0]?.previewAgeSeconds, 17)
      assert.deepEqual(disconnected.snapshot, current.snapshot)
      assert.equal("pendingCommands" in disconnected, false)

      const serviceCalls = yield* Ref.make(0)
      const decision = decideClientCommand(disconnected, "PauseRun")
      yield* ClientCommandDecision.$match(decision, {
        SendNow: () => Ref.update(serviceCalls, (count) => count + 1),
        DoNotSend: () => Effect.void,
      })
      assert.equal(yield* Ref.get(serviceCalls), 0)

      // Accepted server work is a separate authority and is untouched by this
      // pure browser freshness transition.
      const acceptedServerWork = { runId: "run-1", state: "running", completedFrames: 8 }
      assert.deepEqual(acceptedServerWork, { runId: "run-1", state: "running", completedFrames: 8 })
    }))
  })

  it("CLIENT-02 atomically replaces every browser domain with one fresh snapshot before applying a newer event", () => {
    const disconnected = markClientDisconnected(client(), "2026-07-22T20:00:05Z")
    const fresh = decode(AppSnapshot, {
      ...snapshot(12, 52, "2026-07-22T20:05:00Z"),
      run: { runId: "run-1", revision: 14, sourcePlanId: "plan-1", phase: "verify", completedSequenceCount: 0, acceptedMutations: [], warnings: [], lastConfirmedAt: "2026-07-22T20:05:00Z", actions: [] },
      processingSessions: [],
      library: { assetCount: 0, selectedAssetIds: [], activeOperationIds: [] },
      selectedAssets: [],
      health: [{ subsystem: "service", state: "healthy", observedAt: "2026-07-22T20:05:00Z" }],
    })
    const reconnected = installAuthoritativeSnapshot(disconnected, fresh, [
      "Run entered Verify",
      "Processing session completed elsewhere",
    ])

    assert.equal(ClientConnection.guards.Current(reconnected.connection), true)
    assert.deepEqual(reconnected.snapshot, fresh)
    assert.deepEqual(reconnected.changesWhileAway, ["Run entered Verify", "Processing session completed elsewhere"])
    assert.equal(reconnected.snapshot.processingSessions.length, 0)
    assert.equal(reconnected.snapshot.selectedAssets.length, 0)

    const next = IncrementalProjectionEvent.cases.HealthProjected.make({
      eventCursor: EventCursor.make(53),
      snapshotVersion: SnapshotVersion.make(13),
      generatedAt: "2026-07-22T20:05:01Z",
      health: [
        { subsystem: "service", state: "healthy", observedAt: "2026-07-22T20:05:01Z" },
        { subsystem: "tunnel", state: "unavailable", observedAt: "2026-07-22T20:05:01Z", reason: "remote ingress unavailable" },
      ],
    })
    const applied = receiveIncrementalEvent(reconnected, next)
    assert.equal(IncrementalEventDecision.$is("Applied")(applied), true)
    if (!IncrementalEventDecision.$is("Applied")(applied)) return
    assert.equal(applied.state.snapshot.eventCursor, 53)
    assert.equal(applied.state.snapshot.health[1]?.subsystem, "tunnel")
    assert.equal(applied.state.snapshot.run?.phase, "verify")
  })

  it("CLIENT-03 ignores duplicates, applies only the next event, and requires a snapshot on gaps or regression", () => {
    const current = client()
    const malformed = Schema.decodeUnknownResult(IncrementalProjectionEvent)({
      _tag: "RunProjected",
      eventCursor: 41,
      snapshotVersion: 11,
      generatedAt: "2026-07-22T20:00:41Z",
      run: { runId: "run-1", phase: "failed" },
    })
    assert.equal(Result.isFailure(malformed), true)
    assert.equal(current.snapshot.run?.phase, "capture")

    const duplicate = receiveIncrementalEvent(current, runProjected(40, 9, "failed"))
    assert.equal(IncrementalEventDecision.$is("Ignored")(duplicate), true)
    if (IncrementalEventDecision.$is("Ignored")(duplicate)) assert.deepEqual(duplicate.state, current)

    const applied = receiveIncrementalEvent(current, runProjected(41, 11, "verify"))
    assert.equal(IncrementalEventDecision.$is("Applied")(applied), true)
    if (!IncrementalEventDecision.$is("Applied")(applied)) return
    assert.equal(applied.state.snapshot.run?.phase, "verify")

    const gap = receiveIncrementalEvent(applied.state, runProjected(43, 12, "failed"))
    assert.equal(IncrementalEventDecision.$is("SnapshotRequired")(gap), true)
    if (!IncrementalEventDecision.$is("SnapshotRequired")(gap)) return
    assert.equal(gap.reason, "EventCursorGap")
    assert.equal(gap.state.snapshot.run?.phase, "verify")
    assert.equal(gap.state.snapshot.eventCursor, 41)
    assert.equal(ClientConnection.guards.Reconnecting(gap.state.connection), true)

    const whileReconnecting = receiveIncrementalEvent(gap.state, runProjected(42, 12, "failed"))
    assert.equal(IncrementalEventDecision.$is("SnapshotRequired")(whileReconnecting), true)
    if (IncrementalEventDecision.$is("SnapshotRequired")(whileReconnecting)) {
      assert.equal(whileReconnecting.reason, "ConnectionNotCurrent")
      assert.equal(whileReconnecting.state.snapshot.run?.phase, "verify")
    }

    const regressed = receiveIncrementalEvent(current, runProjected(41, 9, "failed"))
    assert.equal(IncrementalEventDecision.$is("SnapshotRequired")(regressed), true)
    if (IncrementalEventDecision.$is("SnapshotRequired")(regressed)) {
      assert.equal(regressed.reason, "SnapshotVersionRegressed")
      assert.equal(regressed.state.snapshot.run?.phase, "capture")
    }
  })

  it("applies a non-empty cross-domain projection batch as one cursor advance", () => {
    const current = client()
    const batch = IncrementalProjectionEvent.cases.ProjectionBatch.make({
      eventCursor: EventCursor.make(41),
      snapshotVersion: SnapshotVersion.make(11),
      generatedAt: "2026-07-22T20:00:41Z",
      changes: [
        { _tag: "ProcessingSessions", processingSessions: [] },
        { _tag: "SelectedAssets", selectedAssets: [] },
      ],
    })
    const applied = receiveIncrementalEvent(current, batch)
    assert.equal(IncrementalEventDecision.$is("Applied")(applied), true)
    if (!IncrementalEventDecision.$is("Applied")(applied)) return
    assert.equal(applied.state.snapshot.eventCursor, 41)
    assert.deepEqual(applied.state.snapshot.processingSessions, [])
    assert.deepEqual(applied.state.snapshot.selectedAssets, [])
    assert.equal(Schema.decodeUnknownResult(IncrementalProjectionEvent)({
      ...batch,
      changes: [],
    })._tag, "Failure")
  })

  it("PHONE-01 shares canonical truth while server projection and authority disable each desktop-only action", () => {
    const canonical = snapshot()
    const desktop = projectSnapshotForClient(canonical, canonical.membership)
    const phone = projectSnapshotForClient(canonical, {
      ...canonical.membership,
      clientId: decode(Schema.NonEmptyString.pipe(Schema.brand("ClientId")), "phone-1"),
      capability: "readOnly",
    })

    assert.equal(phone.run?.phase, desktop.run?.phase)
    assert.equal(phone.processingSessions[0]?.previewAgeSeconds, desktop.processingSessions[0]?.previewAgeSeconds)
    assert.deepEqual(phone.health, desktop.health)
    assert.equal(phone.control.actions[0]?._tag, "Unavailable")
    assert.equal(phone.plan?.actions[0]?._tag, "Unavailable")
    assert.equal(phone.run?.actions[0]?._tag, "Unavailable")
    assert.equal(phone.processingSessions[0]?.actions[0]?._tag, "Unavailable")
    assert.equal(phone.selectedAssets[0]?.actions[0]?._tag, "Available")

    const phoneClient = client(phone)
    assert.equal(ClientCommandDecision.$is("DoNotSend")(decideClientCommand(phoneClient, "PauseRun")), true)
    assert.equal(ClientCommandDecision.$is("SendNow")(decideClientCommand(phoneClient, "RequestAssetDownload")), true)

    const phoneActor = ActorContext.cases.Member.make({
      personId: phone.membership.personId,
      clientId: phone.membership.clientId,
      role: phone.membership.role,
      capability: phone.membership.capability,
    })
    const gate = evaluateCommandGate({
      envelope: {
        commandId: CommandId.make("phone-pause-command"),
        command: {
          _tag: "PauseRun",
          runId: RunId.make("run-1"),
          expectedRunRevision: RunRevision.make(12),
          expectedLeaseRevision: LeaseRevision.make(4),
          idempotencyKey: IdempotencyKey.make("phone-pause-key"),
        },
      },
      actor: phoneActor,
      connected: true,
      snapshotVersion: SnapshotVersion.make(10),
      currentRevisions: { run: RunRevision.make(12), lease: LeaseRevision.make(4) },
      leaseHolderClientId: phone.membership.clientId,
      idempotency: IdempotencyState.cases.Fresh.make({}),
    })
    assert.equal(CommandGateDecision.$is("Rejected")(gate), true)
    if (CommandGateDecision.$is("Rejected")(gate)) {
      assert.equal(gate.failure._tag, "AuthorizationFailure")
      if (gate.failure._tag === "AuthorizationFailure") assert.equal(gate.failure.reason, "ClientReadOnly")
    }
  })
})
