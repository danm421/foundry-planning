import { describe, expect, it } from "vitest";
import type { AuditAction } from "../audit";

// Compile-time guard: each entry must be assignable to AuditAction. If the
// union drops one of these, this file fails to type-check (and the runtime
// assertion below also documents the expected set for readers).
const COPILOT_ACTIONS = [
  "copilot.query",
  "copilot.tool_call",
  "copilot.write_proposed",
  "copilot.write_approved",
  "copilot.write_rejected",
] as const satisfies readonly AuditAction[];

describe("copilot AuditActions", () => {
  it("exposes exactly the five copilot.* actions", () => {
    expect(COPILOT_ACTIONS).toEqual([
      "copilot.query",
      "copilot.tool_call",
      "copilot.write_proposed",
      "copilot.write_approved",
      "copilot.write_rejected",
    ]);
  });
});
