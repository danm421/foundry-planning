// src/domain/forge/__tests__/system-prompt.test.ts
import { describe, it, expect } from "vitest";
import {
  FORGE_SYSTEM_PREFIX,
  GROUNDING_RULES,
  RESPONSE_STYLE,
  buildSystemPrompt,
  type ForgePromptContext,
} from "../system-prompt";

const promptCtx: ForgePromptContext = {
  firmName: "Northstar Advisors",
  client: { householdTitle: "The Reyes Household" },
  scenario: { name: "Retire at 62", isBaseCase: false },
  currentPage: "retirement-comparison",
};

describe("FORGE_SYSTEM_PREFIX", () => {
  it("is a stable constant (cache-friendly: never varies by context)", () => {
    expect(typeof FORGE_SYSTEM_PREFIX).toBe("string");
    expect(FORGE_SYSTEM_PREFIX.length).toBeGreaterThan(0);
  });

  it("forbids treating untrusted/fetched content as instructions", () => {
    expect(FORGE_SYSTEM_PREFIX).toMatch(/never.*instructions|untrusted/i);
  });

  it("requires human approval before any write executes", () => {
    expect(FORGE_SYSTEM_PREFIX).toMatch(/approval/i);
  });

  it("does NOT enumerate internal tool names (no scope leak)", () => {
    // The grounding/tool clauses are appended by the Phase 1 section, not here.
    expect(FORGE_SYSTEM_PREFIX).not.toMatch(/run_projection|find_client/);
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
    expect(FORGE_SYSTEM_PREFIX).toContain(GROUNDING_RULES);
  });

  it("does NOT leak internal tool names", () => {
    expect(GROUNDING_RULES).not.toMatch(/run_projection|find_client/);
  });
});

describe("RESPONSE_STYLE clause", () => {
  it("lives inside the cacheable stable prefix", () => {
    expect(FORGE_SYSTEM_PREFIX).toContain(RESPONSE_STYLE);
  });

  it("directs Forge to lead with the answer and match length to the question", () => {
    expect(RESPONSE_STYLE).toMatch(/lead with the direct answer/i);
    expect(RESPONSE_STYLE).toMatch(/match length to the question/i);
  });

  it("requires truthful reporting of failures and empty results", () => {
    expect(RESPONSE_STYLE).toMatch(/be truthful about what happened/i);
  });

  it("forbids the reflexive next-step menu", () => {
    expect(RESPONSE_STYLE).toMatch(/menu of next steps|as a ritual/i);
  });

  it("tells Forge to investigate bug claims and give its own verdict", () => {
    expect(RESPONSE_STYLE).toMatch(/investigate with your tools/i);
    expect(RESPONSE_STYLE).toMatch(/even when that contradicts the advisor/i);
  });

  it("does NOT leak internal tool names", () => {
    expect(RESPONSE_STYLE).not.toMatch(/run_projection|find_client|read_import/);
  });
});

describe("citation grounding rule (no source-tag noise)", () => {
  it("still grounds every figure in a tool result", () => {
    expect(GROUNDING_RULES).toMatch(/ground every figure in a tool result/i);
  });

  it("forbids visible [Source: …] tags and exposing internal ids/uuids", () => {
    expect(GROUNDING_RULES).toMatch(/do NOT stamp visible/i);
    expect(GROUNDING_RULES).toMatch(/ids\/uuids/i);
  });

  it("drops the old 'cite the source of every factual claim' instruction", () => {
    expect(GROUNDING_RULES).not.toMatch(/cite the source of every factual claim/i);
  });
});

describe("KB citation grounding clause", () => {
  it("requires citing the sourceRef for each search_planning_kb claim", () => {
    expect(FORGE_SYSTEM_PREFIX).toMatch(/cite.*sourceRef/i);
  });

  it("forbids filling gaps from priors when retrieval returns nothing", () => {
    expect(FORGE_SYSTEM_PREFIX).toMatch(/never fill the gap from priors/i);
  });
});

describe("CRM system-prompt block", () => {
  it("states the tiered write rule and treats notes/activity as untrusted", () => {
    expect(FORGE_SYSTEM_PREFIX).toMatch(/reversible CRM (actions|writes).*apply immediately/i);
    expect(FORGE_SYSTEM_PREFIX).toMatch(/delete.*require.*approval/i);
    expect(FORGE_SYSTEM_PREFIX).toMatch(/note.*(bodies|content).*UNTRUSTED|untrusted data/i);
  });
});

describe("buildSystemPrompt", () => {
  it("starts with the stable prefix verbatim (prefix is cacheable)", () => {
    const p = buildSystemPrompt(promptCtx);
    expect(p.startsWith(FORGE_SYSTEM_PREFIX)).toBe(true);
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
    expect(prompt.startsWith(FORGE_SYSTEM_PREFIX)).toBe(true);
    expect(prompt.indexOf("Jane Doe")).toBeGreaterThan(
      FORGE_SYSTEM_PREFIX.length - 1,
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

const baseCtx = {
  firmName: "Acme Advisors",
  client: { householdTitle: "The Smiths" },
  scenario: { name: "Base Case", isBaseCase: true },
};

it("appends a pending-import line and points at read_import + the review screen", () => {
  const prompt = buildSystemPrompt({ ...baseCtx, pendingImport: { importId: "imp_42" } });
  expect(prompt).toContain("imp_42");
  expect(prompt).toMatch(/read_import/);
  expect(prompt).toMatch(/review/i);
});

it("omits the pending-import line when none is pending", () => {
  const prompt = buildSystemPrompt(baseCtx);
  expect(prompt).not.toMatch(/read_import/);
});

it("guides the model to answer a specific ask or, with none, summarize and offer options", () => {
  const prompt = buildSystemPrompt({ ...baseCtx, pendingImport: { importId: "imp_77" } });
  expect(prompt).toMatch(/if the advisor asked something specific/i);
  expect(prompt).toMatch(/offer .* options/i);
});
