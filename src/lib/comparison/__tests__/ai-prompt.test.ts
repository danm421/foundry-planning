import { describe, it, expect } from "vitest";
import { buildComparisonAiPrompt, formatMoney, type AiPlanYearly } from "../ai-prompt";
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
    expect(system).toMatch(/lead with the single most important point/i);
    expect(system).toMatch(/2-3 sentences total/i);
    expect(system).toMatch(/address the client by first name/);
  });

  it("always bakes in a warm/personable baseline and money formatting rules", () => {
    const { system } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "detailed",
      length: "long",
      customInstructions: "",
      householdName: "Smith Family",
    });
    expect(system).toMatch(/warm, personable, and conversational/i);
    expect(system).toMatch(/never invent figures/i);
    expect(system).toMatch(/\$X\.XM/);
    expect(system).toMatch(/\$XXX K|\$XXX\sK|\$XXX,XXX|XXX K/i);
    expect(system).toMatch(/percentages with at most one decimal/i);
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

  it("pre-formats year-row money values in the user prompt", () => {
    const { user } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      householdName: "Smith Family",
    });
    // 100000 → $100K, 1_000_000 → $1.0M, 80000 → $80K. Raw decimals must be gone.
    expect(user).toMatch(/\$100K/);
    expect(user).toMatch(/\$1\.0M|\$1\.1M/);
    expect(user).not.toMatch(/100000\b|1000000\b/);
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

describe("formatMoney", () => {
  it("formats millions with one decimal and an M suffix", () => {
    expect(formatMoney(3_664_560.69)).toBe("$3.7M");
    expect(formatMoney(12_784_402.37)).toBe("$12.8M");
  });

  it("formats five and six-figure values as rounded K", () => {
    expect(formatMoney(473_772.08)).toBe("$474K");
    expect(formatMoney(95_387.31)).toBe("$95K");
  });

  it("formats low four-figure values as X.XK", () => {
    expect(formatMoney(1234)).toBe("$1.2K");
  });

  it("formats values under $1,000 as a rounded dollar amount", () => {
    expect(formatMoney(750.4)).toBe("$750");
    expect(formatMoney(0)).toBe("$0");
  });

  it("handles negative values", () => {
    expect(formatMoney(-95_387)).toBe("-$95K");
  });
});
