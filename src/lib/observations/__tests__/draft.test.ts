import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { resolveAllTokens, type TokenContext } from "@/lib/plan-text/tokens";
import type { DisplayUnit } from "@/lib/presentations/pages/scenario-changes/types";

// Shared mock fns declared via vi.hoisted so the vi.mock factory (hoisted
// above imports) can close over them, and beforeEach can reset them.
const { mockInvoke, mockWithStructuredOutput, mockChatModel } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  const mockWithStructuredOutput = vi.fn(() => ({ invoke: mockInvoke }));
  const mockChatModel = vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput }));
  return { mockInvoke, mockWithStructuredOutput, mockChatModel };
});

vi.mock("@/domain/forge/llm", () => ({ chatModel: mockChatModel }));

// Import AFTER the mock is declared.
import {
  buildObservationsFacts,
  draftFailureMessage,
  generateObservationsDraft,
  ObservationSuggestionSchema,
} from "../draft";

const CLIENT_DATA = {
  client: {
    firstName: "Sam",
    lastName: "Cooper",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 95,
    spouseName: "Jamie",
    spouseDob: "1972-01-01",
    spouseRetirementAge: 63,
    filingStatus: "married_joint",
  },
  accounts: [],
  incomes: [],
  expenses: [
    {
      id: "e1",
      type: "education",
      name: "College for Riley",
      annualAmount: 40_000,
      startYear: 2032,
      endYear: 2036,
      growthRate: 0.03,
    },
    {
      id: "e2",
      type: "living",
      name: "Living expenses",
      annualAmount: 50_000,
      startYear: 2026,
      endYear: 2060,
      growthRate: 0.03,
    },
  ],
  liabilities: [
    {
      id: "l1",
      name: "Mortgage",
      balance: 300_000,
      interestRate: 0.05,
      monthlyPayment: 2000,
      startYear: 2015,
      startMonth: 1,
      termMonths: 360,
      extraPayments: [],
      owners: [],
    },
  ],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: {
    residenceState: "CA",
    flatFederalRate: 0.22,
    flatStateRate: 0.05,
    inflationRate: 0.03,
    planStartYear: 2026,
    planEndYear: 2060,
  },
  giftEvents: [],
} as unknown as ClientData;

const CLIENT_DATA_NO_EDUCATION = {
  ...CLIENT_DATA,
  expenses: [(CLIENT_DATA.expenses as unknown[])[1]],
} as unknown as ClientData;

// `liabilityBalancesBoY` is the mortgage amortized to the start of the plan
// year; CLIENT_DATA.liabilities[0].balance is the older as-of figure the
// advisor typed. They differ on purpose so a fact sheet that itemizes the raw
// balance is distinguishable from one that itemizes what {{total_liabilities}}
// actually sums.
const FIRST_YEAR = {
  year: 2026,
  ages: { client: 55, spouse: 53 },
  liabilityBalancesBoY: { l1: 288_000 },
  portfolioAssets: {
    taxable: { a1: 900_000 },
    realEstate: { h1: 100_000 },
    total: 1_000_000,
    liquidTotal: 900_000,
  },
  accountLedgers: {
    a1: { beginningValue: 800_000, endingValue: 900_000 },
    h1: { beginningValue: 95_000, endingValue: 100_000 },
  },
  totalIncome: 200_000,
  expenses: { total: 90_000 },
  savings: { total: 40_000 },
};

const LAST_YEAR = {
  year: 2060,
  ages: { client: 89, spouse: 87 },
  liabilityBalancesBoY: {},
  portfolioAssets: { total: 3_000_000, liquidTotal: 2_800_000 },
  accountLedgers: {},
  totalIncome: 0,
  expenses: { total: 0 },
  savings: { total: 0 },
  hypotheticalEstateTax: { primaryFirst: { totals: { total: 250_000 } } },
};

const LAST_YEAR_NO_ESTATE_TAX = {
  ...LAST_YEAR,
  hypotheticalEstateTax: undefined,
};

const PROJECTION = { years: [FIRST_YEAR, LAST_YEAR] } as unknown as ProjectionResult;

const CTX: TokenContext = {
  clientData: CLIENT_DATA,
  projection: PROJECTION,
  monteCarlo: { successRate: 0.84 },
};

