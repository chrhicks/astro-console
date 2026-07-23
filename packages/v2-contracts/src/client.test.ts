import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { RunId } from "./primitives.js"
import { ShellState, navigateWorkspace, routeAttention } from "./client.js"

describe("presentation-only shell state", () => {
  it("SHELL-01 changes only the selected workspace and preserves active run identity", () => {
    const current = ShellState.make({ workspace: "observe", activeRunId: RunId.make("run-1") })
    const next = navigateWorkspace(current, "library")

    assert.deepEqual(next, { workspace: "library", activeRunId: "run-1" })
    assert.equal("revision" in next, false)
    assert.equal("command" in next, false)
  })

  it("SHELL-02 routes attention without navigating or creating domain authority", () => {
    const current = ShellState.make({ workspace: "plan" })
    const next = routeAttention(current, "process")

    assert.deepEqual(next, { workspace: "plan", attentionWorkspace: "process" })
    assert.equal("revision" in next, false)
    assert.equal("command" in next, false)
  })
})
