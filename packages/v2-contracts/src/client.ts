import { Data, Schema } from "effect"
import { CommandTag } from "./commands.js"
import { IncrementalProjectionEvent, decideEventCursor, EventCursorDecision } from "./events.js"
import { commandPolicies } from "./gate.js"
import { ClientCapability, RunId } from "./primitives.js"
import {
  ActionAvailability,
  AppSnapshot,
  AssetSnapshot,
  ControlSnapshot,
  MembershipSnapshot,
  PlanSnapshot,
  ProcessingSessionSnapshot,
  RunSnapshot,
} from "./snapshots.js"

export const Workspace = Schema.Literals(["plan", "observe", "library", "process"])

export const ShellState = Schema.Struct({
  workspace: Workspace,
  activeRunId: Schema.optionalKey(RunId),
  attentionWorkspace: Schema.optionalKey(Workspace),
})

export const navigateWorkspace = (state: typeof ShellState.Type, workspace: typeof Workspace.Type): typeof ShellState.Type =>
  ShellState.make({ ...state, workspace })

export const routeAttention = (state: typeof ShellState.Type, workspace: typeof Workspace.Type): typeof ShellState.Type =>
  ShellState.make({ ...state, attentionWorkspace: workspace })

export const ClientConnection = Schema.TaggedUnion({
  Current: { lastConfirmedAt: Schema.NonEmptyString },
  Stale: { lastConfirmedAt: Schema.NonEmptyString, disconnectedAt: Schema.NonEmptyString },
  Reconnecting: { lastConfirmedAt: Schema.NonEmptyString, reason: Schema.NonEmptyString },
})

export type ClientConnection = typeof ClientConnection.Type

export const ClientProjectionState = Schema.Struct({
  connection: ClientConnection,
  snapshot: AppSnapshot,
  changesWhileAway: Schema.Array(Schema.NonEmptyString),
})

export interface ClientProjectionState extends Schema.Schema.Type<typeof ClientProjectionState> {}

export const markClientDisconnected = (
  state: ClientProjectionState,
  disconnectedAt: string,
): ClientProjectionState => ClientProjectionState.make({
  ...state,
  connection: ClientConnection.cases.Stale.make({
    lastConfirmedAt: ClientConnection.match(state.connection, {
      Current: ({ lastConfirmedAt }) => lastConfirmedAt,
      Stale: ({ lastConfirmedAt }) => lastConfirmedAt,
      Reconnecting: ({ lastConfirmedAt }) => lastConfirmedAt,
    }),
    disconnectedAt,
  }),
})

export const installAuthoritativeSnapshot = (
  _state: ClientProjectionState,
  snapshot: AppSnapshot,
  changesWhileAway: ReadonlyArray<string> = [],
): ClientProjectionState => ClientProjectionState.make({
  connection: ClientConnection.cases.Current.make({ lastConfirmedAt: snapshot.generatedAt }),
  snapshot,
  changesWhileAway,
})

export type IncrementalEventDecision = Data.TaggedEnum<{
  Applied: { readonly state: ClientProjectionState }
  Ignored: { readonly state: ClientProjectionState }
  SnapshotRequired: { readonly state: ClientProjectionState; readonly reason: "ConnectionNotCurrent" | "EventCursorGap" | "SnapshotVersionRegressed" }
}>

export const IncrementalEventDecision = Data.taggedEnum<IncrementalEventDecision>()

export const receiveIncrementalEvent = (
  state: ClientProjectionState,
  event: IncrementalProjectionEvent,
): IncrementalEventDecision => {
  if (!ClientConnection.guards.Current(state.connection)) {
    return IncrementalEventDecision.SnapshotRequired({
      state: reconnecting(state, "A fresh snapshot is required before events"),
      reason: "ConnectionNotCurrent",
    })
  }
  const decision = decideEventCursor(state.snapshot.eventCursor, event.eventCursor)
  return EventCursorDecision.$match(decision, {
    Apply: () => event.snapshotVersion < state.snapshot.snapshotVersion
      ? IncrementalEventDecision.SnapshotRequired({
        state: reconnecting(state, "An event attempted to regress the snapshot version"),
        reason: "SnapshotVersionRegressed",
      })
      : IncrementalEventDecision.Applied({ state: applyIncrementalEvent(state, event) }),
    IgnoreAlreadyApplied: () => IncrementalEventDecision.Ignored({ state }),
    RefreshSnapshot: () => IncrementalEventDecision.SnapshotRequired({
      state: reconnecting(state, "An event cursor gap requires a fresh snapshot"),
      reason: "EventCursorGap",
    }),
  })
}

