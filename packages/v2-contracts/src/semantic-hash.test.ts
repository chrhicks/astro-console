import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { versionedSemanticHash } from "./semantic-hash.js"

describe("versioned semantic hashing", () => {
  it("is independent of object insertion order", () => {
    assert.equal(
      versionedSemanticHash("Command.v1", { z: 1, nested: { b: 2, a: 1 } }),
      versionedSemanticHash("Command.v1", { nested: { a: 1, b: 2 }, z: 1 }),
    )
  })

  it("changes when normalization semantics are versioned", () => {
    assert.notEqual(
      versionedSemanticHash("Command.v1", { value: 1 }),
      versionedSemanticHash("Command.v2", { value: 1 }),
    )
  })
})
