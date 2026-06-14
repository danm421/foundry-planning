// src/domain/copilot/__tests__/tools-index.test.ts
import { describe, it, expect } from "vitest";
import { buildTools, WRITE_TOOL_NAMES } from "../tools";
import { buildToolContext } from "../context";
import type { CopilotAuthContext } from "../state";

const ctx: CopilotAuthContext = { userId: "u1", firmId: "org_A", clientId: "c1", scenarioId: "base" };

describe("buildTools (Phase 0 stub)", () => {
  it("returns an array (empty in Phase 0)", () => {
    const tools = buildTools(buildToolContext(ctx, "conv-1"));
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(0);
  });

  it("WRITE_TOOL_NAMES is an empty set in Phase 0 (approval branch unreachable)", () => {
    expect(WRITE_TOOL_NAMES instanceof Set).toBe(true);
    expect(WRITE_TOOL_NAMES.size).toBe(0);
  });
});
