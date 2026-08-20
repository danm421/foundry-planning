import { describe, it, expect } from "vitest";
import { TIDBITS, tidbitsById, renderTidbits, type TidbitTopic } from "../tidbits";
import { resolveAllTokens, type TokenContext } from "@/lib/plan-text/tokens";

const ALL_TOPICS: TidbitTopic[] = [
  "compounding",
  "taxes",
  "debt",
  "behavior",
  "accounts",
  "risk",
];

describe("TIDBITS", () => {
  it("ships at least 25 tidbits", () => {
    expect(TIDBITS.length).toBeGreaterThanOrEqual(25);
  });

  it("has unique, stable, kebab-case ids", () => {
    const ids = TIDBITS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("keeps every body short enough for a sidebar", () => {
    for (const t of TIDBITS) expect(t.body.length).toBeLessThanOrEqual(320);
  });

  it("covers every topic with more than one entry", () => {
    for (const topic of ALL_TOPICS) {
      const count = TIDBITS.filter((t) => t.topic === topic).length;
      expect(count).toBeGreaterThan(1);
    }
  });

  it("has no exact-duplicate bodies", () => {
    const bodies = TIDBITS.map((t) => t.body);
    expect(new Set(bodies).size).toBe(bodies.length);
  });
});

describe("tidbitsById", () => {
  it("returns the picks in the order asked for", () => {
    const [a, b] = TIDBITS;
    expect(tidbitsById([b.id, a.id]).map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it("drops an id that is no longer in the library", () => {
    expect(tidbitsById(["no-such-tidbit"])).toEqual([]);
  });
});

describe("renderTidbits", () => {
  it("substitutes plan tokens in the body", () => {
    const rendered = renderTidbits(["compounding-runway"], { client_first_name: "Dana" });
    expect(rendered[0].body).toContain("Dana");
    expect(rendered[0].body).not.toContain("{{");
  });

  it("leaves a body with no tokens unchanged", () => {
    const source = TIDBITS.find((t) => !t.body.includes("{{"))!;
    expect(renderTidbits([source.id], {})[0].body).toBe(source.body);
  });

  it("accepts a null token value (resolveAllTokens' real return shape) without throwing", () => {
    const rendered = renderTidbits(["compounding-runway"], { client_first_name: null });
    expect(rendered[0].body).not.toContain("{{");
  });
});

// ── The token guard ──────────────────────────────────────────────────────
//
// Phase 1 shipped `risk-volatility-is-normal` with `{{mc_success}}` in its body.
// No Early Years page is in `MONTE_CARLO_PAGE_IDS` and the built-in deck carries
// no Monte Carlo sheet, so `resolveAllTokens` returned null and `renderTokens`
// printed its em-dash fallback: "A plan modeled with a — confidence figure". It
// was filed as a wrong-article nit for three sessions before anyone read it as a
// missing VALUE rather than a missing article.
//
// Do NOT rewrite this as "the rendered body contains no em-dash". Several bodies
// use an em-dash as ordinary punctuation, so that assertion fails on correct copy
// and gets "fixed" by damaging the copy. Assert what is actually true: every
// token a tidbit references resolves to a non-null value on a deck this tidbit
// can appear in.

const TOKEN_PATTERN = /\{\{([a-z0-9_]+)\}\}/g;

/**
 * A plan of the kind this deck is built for: a 29-year-old with a salary, a
 * 401(k), and NO Monte Carlo run — because no Early Years page is in
 * `MONTE_CARLO_PAGE_IDS` and the built-in deck carries no Monte Carlo sheet, so
 * `monteCarlo` is genuinely null on every deck a tidbit can print on.
 */
function earlyYearsContext(): TokenContext {
  return {
    clientData: {
      planSettings: { planStartYear: 2026, inflationRate: 0.03, taxEngineMode: "bracket" },
      client: {
        firstName: "Cooper",
        lastName: "Sample",
        spouseName: null,
        currentAge: 29,
        retirementAge: 65,
        lifeExpectancy: 92,
      },
      accounts: [{ id: "a1", subType: "401k", name: "401(k)", owners: [] }],
      savingsRules: [
        {
          id: "r1",
          accountId: "a1",
          annualAmount: 0,
          annualPercent: 0.08,
          isDeductible: true,
          startYear: 2020,
          endYear: 2060,
        },
      ],
      incomes: [
        {
          id: "i1",
          type: "salary",
          name: "Salary",
          annualAmount: 120_000,
          owner: "client",
          growthRate: 0.03,
          startYear: 2020,
          endYear: 2060,
        },
      ],
      expenses: [],
      liabilities: [],
      familyMembers: [],
    },
    projection: {
      years: [
        {
          year: 2026,
          ages: { client: 29 },
          income: { salaries: 120_000, total: 120_000 },
          savings: { byAccount: { a1: 9_600 }, total: 9_600, employerTotal: 3_600 },
          expenses: { taxes: 22_000, total: 82_000 },
          totalIncome: 120_000,
          portfolioAssets: { liquidTotal: 48_000, total: 48_000 },
        },
      ],
    },
    monteCarlo: null,
  } as unknown as TokenContext;
}

describe("TIDBITS token coverage", () => {
  it("every token a tidbit uses resolves on a deck that tidbit can print on", () => {
    const values = resolveAllTokens(earlyYearsContext());
    for (const t of TIDBITS) {
      for (const [, id] of t.body.matchAll(TOKEN_PATTERN)) {
        expect(values, `${t.id} uses an unregistered token {{${id}}}`).toHaveProperty(id);
        expect(
          values[id],
          `${t.id} uses {{${id}}}, which resolves to null on an Early Years deck — it would print the em-dash fallback`,
        ).not.toBeNull();
      }
    }
  });

  it("leaves no unsubstituted placeholder once rendered", () => {
    const values = resolveAllTokens(earlyYearsContext());
    for (const t of renderTidbits(
      TIDBITS.map((x) => x.id),
      values,
    )) {
      expect(t.body, t.id).not.toContain("{{");
    }
  });

  // `renderTidbits` substitutes the BODY and nothing else, so a token in a title
  // prints as literal braces on the sheet. Cheaper to forbid than to support.
  it("keeps tokens out of titles, which are never substituted", () => {
    for (const t of TIDBITS) expect(t.title, t.id).not.toContain("{{");
  });
});
