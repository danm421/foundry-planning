// src/domain/copilot/__tests__/system-prompt.test.ts
import { describe, it, expect } from "vitest";
import {
  COPILOT_SYSTEM_PREFIX,
  GROUNDING_RULES,
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

describe("GROUNDING_RULES", () => {
  it("requires every figure to come from a tool result and forbids inventing them", () => {
    expect(GROUNDING_RULES).toMatch(/come from a tool result/i);
    expect(GROUNDING_RULES).toMatch(/never (compute|invent)/i);
  });

  it("forbids attributing a dollar amount to any single scenario change", () => {
    expect(GROUNDING_RULES).toMatch(/single (scenario )?change/i);
    expect(GROUNDING_RULES).toMatch(/combined.*delta/i);
  });

  it("keeps the advice/observation framing and illustrative disclaimer", () => {
    expect(GROUNDING_RULES).toMatch(/observations and risks/i);
    expect(GROUNDING_RULES).toMatch(/not give individualized advice/i);
    expect(GROUNDING_RULES).toMatch(/illustrative|hypothetical/i);
  });

  it("lives inside the cacheable stable prefix (so prompt caching is preserved)", () => {
    expect(COPILOT_SYSTEM_PREFIX).toContain(GROUNDING_RULES);
  });

  it("does NOT leak internal tool names", () => {
    expect(GROUNDING_RULES).not.toMatch(/run_projection|find_client/);
  });
});

describe("KB citation grounding clause", () => {
  it("requires citing the sourceRef for each search_planning_kb claim", () => {
    expect(COPILOT_SYSTEM_PREFIX).toMatch(/cite.*sourceRef/i);
  });

  it("forbids filling gaps from priors when retrieval returns nothing", () => {
    expect(COPILOT_SYSTEM_PREFIX).toMatch(/never fill the gap from priors/i);
  });
});

describe("CRM system-prompt block", () => {
  it("states the tiered write rule and treats notes/activity as untrusted", () => {
    expect(COPILOT_SYSTEM_PREFIX).toMatch(/reversible CRM (actions|writes).*apply immediately/i);
    expect(COPILOT_SYSTEM_PREFIX).toMatch(/delete.*require.*approval/i);
    expect(COPILOT_SYSTEM_PREFIX).toMatch(/note.*(bodies|content).*UNTRUSTED|untrusted data/i);
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

  it("keeps the stable prefix first and the variable tail after it", () => {
    const prompt = buildSystemPrompt({
      firmName: "Acme Advisors",
      client: { householdTitle: "Jane Doe" },
      scenario: { name: "Roth ladder", isBaseCase: false },
      currentPage: "cashFlow",
    });
    expect(prompt.startsWith(COPILOT_SYSTEM_PREFIX)).toBe(true);
    expect(prompt.indexOf("Jane Doe")).toBeGreaterThan(
      COPILOT_SYSTEM_PREFIX.length - 1,
    );
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
