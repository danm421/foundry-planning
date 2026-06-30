// src/domain/forge/__tests__/context.test.ts
import { describe, it, expect } from "vitest";
import { buildToolContext, buildGlobalToolContext } from "../context";
import type { ForgeAuthContext } from "../state";

const ctx: ForgeAuthContext = {
  userId: "u1",
  firmId: "org_A",
  clientId: "c1",
  scenarioId: "base",
};

describe("buildToolContext", () => {
  it("bundles the auth context with the conversation id", () => {
    const tc = buildToolContext(ctx, "conv-123");
    expect(tc).toEqual({ ctx, conversationId: "conv-123" });
  });
});

describe("buildGlobalToolContext", () => {
  it("wraps a clientless ctx with the conversation id", () => {
    const tc = buildGlobalToolContext({ userId: "u1", firmId: "f1" }, "conv1");
    expect(tc.ctx.firmId).toBe("f1");
    expect(tc.conversationId).toBe("conv1");
    // @ts-expect-error — global ctx has no clientId
    void tc.ctx.clientId;
  });
});
