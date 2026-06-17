// src/domain/copilot/__tests__/routing.test.ts
import { describe, it, expect } from "vitest";
import { routeAfterAgent } from "../routing";

// Phase 2 names; in Phase 0 the set is empty so the approval branch is unreachable.
const WRITE = new Set(["create_scenario"]);

describe("routeAfterAgent", () => {
  it("ends when there are no tool calls", () => {
    expect(routeAfterAgent([], WRITE)).toBe("__end__");
  });
  it("routes to tools when all calls are reads", () => {
    expect(routeAfterAgent([{ name: "run_projection" }], WRITE)).toBe("tools");
  });
  it("routes to approval when any call is a write", () => {
    expect(
      routeAfterAgent([{ name: "run_projection" }, { name: "create_scenario" }], WRITE),
    ).toBe("approval");
  });
  it("routes reads to tools even when the write set is empty (Phase 0)", () => {
    expect(routeAfterAgent([{ name: "find_client" }], new Set<string>())).toBe("tools");
  });
});
