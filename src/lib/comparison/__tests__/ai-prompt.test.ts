import { describe, it, expect } from "vitest";
import {
  buildComparisonAiPrompt,
  formatMoney,
  type AiPlanYearly,
  type HouseholdContext,
} from "../ai-prompt";
import type { ResolvedSource } from "../ai-source-resolve";

const household: HouseholdContext = {
  clientFirstName: "John",
  clientLastName: "Smith",
  clientCurrentAge: 62,
  clientRetirementAge: 65,
  clientRetirementYear: 2030,
  planEndAge: 95,
  spouse: {
    firstName: "Jane",
    currentAge: 58,
    retirementAge: 67,
    retirementYear: 2034,
  },
  filingStatus: "married_joint",
  inflationRate: 0.025,
  residenceState: "TX",
  planStartYear: 2026,
  planEndYear: 2070,
};

const householdSolo: HouseholdContext = {
  clientFirstName: "Ada",
  clientLastName: "Lovelace",
  clientCurrentAge: 50,
  clientRetirementAge: 65,
  clientRetirementYear: 2041,
  planEndAge: 95,
  filingStatus: "single",
  inflationRate: 0.025,
  residenceState: null,
  planStartYear: 2026,
  planEndYear: 2071,
};

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
      household,
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
      household,
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
      household,
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
      household,
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
      household,
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
      household,
    });
    // Only check the plan-data section — the household context block also
    // mentions the household's own retirement year (which may collide with
    // any year-range we test against).
    const planSection = user.split("Yearly projection data")[1] ?? "";
    expect(planSection).toMatch(/\b2031\b/);
    expect(planSection).not.toMatch(/\b2030\b/);
    expect(planSection).not.toMatch(/\b2032\b/);
  });

  it("pre-formats year-row money values in the user prompt", () => {
    const { user } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      household,
    });
    // 100000 → $100K, 1_000_000 → $1.0M, 80000 → $80K. Raw decimals must be gone.
    expect(user).toMatch(/\$100K/);
    expect(user).toMatch(/\$1\.0M|\$1\.1M/);
    expect(user).not.toMatch(/100000\b|1000000\b/);
  });

  it("emits an 'About the household' section with names, ages, retirement years, filing, and inflation", () => {
    const { user } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      household,
    });
    expect(user).toMatch(/About the household:/);
    expect(user).toMatch(/John.*age 62.*retires at age 65.*2030/);
    expect(user).toMatch(/Jane.*age 58.*retires at age 67.*2034/);
    expect(user).toMatch(/married filing jointly/);
    expect(user).toMatch(/Inflation assumption: 2\.5%/);
    expect(user).toMatch(/Residence state: TX/);
    expect(user).toMatch(/Plan horizon: 2026.{1,3}2070.*age 95/);
  });

  it("omits the spouse line and residence state for a single household with no state set", () => {
    const { user, system } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      household: householdSolo,
    });
    expect(user).not.toMatch(/Jane|spouse/i);
    expect(user).not.toMatch(/Residence state/);
    // System prompt should only mention Ada, not "Ada and Jane".
    expect(system).toMatch(/\bAda\b/);
    expect(system).not.toMatch(/Jane/);
  });

  it("tells the model to address the household by first name in the system prompt", () => {
    const { system } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      household,
    });
    expect(system).toMatch(/Address the household by first name/);
    expect(system).toMatch(/John and Jane/);
  });

  it("returns identical strings for identical inputs (determinism)", () => {
    const a = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "x",
      household,
    });
    const b = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "x",
      household,
    });
    expect(a.system).toBe(b.system);
    expect(a.user).toBe(b.user);
  });
});

describe("buildComparisonAiPrompt mcByPlan", () => {
  const mcByPlan = [
    {
      planId: "base",
      label: "Baseline",
      successRate: 0.823,
      ending: {
        p5: 250_000,
        p20: 800_000,
        p50: 2_100_000,
        p80: 4_500_000,
        p95: 7_800_000,
        min: 0,
        max: 12_300_000,
        mean: 2_900_000,
      },
      byYear: [
        { year: 2026, age: 65, p5: 900_000, p50: 1_000_000, p95: 1_100_000 },
        { year: 2050, age: 89, p5: 200_000, p50: 1_800_000, p95: 5_400_000 },
      ],
    },
  ];

  it("includes a Monte Carlo block with success rate and ending percentiles when mcByPlan is provided", () => {
    const { user } = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      household,
      mcByPlan,
    });
    expect(user).toMatch(/Monte Carlo simulation results/);
    expect(user).toMatch(/Success rate: 82\.3%/);
    expect(user).toMatch(/median \$2\.1M/);
    expect(user).toMatch(/worst \$0/);
  });

  it("omits the Monte Carlo block when mcByPlan is null or empty", () => {
    const a = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      household,
      mcByPlan: null,
    });
    const b = buildComparisonAiPrompt({
      sources,
      plans,
      tone: "concise",
      length: "short",
      customInstructions: "",
      household,
      mcByPlan: [],
    });
    expect(a.user).not.toMatch(/Monte Carlo simulation results/);
    expect(b.user).not.toMatch(/Monte Carlo simulation results/);
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
