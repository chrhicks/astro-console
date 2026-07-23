import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect } from "effect"
import {
  ControlSimulationState,
  makeControlServerSimulation,
} from "./control-server-simulation.js"
import { ControlLeaseState, ControlTarget } from "./control.js"
import { ActorContext } from "./gate.js"
import {
  ClientId,
  EventCursor,
  LeaseId,
  LeaseRevision,
  PersonId,
  SnapshotVersion,
} from "./primitives.js"

const owner = ActorContext.cases.Member.make({
  personId: PersonId.make("person-owner"),
  clientId: ClientId.make("client-owner"),
  role: "owner",
  capability: "controlCapable",
})

const friendA = ActorContext.cases.Member.make({
  personId: PersonId.make("person-friend-a"),
  clientId: ClientId.make("client-friend-a"),
  role: "viewer",
  capability: "controlCapable",
})

const friendB = ActorContext.cases.Member.make({
  personId: PersonId.make("person-friend-b"),
  clientId: ClientId.make("client-friend-b"),
  role: "viewer",
  capability: "controlCapable",
})

const target = (clientId: typeof ClientId.Type, connection: ControlTarget["connection"] = "current") =>
  ControlTarget.make({ clientId, capability: "controlCapable", connection })

const initialState = (holderClientId = owner.clientId): ControlSimulationState => ({
  lease: ControlLeaseState.make({
    leaseId: LeaseId.make("lease-observatory"),
    revision: LeaseRevision.make(4),
    state: "held",
    holderClientId,
    requests: [],
  }),
  persistenceVersion: 0,
  snapshotVersion: SnapshotVersion.make(20),
  eventCursor: EventCursor.make(40),
  targets: [target(owner.clientId), target(friendA.clientId), target(friendB.clientId)],
  receipts: [],
  results: [],
  events: [],
  outbox: ["already-accepted-exposure"],
})

const makeServer = (state = initialState(), nowEpochMs = 1_000) => makeControlServerSimulation({
  initialState: state,
  nowEpochMs,
  requestTtlMs: 60_000,
  occurredAt: "2026-07-23T02:00:00Z",
})

const requestCommand = (commandId: string, idempotencyKey: string) => ({
  commandId,
  command: {
    _tag: "RequestControl",
    expectedLeaseRevision: 4,
    idempotencyKey,
  },
})

const grantCommand = (commandId: string, requestId: string, targetClientId: string, expectedLeaseRevision = 4) => ({
  commandId,
  command: {
    _tag: "GrantControl",
    expectedLeaseRevision,
    requestId,
    targetClientId,
    idempotencyKey: `idempotency-${commandId}`,
  },
})

const declineCommand = (commandId: string, requestId: string) => ({
  commandId,
  command: {
    _tag: "DeclineControl",
    expectedLeaseRevision: 4,
    requestId,
    idempotencyKey: `idempotency-${commandId}`,
  },
})

const takeCommand = (commandId: string, expectedLeaseRevision: number) => ({
  commandId,
  command: {
    _tag: "TakeControl",
    expectedLeaseRevision,
    idempotencyKey: `idempotency-${commandId}`,
  },
})

const releaseCommand = (commandId: string, expectedLeaseRevision: number) => ({
  commandId,
  command: {
    _tag: "ReleaseControl",
    expectedLeaseRevision,
    idempotencyKey: `idempotency-${commandId}`,
  },
})

