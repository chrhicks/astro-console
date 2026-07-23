import { Schema } from "effect"

const id = <const Name extends string>(name: Name) => Schema.NonEmptyString.pipe(Schema.brand(name))
export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
export const PositiveNumber = Schema.Finite.check(Schema.isGreaterThan(0))
const revision = <const Name extends string>(name: Name) => NonNegativeInt.pipe(Schema.brand(name))

export const ObservatoryId = id("ObservatoryId")
export const PersonId = id("PersonId")
export const ClientId = id("ClientId")
export const PlanId = id("PlanId")
export const RunId = id("RunId")
export const LeaseId = id("LeaseId")
export const ProcessingSessionId = id("ProcessingSessionId")
export const AssetId = id("AssetId")
export const PreviewId = id("PreviewId")
export const ProposalId = id("ProposalId")
export const AttemptId = id("AttemptId")
export const CheckpointId = id("CheckpointId")
export const FindingId = id("FindingId")
export const ProcessingOutputId = id("ProcessingOutputId")
export const RepresentationId = id("RepresentationId")
export const OperationId = id("OperationId")
export const CommandId = id("CommandId")
export const IdempotencyKey = id("IdempotencyKey")
export const NormalizedInputHash = id("NormalizedInputHash")
export const CommandResultRef = id("CommandResultRef")
export const SnapshotVersion = revision("SnapshotVersion")
export const EventCursor = revision("EventCursor")
export const PlanRevision = revision("PlanRevision")
export const RunRevision = revision("RunRevision")
export const LeaseRevision = revision("LeaseRevision")
export const AcquireRevision = revision("AcquireRevision")
export const ProcessingRevision = revision("ProcessingRevision")
export const AssetRevision = revision("AssetRevision")

export const MembershipRole = Schema.Literals(["owner", "viewer"])
export const ClientCapability = Schema.Literals(["readOnly", "controlCapable"])

export const RunFreshness = {
  runId: RunId,
  expectedRunRevision: RunRevision,
}

export const LeaseFreshness = {
  expectedLeaseRevision: LeaseRevision,
}

export const AcquireFreshness = {
  expectedAcquireRevision: AcquireRevision,
}

export const ProcessingFreshness = {
  sessionId: ProcessingSessionId,
  expectedProcessingRevision: ProcessingRevision,
}

export const AssetFreshness = {
  assetId: AssetId,
  expectedAssetRevision: AssetRevision,
}

export const DurableMutation = {
  idempotencyKey: IdempotencyKey,
}
