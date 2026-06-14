// src/domain/copilot/__tests__/system-prompt.test.ts
import { describe, it, expect } from "vitest";
import {
  COPILOT_SYSTEM_PREFIX,
  buildSystemPrompt,
  type CopilotPromptContext,
} from "../system-prompt";

const promptCtx: CopilotPromptContext = {
  firmName: "Northstar Advisors",
  client: { householdTitle: "The Reyes Household" },
  scenario: { name: "Retire at 62", isBaseCase: false },
  currentPage: "retirement-comparison",
};

describe("COPILOT_SYSTEM_PREFIX", () => {
  it("is a stable constant (cache-friendly: never varies by context)", () => {
    expect(typeof COPILOT_SYSTEM_PREFIX).toBe("string");
    expect(COPILOT_SYSTEM_PREFIX.length).toBeGreaterThan(0);
  });

  it("forbids treating untrusted/fetched content as instructions", () => {
    expect(COPILOT_SYSTEM_PREFIX).toMatch(/never.*instructions|untrusted/i);
  });

  it("requires human approval before any write executes", () => {
    expect(COPILOT_SYSTEM_PREFIX).toMatch(/approval/i);
  });

  it("does NOT enumerate internal tool names (no scope leak)", () => {
    // The grounding/tool clauses are appended by the Phase 1 section, not here.
    expect(COPILOT_SYSTEM_PREFIX).not.toMatch(/run_projection|find_client/);
  });
});

describe("buildSystemPrompt", () => {
  it("starts with the stable prefix verbatim (prefix is cacheable)", () => {
    const p = buildSystemPrompt(promptCtx);
    expect(p.startsWith(COPILOT_SYSTEM_PREFIX)).toBe(true);
  });

  it("interpolates firm, client, scenario name, and current page in the tail", () => {
    const p = buildSystemPrompt(promptCtx);
    expect(p).toContain("Northstar Advisors");
    expect(p).toContain("The Reyes Household");
    expect(p).toContain("Retire at 62");
    expect(p).toContain("retirement-comparison");
  });

  it("labels the active scenario as the base case when isBaseCase is true", () => {
    const p = buildSystemPrompt({
      ...promptCtx,
      scenario: { name: "Base Case", isBaseCase: true },
    });
    expect(p).toMatch(/base case/i);
  });

  it("tolerates a missing current page", () => {
    const p = buildSystemPrompt({ ...promptCtx, currentPage: undefined });
    expect(p).toContain("Northstar Advisors");
  });
});
