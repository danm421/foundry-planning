// src/domain/copilot/__tests__/context.test.ts
import { describe, it, expect } from "vitest";
import { buildToolContext } from "../context";
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
