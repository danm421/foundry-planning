import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { resolveAllTokens, type TokenContext } from "@/lib/plan-text/tokens";

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

const FIRST_YEAR = {
  year: 2026,
  ages: { client: 55, spouse: 53 },
  liabilityBalancesBoY: { l1: 300_000 },
  portfolioAssets: { total: 1_000_000, liquidTotal: 900_000 },
  totalIncome: 200_000,
  expenses: { total: 90_000 },
  savings: { total: 40_000 },
};

const LAST_YEAR = {
  year: 2060,
  ages: { client: 89, spouse: 87 },
  liabilityBalancesBoY: {},
  portfolioAssets: { total: 3_000_000, liquidTotal: 2_800_000 },
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
    expect(facts).toContain("{{annual_income}} — Annual income (today)");
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

  it("lists liabilities by name and balance", () => {
    const facts = buildObservationsFacts(CTX);
    expect(facts).toContain("Mortgage");
    expect(facts).toContain("$300,000");
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
