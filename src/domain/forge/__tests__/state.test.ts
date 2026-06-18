// src/domain/forge/__tests__/state.test.ts
import { describe, it, expect } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ForgeState, mergeToolErrorCounts, type ForgeAuthContext } from "../state";

const ctx: ForgeAuthContext = {
  userId: "u1",
  firmId: "org_A",
  clientId: "11111111-1111-1111-1111-111111111111",
  scenarioId: "base",
};

describe("ForgeState", () => {
  it("exposes a messages channel and an authContext channel", () => {
    expect(ForgeState.spec.messages).toBeDefined();
    expect(ForgeState.spec.authContext).toBeDefined();
  });

  it("messages reducer APPENDS rather than replaces (MessagesAnnotation semantics)", () => {
    // LangGraph uses `.operator` (not `.reducer`) for the binary reduce function
    const reduce = (ForgeState.spec.messages as {
      operator?: (a: unknown[], b: unknown[]) => unknown[];
    }).operator!;
    const merged = reduce(
      [new HumanMessage("hi")],
      [new AIMessage("hello there")],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBeInstanceOf(HumanMessage);
    expect(merged[1]).toBeInstanceOf(AIMessage);
  });

  it("authContext is last-write-wins (single value, no append)", () => {
    // LangGraph uses `.operator` (not `.reducer`) for the binary reduce function
    const reduce = (ForgeState.spec.authContext as {
      operator?: (a: unknown, b: unknown) => unknown;
    }).operator!;
    const next = { ...ctx, scenarioId: "scn_2" };
    expect(reduce(ctx, next)).toEqual(next);
  });

  it("exposes a toolErrorCounts channel", () => {
    expect(ForgeState.spec.toolErrorCounts).toBeDefined();
  });

  it("declares verifyAttempts and verifyDecision channels", () => {
    expect(ForgeState.spec).toHaveProperty("verifyAttempts");
    expect(ForgeState.spec).toHaveProperty("verifyDecision");
  });
});

describe("mergeToolErrorCounts", () => {
  it("accumulates per-tool and resets on success (0)", () => {
    const a = mergeToolErrorCounts({}, { run_projection: 1 });
    expect(a.run_projection).toBe(1);
    const b = mergeToolErrorCounts(a, { run_projection: 1 });
    expect(b.run_projection).toBe(2);
    const c = mergeToolErrorCounts(b, { run_projection: 0 }); // 0 == reset
    expect(c.run_projection).toBe(0);
  });

  it("tracks tools independently", () => {
    const a = mergeToolErrorCounts({ run_projection: 2 }, { run_monte_carlo: 1 });
    expect(a).toEqual({ run_projection: 2, run_monte_carlo: 1 });
  });
});
