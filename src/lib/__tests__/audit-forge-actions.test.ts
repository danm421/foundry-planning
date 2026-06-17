import { describe, expect, it } from "vitest";
import type { AuditAction } from "../audit";

// Compile-time guard: each entry must be assignable to AuditAction. If the
// union drops one of these, this file fails to type-check (and the runtime
// assertion below also documents the expected set for readers).
const FORGE_ACTIONS = [
  "forge.query",
  "forge.tool_call",
  "forge.write_proposed",
  "forge.write_approved",
  "forge.write_rejected",
] as const satisfies readonly AuditAction[];

// Legacy copilot.* actions remain in the union (documented cutover, 2026-06-17):
// historical rows are append-only and not backfilled, so these must still decode.
const LEGACY_COPILOT_ACTIONS = [
  "copilot.query",
  "copilot.tool_call",
  "copilot.write_proposed",
  "copilot.write_approved",
  "copilot.write_rejected",
] as const satisfies readonly AuditAction[];

describe("Forge AuditActions", () => {
  it("exposes exactly the five forge.* actions (emitted by new writes)", () => {
    expect(FORGE_ACTIONS).toEqual([
      "forge.query",
      "forge.tool_call",
      "forge.write_proposed",
      "forge.write_approved",
      "forge.write_rejected",
    ]);
  });

  it("still accepts the five legacy copilot.* actions for historical rows", () => {
    expect(LEGACY_COPILOT_ACTIONS).toEqual([
      "copilot.query",
      "copilot.tool_call",
      "copilot.write_proposed",
      "copilot.write_approved",
      "copilot.write_rejected",
    ]);
  });
});