export const projectSnapshotForClient = (
  canonical: AppSnapshot,
  membership: typeof MembershipSnapshot.Type,
): AppSnapshot => AppSnapshot.make({
  ...canonical,
  membership,
  control: ControlSnapshot.make({ ...canonical.control, actions: projectActions(canonical.control.actions, membership.capability) }),
  ...(canonical.plan === undefined ? {} : {
    plan: PlanSnapshot.make({ ...canonical.plan, actions: projectActions(canonical.plan.actions, membership.capability) }),
  }),
  ...(canonical.run === undefined ? {} : {
    run: RunSnapshot.make({
      ...canonical.run,
      actions: projectActions(canonical.run.actions, membership.capability),
      ...(canonical.run.acquire === undefined ? {} : {
        acquire: { ...canonical.run.acquire, actions: projectActions(canonical.run.acquire.actions, membership.capability) },
      }),
    }),
  }),
  processingSessions: canonical.processingSessions.map((session) => ProcessingSessionSnapshot.make({
    ...session,
    actions: projectActions(session.actions, membership.capability),
  })),
  assets: canonical.assets.map((asset) => AssetSnapshot.make({
    ...asset,
    actions: projectActions(asset.actions, membership.capability),
  })),
})

export type ClientCommandDecision = Data.TaggedEnum<{
  SendNow: {}
  DoNotSend: { readonly reason: "ConnectionStale" | "ActionUnavailable" }
}>

export const ClientCommandDecision = Data.taggedEnum<ClientCommandDecision>()

export const decideClientCommand = (
  state: ClientProjectionState,
  action: typeof CommandTag.Type,
): ClientCommandDecision => {
  if (!ClientConnection.guards.Current(state.connection)) {
    return ClientCommandDecision.DoNotSend({ reason: "ConnectionStale" })
  }
  return allActions(state.snapshot).some((availability) =>
    availability.action === action && ActionAvailability.guards.Available(availability))
    ? ClientCommandDecision.SendNow()
    : ClientCommandDecision.DoNotSend({ reason: "ActionUnavailable" })
}

function applyIncrementalEvent(
  state: ClientProjectionState,
  event: IncrementalProjectionEvent,
): ClientProjectionState {
  const common = {
    eventCursor: event.eventCursor,
    snapshotVersion: event.snapshotVersion,
    generatedAt: event.generatedAt,
  }
  const snapshot = IncrementalProjectionEvent.match(event, {
    ControlProjected: ({ control }) => AppSnapshot.make({ ...state.snapshot, ...common, control }),
    PlanProjected: ({ plan }) => plan === null
      ? withoutPlan(state.snapshot, common)
      : AppSnapshot.make({ ...state.snapshot, ...common, plan }),
    RunProjected: ({ run }) => run === null
      ? withoutRun(state.snapshot, common)
      : AppSnapshot.make({ ...state.snapshot, ...common, run }),
    ProcessingProjected: ({ processingSessions }) => AppSnapshot.make({ ...state.snapshot, ...common, processingSessions }),
    AssetsProjected: ({ assets }) => AppSnapshot.make({ ...state.snapshot, ...common, assets }),
    HealthProjected: ({ health }) => AppSnapshot.make({ ...state.snapshot, ...common, health }),
  })
  return ClientProjectionState.make({
    connection: ClientConnection.cases.Current.make({ lastConfirmedAt: event.generatedAt }),
    snapshot,
    changesWhileAway: [],
  })
}

function reconnecting(state: ClientProjectionState, reason: string): ClientProjectionState {
  return ClientProjectionState.make({
    ...state,
    connection: ClientConnection.cases.Reconnecting.make({
      lastConfirmedAt: ClientConnection.match(state.connection, {
        Current: ({ lastConfirmedAt }) => lastConfirmedAt,
        Stale: ({ lastConfirmedAt }) => lastConfirmedAt,
        Reconnecting: ({ lastConfirmedAt }) => lastConfirmedAt,
      }),
      reason,
    }),
  })
}

function projectActions(
  actions: ReadonlyArray<typeof ActionAvailability.Type>,
  capability: typeof ClientCapability.Type,
) {
  if (capability === "controlCapable") return actions
  return actions.map((availability) => ActionAvailability.match(availability, {
    Available: ({ action }) => commandPolicies[action].requiresDesktop
      ? ActionAvailability.cases.Unavailable.make({ action, reason: "ClientReadOnly" })
      : availability,
    RequiresApproval: ({ action }) => commandPolicies[action].requiresDesktop
      ? ActionAvailability.cases.Unavailable.make({ action, reason: "ClientReadOnly" })
      : availability,
    Unavailable: (unavailable) => unavailable,
  }))
}

function allActions(snapshot: AppSnapshot) {
  return [
    ...snapshot.control.actions,
    ...(snapshot.plan?.actions ?? []),
    ...(snapshot.run?.actions ?? []),
    ...(snapshot.run?.acquire?.actions ?? []),
    ...snapshot.processingSessions.flatMap(({ actions }) => actions),
    ...snapshot.assets.flatMap(({ actions }) => actions),
  ]
}

function withoutPlan(
  snapshot: AppSnapshot,
  common: Pick<AppSnapshot, "eventCursor" | "snapshotVersion" | "generatedAt">,
) {
  const { plan: _plan, ...remaining } = snapshot
  return AppSnapshot.make({ ...remaining, ...common })
}

function withoutRun(
  snapshot: AppSnapshot,
  common: Pick<AppSnapshot, "eventCursor" | "snapshotVersion" | "generatedAt">,
) {
  const { run: _run, ...remaining } = snapshot
  return AppSnapshot.make({ ...remaining, ...common })
}