describe("buildObservationsFacts", () => {
  it("includes resolved figures alongside their merge tokens", () => {
    const values = resolveAllTokens(CTX);
    const facts = buildObservationsFacts(CTX);
    expect(facts).toContain(values.net_worth!);
    expect(facts).toContain(values.portfolio_assets!);
    expect(facts).toContain(values.total_liabilities!);
    expect(facts).toContain(values.annual_income!);
    expect(facts).toContain(values.annual_spending!);
    expect(facts).toContain(values.annual_savings!);
    expect(facts).toContain(values.mc_success!);
    expect(facts).toContain(values.estate_tax_at_horizon!);
    expect(facts).toContain("{{net_worth}}");
    expect(facts).toContain("{{annual_income}}");
    expect(facts).toContain("{{mc_success}}");
  });

  it("includes the full merge-token cheat-sheet with id + label pairs", () => {
    const facts = buildObservationsFacts(CTX);
    expect(facts).toContain("{{net_worth}} — Net worth (today)");
    expect(facts).toContain("{{annual_income}} — Annual income (this year)");
    expect(facts).toContain("{{mc_success}} — Plan confidence");
  });

  it("includes household names, ages, retirement ages, filing status and state", () => {
    const facts = buildObservationsFacts(CTX);
    expect(facts).toContain("Sam & Jamie");
    expect(facts).toContain("55");
    expect(facts).toContain("53");
    expect(facts).toContain("married_joint");
    expect(facts).toContain("CA");
  });

  it("itemizes liabilities at the balance {{total_liabilities}} sums, not the raw as-of balance", () => {
    // Line items that don't add up to the token the model is told to quote is
    // how a client-facing paragraph ends up contradicting its own arithmetic.
    const facts = buildObservationsFacts(CTX);
    expect(facts).toContain("Mortgage");
    expect(facts).toContain("$288,000");
    expect(facts).not.toContain("$300,000");
  });

  it("grounds the balance-sheet figures as of today, not the end of plan year 1", () => {
    const facts = buildObservationsFacts(CTX);
    // BoY liquid = 800,000; BoY total assets = 895,000; less 288,000 of debt.
    expect(facts).toContain("Portfolio assets (today): $800,000");
    expect(facts).toContain("Net worth (today): $607,000");
    // The end-of-year snapshot must not leak in anywhere.
    expect(facts).not.toContain("$900,000");
    expect(facts).not.toContain("$712,000");
  });

  it("labels the cash-flow figures as full-year totals so they read as flows", () => {
    const facts = buildObservationsFacts(CTX);
    expect(facts).toMatch(/full-year total/i);
  });

  it("includes education goals when the client carries them", () => {
    const facts = buildObservationsFacts(CTX);
    expect(facts).toContain("College for Riley");
    expect(facts).toContain("$40,000");
  });

  it("omits the education-goals section when the client carries none", () => {
    const facts = buildObservationsFacts({ ...CTX, clientData: CLIENT_DATA_NO_EDUCATION });
    expect(facts).not.toContain("College for Riley");
    expect(facts).not.toContain("Education goals");
  });

  it("reads a missing Monte Carlo figure as 'not computed', never a fabricated number", () => {
    const facts = buildObservationsFacts({ ...CTX, monteCarlo: null });
    expect(facts).toMatch(/Plan confidence[^\n]*not computed/i);
    expect(facts).not.toMatch(/Plan confidence:\s*\d/i);
  });

  it("reads a missing estate-tax figure as 'not computed', never a fabricated number", () => {
    const projectionNoEstateTax = {
      years: [FIRST_YEAR, LAST_YEAR_NO_ESTATE_TAX],
    } as unknown as ProjectionResult;
    const facts = buildObservationsFacts({ ...CTX, projection: projectionNoEstateTax });
    expect(facts).toMatch(/Estate tax[^\n]*not computed/i);
  });
});

