// src/domain/forge/__tests__/routing.test.ts
import { describe, it, expect } from "vitest";
import { routeAfterAgent, MEETING_REVIEW_TOOL } from "../routing";
import { containsFinancialFigure } from "../grounding";

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

  // Wiring contract for the graph's agent→{verify,__end__} edge: the final answer
  // is fed through containsFinancialFigure, whose result is routeAfterAgent's
  // hasNumber arg. A figure-bearing answer must verify; a bare year/age must not.
  it("routes a no-tool answer carrying a financial figure to verify", () => {
    const answer = "Your median ending wealth is about $2.5M with a 92% success rate.";
    expect(routeAfterAgent([], WRITE, containsFinancialFigure(answer))).toBe("verify");
  });
  it("ends a no-tool answer carrying only a year/age (no stall on conversational figures)", () => {
    const answer = "They retire in 2026 at age 65.";
    expect(routeAfterAgent([], WRITE, containsFinancialFigure(answer))).toBe("__end__");
  });
});

// Meeting-review routing branch
const WRITES = new Set(["add_expense", "save_meeting_record"]);

describe("routeAfterAgent meeting_review", () => {
  it("routes save_meeting_record to meeting_review (not approval)", () => {
    expect(routeAfterAgent([{ name: MEETING_REVIEW_TOOL }], WRITES)).toBe("meeting_review");
  });
  it("still routes other writes to approval", () => {
    expect(routeAfterAgent([{ name: "add_expense" }], WRITES)).toBe("approval");
  });
  it("routes reads to tools", () => {
    expect(routeAfterAgent([{ name: "summarize_meeting_transcript" }], WRITES)).toBe("tools");
  });
});
