// src/domain/forge/__tests__/routing.test.ts
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
  it("routes a no-tool answer WITH a number to verify", () => {
    expect(routeAfterAgent([], WRITE, true)).toBe("verify");
  });
  it("ends a no-tool answer with NO number (hasNumber omitted defaults false)", () => {
    expect(routeAfterAgent([], WRITE)).toBe("__end__");
    expect(routeAfterAgent([], WRITE, false)).toBe("__end__");
  });
  it("ignores hasNumber when there are tool calls", () => {
    expect(routeAfterAgent([{ name: "run_projection" }], WRITE, true)).toBe("tools");
    expect(routeAfterAgent([{ name: "create_scenario" }], WRITE, true)).toBe("approval");
  });
});
