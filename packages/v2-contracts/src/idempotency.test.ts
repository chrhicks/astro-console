import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Schema } from "effect"
import {
  IdempotencyReceipt,
  IdempotencyRequest,
  classifyIdempotency,
} from "./index.js"

const request = Schema.decodeUnknownSync(IdempotencyRequest)({
  idempotencyKey: "intent-1",
  personId: "person-1",
  commandTag: "ApplyRunMutation",
  normalizedInputHash: "sha256:normalized-command",
})

describe("idempotency receipt classification", () => {
  it("classifies an unseen key as fresh", () => {
    assert.deepEqual(classifyIdempotency(request, undefined), { _tag: "Fresh" })
  })

  it("returns an existing pending operation without accepting duplicate work", () => {
    const receipt = Schema.decodeUnknownSync(IdempotencyReceipt)({
      _tag: "Pending",
      ...request,
      operationId: "operation-1",
    })
    assert.deepEqual(classifyIdempotency(request, receipt), {
      _tag: "PendingMatch",
      operationId: "operation-1",
    })
  })

  it("returns the recorded result for the same normalized command", () => {
    const receipt = Schema.decodeUnknownSync(IdempotencyReceipt)({
      _tag: "Recorded",
      ...request,
      resultRef: "command-result-1",
    })
    assert.deepEqual(classifyIdempotency(request, receipt), { _tag: "RecordedMatch" })
  })

  it("rejects key reuse by another actor or with different normalized input", () => {
    const receipt = Schema.decodeUnknownSync(IdempotencyReceipt)({
      _tag: "Recorded",
      ...request,
      resultRef: "command-result-1",
    })
    const otherActor = Schema.decodeUnknownSync(IdempotencyRequest)({
      ...request,
      personId: "person-2",
    })
    const otherInput = Schema.decodeUnknownSync(IdempotencyRequest)({
      ...request,
      normalizedInputHash: "sha256:different-command",
    })
    assert.deepEqual(classifyIdempotency(otherActor, receipt), { _tag: "Conflict" })
    assert.deepEqual(classifyIdempotency(otherInput, receipt), { _tag: "Conflict" })
  })
})
