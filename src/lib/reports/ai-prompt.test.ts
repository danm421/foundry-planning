// src/lib/reports/ai-prompt.test.ts
//
// Pure-function checks for buildAiPrompt. We don't try to assert exact
// wording — only that the structural pieces (tone instruction, length
// hint, household name, per-scope summary lines) actually land in the
// right side of the prompt and that unregistered scopes degrade
// gracefully.

import { describe, it, expect } from "vitest";

import { buildAiPrompt } from "./ai-prompt";
import "./scopes"; // side-effect: register cashflow/balance/etc.

describe("buildAiPrompt", () => {
  it("emits the tone + length instructions in the system prompt and the household name in the user prompt", () => {
    const { system, user } = buildAiPrompt({
      scopes: ["cashflow"],
      tone: "concise",
      length: "short",
      scopeData: { cashflow: { years: [] } },
      householdName: "Smith Family",
    });

    expect(system).toMatch(/Be concise and direct/);
    expect(system).toMatch(/1-2 short paragraphs/);
    expect(user).toMatch(/Household: Smith Family/);
    expect(user).toMatch(/\[cashflow\]/);
    expect(user).toMatch(/Write the commentary now\./);
  });

  it("falls back to '(unavailable)' for scopes without a registry entry", () => {
    const { user } = buildAiPrompt({
      scopes: ["tax", "estate"],
      tone: "plain",
      length: "long",
      scopeData: {},
      householdName: "Jones",
    });

    expect(user).toMatch(/\[tax\] \(unavailable\)/);
    expect(user).toMatch(/\[estate\] \(unavailable\)/);
  });
});