describe("generateObservationsDraft", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockWithStructuredOutput.mockClear();
    mockChatModel.mockClear();
  });

  it("calls chatModel(\"full\").withStructuredOutput(schema).invoke([system, human]) and returns the parsed suggestions", async () => {
    const fixture = {
      suggestions: [
        {
          section: "observation" as const,
          topic: "retirement" as const,
          title: null,
          body: "The household is on track for its retirement goal.",
          owner: null,
          priority: null,
        },
      ],
    };
    mockInvoke.mockResolvedValue(fixture);

    const result = await generateObservationsDraft("FACT SHEET TEXT");

    expect(mockChatModel).toHaveBeenCalledWith("full");
    expect(mockWithStructuredOutput).toHaveBeenCalledWith(ObservationSuggestionSchema);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const messages = mockInvoke.mock.calls[0][0];
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toMatch(/Use ONLY the facts provided/);
    expect(messages[1].content).toBe("FACT SHEET TEXT");
    expect(result).toEqual(fixture);
  });

  // The prod failure: the model omitted owner/priority on its observations
  // (they only make sense on a next step) and the whole draft was rejected.
  it("accepts suggestions that omit title/owner/priority, and settles them to null", async () => {
    const modelReply = {
      suggestions: [
        {
          section: "observation" as const,
          topic: "cash-flow" as const,
          title: "Current cash flow",
          body: "Annual income is {{annual_income}}.",
        },
        {
          section: "next_step" as const,
          topic: "retirement" as const,
          title: "Revisit the plan",
          body: "Review plan confidence in six months.",
          owner: "advisor" as const,
          priority: "high" as const,
        },
      ],
    };
    expect(ObservationSuggestionSchema.safeParse(modelReply).success).toBe(true);

    mockInvoke.mockResolvedValue(modelReply);
    const result = await generateObservationsDraft("FACT SHEET TEXT");

    expect(result.suggestions[0]).toEqual({
      section: "observation",
      topic: "cash-flow",
      title: "Current cash flow",
      body: "Annual income is {{annual_income}}.",
      owner: null,
      priority: null,
    });
    expect(result.suggestions[1].owner).toBe("advisor");
    expect(result.suggestions[1].priority).toBe("high");
  });

  it("still rejects a suggestion with no body — the one field there is no sane default for", () => {
    const parsed = ObservationSuggestionSchema.safeParse({
      suggestions: [{ section: "observation", topic: "tax", body: "" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("draftFailureMessage", () => {
  it("never leaks a parser exception's embedded model output", () => {
    const err = Object.assign(
      new Error('Failed to parse. Text: "{ \"suggestions\": [ ... ] }". Error: [...]'),
      { lc_error_code: "OUTPUT_PARSING_FAILURE" },
    );
    const msg = draftFailureMessage(err);
    expect(msg).toBe("The AI draft came back in an unexpected format. Please try again.");
    expect(msg).not.toMatch(/suggestions|Failed to parse/);
  });

  it("names a missing AI configuration", () => {
    expect(draftFailureMessage(new Error("ai_not_configured"))).toMatch(/isn't set up/);
  });

  it("falls back to a plain retry message for anything else", () => {
    expect(draftFailureMessage(new Error("ECONNRESET"))).toBe(
      "The AI draft didn't finish. Please try again.",
    );
    expect(draftFailureMessage("nope")).toBe("The AI draft didn't finish. Please try again.");
  });
});

const ROW_EDIT = {
  area: "Savings" as const, what: "Dan's 401(k) deferral", op: "edit" as const,
  before: "6%", after: "12%", detail: ["Raises the annual contribution to the IRS limit."],
};
const ROW_RESTATE = {
  area: "Plan & Assumptions" as const, what: "Retirement age", op: "edit" as const,
  before: "65", after: "62", detail: ["Adjusts this assumption."], restatesRow: true as const,
};
const ROW_ADD = {
  area: "Assets" as const, what: "+ Roth conversion", op: "add" as const,
  before: "—", after: "Added", detail: ["$60,000 a year, 2028–2031"],
};
const ROW_REMOVE = {
  area: "Expenses" as const, what: "Boat", op: "remove" as const, before: "In plan", after: "Removed", detail: [],
};
const UNITS: DisplayUnit[] = [
  { kind: "row", row: ROW_EDIT },
  { kind: "group", label: "Retire early", rows: [ROW_RESTATE, ROW_ADD] },
  { kind: "row", row: ROW_REMOVE },
];

describe("buildObservationsFacts — proposed changes and advisor notes", () => {
  it("prints nothing extra by default — the Details panel's fact sheet is byte-identical", () => {
    expect(buildObservationsFacts(CTX)).toBe(buildObservationsFacts(CTX, {}));
    expect(buildObservationsFacts(CTX)).not.toContain("PROPOSED CHANGES");
    expect(buildObservationsFacts(CTX)).not.toContain("ADVISOR NOTES");
  });

  it("prints the changes section after the figures with the rich describer's words", () => {
    const facts = buildObservationsFacts(CTX, { proposedChanges: { scenarioName: "Retire at 62", units: UNITS } });
    expect(facts).toContain('PROPOSED CHANGES — the scenario "Retire at 62" makes these edits to the current plan.');
    expect(facts).toContain("Each one is a decision the client will need to act on:");
    expect(facts).toContain("  [Savings] Dan's 401(k) deferral — 6% → 12%. Raises the annual contribution to the IRS limit.");
    expect(facts).toContain("  [Assets] Roth conversion (new) — $60,000 a year, 2028–2031");
    expect(facts).toContain("  [Expenses] Boat — removed from the plan");
    // Rich describers, not the terse fallback.
    expect(facts).not.toContain("savings_rule");
    // Order: figures, then changes, then the cheat-sheet.
    expect(facts.indexOf("Net worth (today)")).toBeLessThan(facts.indexOf("PROPOSED CHANGES"));
    expect(facts.indexOf("PROPOSED CHANGES")).toBeLessThan(facts.indexOf("MERGE TOKEN CHEAT-SHEET"));
  });

  it("prints a group's label once and indents its members under it", () => {
    const facts = buildObservationsFacts(CTX, { proposedChanges: { scenarioName: "Retire at 62", units: UNITS } });
    const lines = facts.split("\n");
    const labelIdx = lines.indexOf("  Retire early:");
    expect(labelIdx).toBeGreaterThan(-1);
    expect(lines[labelIdx + 1]).toBe("    [Plan & Assumptions] Retirement age — 65 → 62");
    expect(lines[labelIdx + 2]).toBe("    [Assets] Roth conversion (new) — $60,000 a year, 2028–2031");
    expect(facts.match(/Retire early:/g)).toHaveLength(1);
  });

  it("drops a detail that only restates the row, as the changes table does", () => {
    const facts = buildObservationsFacts(CTX, { proposedChanges: { scenarioName: "S", units: UNITS } });
    expect(facts).not.toContain("Adjusts this assumption.");
  });

  it("prints the advisor's notes last, and not at all when blank", () => {
    const facts = buildObservationsFacts(CTX, {
      proposedChanges: { scenarioName: "S", units: UNITS },
      advisorNotes: "They are nervous about the conversion — keep it optional.",
    });
    const lines = facts.trimEnd().split("\n");
    expect(lines.at(-2)).toBe("ADVISOR NOTES");
    expect(lines.at(-1)).toBe("They are nervous about the conversion — keep it optional.");
    expect(buildObservationsFacts(CTX, { advisorNotes: "   " })).not.toContain("ADVISOR NOTES");
  });
});

describe("generateObservationsDraft — sections", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      suggestions: [
        { section: "observation", topic: "retirement", body: "An observation." },
        { section: "next_step", topic: "tax", title: "Update the election", body: "Raise it to 12%.", owner: "client", priority: "high" },
      ],
    });
  });

  it("asks for next steps only and drops any observation the model still returns", async () => {
    const out = await generateObservationsDraft("FACTS", { section: "next_step" });
    const [system] = mockInvoke.mock.calls[0][0] as Array<{ content: string }>;
    expect(system.content).toContain("PROPOSED CHANGES");
    expect(system.content).toContain("one for each change that implies something the client or advisor must DO");
    expect(system.content).not.toContain("Produce 4–8 observations");
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].section).toBe("next_step");
  });

  it("asks for observations only and drops any next step the model still returns", async () => {
    const out = await generateObservationsDraft("FACTS", { section: "observation" });
    const [system] = mockInvoke.mock.calls[0][0] as Array<{ content: string }>;
    expect(system.content).toContain("Produce observations ONLY");
    expect(out.suggestions.map((s) => s.section)).toEqual(["observation"]);
  });

  it("with no section keeps today's prompt and both sections", async () => {
    const out = await generateObservationsDraft("FACTS");
    const [system] = mockInvoke.mock.calls[0][0] as Array<{ content: string }>;
    expect(system.content).toContain("Produce 4–8 observations");
    expect(out.suggestions).toHaveLength(2);
  });
});