describe("control authority server proofs", () => {
  it("atomically requests and grants control while duplicate delivery replays exactly once", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer()
      const rawRequest = requestCommand("command-request-a", "request-a")

      const requested = yield* server.execute(rawRequest, friendA)
      const afterRequest = yield* server.readState()
      const replayed = yield* server.execute(rawRequest, friendA)
      const afterReplay = yield* server.readState()

      assert.equal(requested.effect, "requested")
      assert.equal(requested.projection.lease.revision, LeaseRevision.make(4))
      assert.equal(requested.requestId, "request-command-request-a")
      assert.equal(afterRequest.persistenceVersion, 1)
      assert.equal(afterRequest.events.length, 1)
      assert.equal(afterRequest.receipts.length, 1)
      assert.equal(afterRequest.results.length, 1)
      assert.deepEqual(afterRequest.outbox, ["already-accepted-exposure"])
      assert.equal(replayed.replayed, true)
      assert.equal(replayed.resultRef, requested.resultRef)
      assert.deepEqual(afterReplay, afterRequest)

      const granted = yield* server.execute(
        grantCommand("command-grant-a", "request-command-request-a", friendA.clientId),
        owner,
      )
      const committed = yield* server.readState()

      assert.equal(granted.effect, "granted")
      assert.equal(committed.lease.revision, LeaseRevision.make(5))
      assert.equal(committed.lease.holderClientId, friendA.clientId)
      assert.equal(committed.lease.requests.length, 0)
      assert.equal(committed.persistenceVersion, 2)
      assert.equal(committed.snapshotVersion, SnapshotVersion.make(22))
      assert.equal(committed.eventCursor, EventCursor.make(42))
      assert.deepEqual(committed.events.map((event) => event.event._tag), ["ControlRequested", "ControlGranted"])
      assert.equal(committed.receipts.length, 2)
      assert.equal(committed.results.length, 2)
      assert.deepEqual(committed.outbox, ["already-accepted-exposure"])
      assert.deepEqual(granted.projection.lease, committed.lease)
    }))
  })

  it("declines a current request durably without changing the ownership epoch", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer()
      const requested = yield* server.execute(requestCommand("command-request-decline", "request-decline"), friendA)
      const declined = yield* server.execute(
        declineCommand("command-decline", requested.requestId ?? "missing-request"),
        owner,
      )
      const state = yield* server.readState()

      assert.equal(declined.effect, "declined")
      assert.equal(state.lease.revision, LeaseRevision.make(4))
      assert.equal(state.lease.holderClientId, owner.clientId)
      assert.equal(state.lease.requests.length, 0)
      assert.equal(state.persistenceVersion, 2)
      assert.deepEqual(state.events.map((event) => event.event._tag), ["ControlRequested", "ControlDeclined"])
    }))
  })

  it("serializes simultaneous requests without using or advancing LeaseRevision", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer()
      const responses = yield* Effect.all([
        server.execute(requestCommand("command-request-concurrent-a", "request-concurrent-a"), friendA),
        server.execute(requestCommand("command-request-concurrent-b", "request-concurrent-b"), friendB),
      ], { concurrency: "unbounded" })
      const state = yield* server.readState()

      assert.equal(responses.length, 2)
      assert.equal(state.lease.revision, LeaseRevision.make(4))
      assert.equal(state.persistenceVersion, 2)
      assert.deepEqual(
        state.lease.requests.map((request) => request.requesterClientId).sort(),
        [friendA.clientId, friendB.clientId].sort(),
      )
      assert.equal(state.events.length, 2)
      assert.equal(state.receipts.length, 2)
      assert.equal(state.results.length, 2)
      assert.deepEqual(state.outbox, ["already-accepted-exposure"])
    }))
  })

  it("keeps disconnect and reconnect transient, while expiry changes ownership durably", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer(initialState(friendA.clientId))

      const disconnected = yield* server.disconnectController(friendA.clientId, 61_000)
      assert.equal(disconnected._tag, "Updated")
      const duringGrace = yield* server.readState()
      assert.equal(duringGrace.lease.revision, LeaseRevision.make(4))
      assert.equal(duringGrace.lease.state, "reconnecting")
      assert.equal(duringGrace.persistenceVersion, 1)
      assert.equal(duringGrace.eventCursor, EventCursor.make(40))
      assert.equal(duringGrace.events.length, 0)

      const reconnected = yield* server.reconnectController(friendA.clientId)
      assert.equal(reconnected._tag, "Updated")
      const current = yield* server.readState()
      assert.equal(current.lease.revision, LeaseRevision.make(4))
      assert.equal(current.lease.state, "held")
      assert.equal(current.persistenceVersion, 2)
      assert.equal(current.events.length, 0)

      yield* server.disconnectController(friendA.clientId, 61_000)
      assert.equal((yield* server.expireGrace(60_999))._tag, "Unchanged")
      const beforeExpiry = yield* server.readState()
      const expired = yield* server.expireGrace(61_000)
      assert.equal(expired._tag, "Updated")
      const afterExpiry = yield* server.readState()

      assert.equal(afterExpiry.lease.revision, LeaseRevision.make(5))
      assert.equal(afterExpiry.lease.state, "available")
      assert.equal(afterExpiry.lease.holderClientId, undefined)
      assert.equal(afterExpiry.persistenceVersion, beforeExpiry.persistenceVersion + 1)
      assert.equal(afterExpiry.eventCursor, EventCursor.make(41))
      assert.equal(afterExpiry.events.length, 1)
      assert.equal(afterExpiry.events[0]?.event._tag, "ControlLeaseExpired")
      assert.deepEqual(afterExpiry.outbox, ["already-accepted-exposure"])
    }))
  })

  it("takes over atomically, resolves requests, and stale-rejects the old controller with no side effects", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer(initialState(friendA.clientId))
      yield* server.execute(requestCommand("command-request-before-take", "request-before-take"), friendB)
      yield* server.disconnectController(friendA.clientId, 61_000)

      const taken = yield* server.execute(takeCommand("command-take", 4), owner)
      const afterTake = yield* server.readState()
      assert.equal(taken.effect, "taken")
      assert.equal(afterTake.lease.revision, LeaseRevision.make(5))
      assert.equal(afterTake.lease.holderClientId, owner.clientId)
      assert.equal(afterTake.lease.requests.length, 0)
      assert.deepEqual(afterTake.outbox, ["already-accepted-exposure"])

      const outcome = yield* server.execute(releaseCommand("command-delayed-release", 4), friendA).pipe(
        Effect.as("released" as const),
        Effect.catchTag("ControlServerSimulation.CommandRejected", ({ failure }) => {
          if (failure._tag !== "AuthorizationFailure") throw new Error(`unexpected failure ${failure._tag}`)
          return Effect.succeed(failure.reason)
        }),
      )
      const afterRejected = yield* server.readState()

      assert.equal(outcome, "ControlLeaseLost")
      assert.deepEqual(afterRejected, afterTake)

      const replayedTake = yield* server.execute(takeCommand("command-take", 4), owner)
      assert.equal(replayedTake.replayed, true)
      assert.deepEqual(yield* server.readState(), afterTake)

      assert.equal((yield* server.expireGrace(61_000))._tag, "Unchanged")
      assert.deepEqual(yield* server.readState(), afterTake)
    }))
  })

  it("leaves all authoritative surfaces unchanged for domain and authority rejection", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer()
      const before = yield* server.readState()

      const alreadyController = yield* server.execute(
        requestCommand("command-owner-request", "owner-request"),
        owner,
      ).pipe(
        Effect.as("requested" as const),
        Effect.catchTag("ControlServerSimulation.TransitionRejected", ({ reason }) => Effect.succeed(reason)),
      )
      assert.equal(alreadyController, "AlreadyController")
      assert.deepEqual(yield* server.readState(), before)

      const missingRequest = yield* server.execute(
        grantCommand("command-missing-grant", "request-missing", friendA.clientId),
        owner,
      ).pipe(
        Effect.as("granted" as const),
        Effect.catchTag("ControlServerSimulation.TransitionRejected", ({ reason }) => Effect.succeed(reason)),
      )
      assert.equal(missingRequest, "RequestUnavailable")
      assert.deepEqual(yield* server.readState(), before)

      assert.equal((yield* server.disconnectController(friendA.clientId, 61_000))._tag, "Unchanged")
      assert.equal((yield* server.reconnectController(owner.clientId))._tag, "Unchanged")
      assert.equal((yield* server.expireGrace(61_000))._tag, "Unchanged")
      assert.deepEqual(yield* server.readState(), before)
    }))
  })

  it("rejects an expired request after reload without recording the attempted grant", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const requestServer = yield* makeServer()
      const requested = yield* requestServer.execute(
        requestCommand("command-request-expiring", "request-expiring"),
        friendA,
      )
      const persisted = yield* requestServer.readState()
      const grantServer = yield* makeServer(persisted, 61_000)
      const beforeGrant = yield* grantServer.readState()

      const outcome = yield* grantServer.execute(
        grantCommand("command-grant-expired", requested.requestId ?? "missing-request", friendA.clientId),
        owner,
      ).pipe(
        Effect.as("granted" as const),
        Effect.catchTag("ControlServerSimulation.TransitionRejected", ({ reason }) => Effect.succeed(reason)),
      )

      assert.equal(outcome, "RequestExpired")
      assert.deepEqual(yield* grantServer.readState(), beforeGrant)
    }))
  })
})
