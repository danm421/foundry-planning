import { describe, it, expect } from "vitest";
import { buildComparisonAiPrompt, type AiPlanYearly } from "../ai-prompt";
import type { ResolvedSource } from "../ai-source-resolve";

const sources: ResolvedSource[] = [
  {
    cellId: "c1",
    groupId: "g1",
    groupTitle: "Retirement",
    widgetKind: "kpi",
    planIds: ["base"],
    yearRange: { start: 2030, end: 2032 },
  },
];

const plans: AiPlanYearly[] = [
  {
    planId: "base",
    label: "Baseline",
    years: [
      { year: 2030, age: 65, income: 100000, expenses: 80000, taxes: 12000, endBalance: 1_000_000 },
      { year: 2031, age: 66, income: 102000, expenses: 81000, taxes: 12500, endBalance: 1_050_000 },
      { year: 2032, age: 67, income: 104000, expenses: 82000, taxes: 13000, endBalance: 1_100_000 },
    ],
  },
];

describe("buildComparisonAiPrompt", () => {
  it("embeds tone, length, and custom instructions in the system prompt", () => {
    const { system } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "address the client by first name",
      householdName: "Smith Family",
    });
    expect(system).toMatch(/concise/i);
    expect(system).toMatch(/1-2 short paragraphs/i);
    expect(system).toMatch(/address the client by first name/);
  });

  it("lists each source widget on its own line in the user prompt", () => {
    const { user } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      householdName: "Smith Family",
    });
    expect(user).toMatch(/kpi.*Retirement.*2030.*2032.*base/);
  });

  it("includes yearly data for every referenced plan in the user prompt", () => {
    const { user } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "detailed",
      length: "medium",
      customInstructions: "",
      householdName: "Smith Family",
    });
    expect(user).toMatch(/Baseline/);
    expect(user).toMatch(/\b2030\b/);
    expect(user).toMatch(/\b2032\b/);
  });

  it("omits the custom instructions section when the field is empty", () => {
    const { system } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "plain",
      length: "long",
      customInstructions: "",
      householdName: "Smith Family",
    });
    expect(system).not.toMatch(/Advisor instructions:/);
  });

  it("filters each plan's years to the widest yearRange across source widgets that reference it", () => {
    const wide: ResolvedSource = { ...sources[0], yearRange: { start: 2031, end: 2031 } };
    const { user } = buildComparisonAiPrompt({
      sources: [wide],
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      householdName: "Smith Family",
    });
    expect(user).toMatch(/\b2031\b/);
    expect(user).not.toMatch(/\b2030\b/);
    expect(user).not.toMatch(/\b2032\b/);
  });

  it("returns identical strings for identical inputs (determinism)", () => {
    const a = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "x",
      householdName: "H",
    });
    const b = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "x",
      householdName: "H",
    });
    expect(a.system).toBe(b.system);
    expect(a.user).toBe(b.user);
  });
});
