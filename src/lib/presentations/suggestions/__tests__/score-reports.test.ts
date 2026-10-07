import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES, type PresentationPageId } from "@/components/presentations/registry";
import type { PlanFacts, ProjectedFacts } from "../plan-facts";
import { keepSlots, pickSuggestions, scoreReports, type ReportSuggestion } from "../score-reports";

const NO_PROJECTION_SIGNALS: ProjectedFacts = {
  rothConverted: 0,
  rothFirstYear: null,
  rothLastYear: null,
  estateTax: 0,
  grossEstate: 0,
  irmaaTotal: 0,
  irmaaFirstYear: null,
  withdrawalFirstYear: null,
  depletionYear: null,
};

/** A mid-career married couple with nothing remarkable on file. */
function facts(over: Partial<PlanFacts> = {}, projected: Partial<ProjectedFacts> = {}): PlanFacts {
  return {
    planRef: "base",
    scenarios: [],
    proposals: [],
    hasHoldings: false,
    observationCount: 0,
    storyChapterCount: 0,
    currentYear: 2026,
    married: true,
    clientFirstName: "Alex",
    clientAge: 48,
    youngestAge: 46,
    yearsToRetirement: 17,
    allRetired: false,
    medicareYear: 2043,
    minorChildren: 0,
    educationGoals: 0,
    salaryIncome: 180_000,
    annualSavings: 20_000,
    absorbsSurplus: true,
    liquidPortfolio: 400_000,
    preTax: 250_000,
    roth: 50_000,
    realEstate: 600_000,
    business: 0,
    netWorth: 800_000,
    topDebt: null,
    trusts: [],
    businesses: [],
    willCount: 0,
    giftCount: 0,
    lifePolicyCount: 0,
    lifeFaceValue: 0,
    projected: { ...NO_PROJECTION_SIGNALS, ...projected },
    ...over,
  };
}

const categoryOf = (id: PresentationPageId) => PRESENTATION_PAGES[id].category;
const ids = (s: ReportSuggestion[]) => s.map((x) => x.pageId);
const top = (f: PlanFacts, deck: string[] = []) =>
  pickSuggestions(scoreReports(f), new Set(deck), categoryOf);

describe("scoreReports", () => {
  it("only ever names real pages, and never the framing shells", () => {
    const all = scoreReports(facts({ youngestAge: 30, clientAge: 30 }, { estateTax: 1 }));
    for (const s of all) expect(PRESENTATION_PAGES[s.pageId]).toBeDefined();
    expect(ids(all)).not.toContain("cover");
    expect(ids(all)).not.toContain("toc");
    expect(ids(all)).not.toContain("blank");
  });

  it("leads with the Roth Conversion page when the plan converts, and says how much", () => {
    const f = facts({}, { rothConverted: 312_000, rothFirstYear: 2027, rothLastYear: 2031 });
    const [first] = scoreReports(f);
    expect(first.pageId).toBe("rothConversion");
    expect(first.reason).toBe("This plan converts $312k to Roth, 2027–2031.");
    expect(first.optionsPatch).toEqual({ scenarioId: "base" });
  });

  it("points the Roth page at the scenario that adds conversions when the chosen plan has none", () => {
    const f = facts({ scenarios: [{ id: "s1", name: "Roth ladder", changeCount: 2, addsRothConversion: true }] });
    const roth = scoreReports(f).find((s) => s.pageId === "rothConversion");
    expect(roth?.optionsPatch).toEqual({ scenarioId: "s1" });
    expect(roth?.reason).toContain("“Roth ladder” adds Roth conversions");
    const tax = scoreReports(f).find((s) => s.pageId === "taxComparison");
    expect(tax?.optionsPatch).toEqual({ scenarioId: "s1" });
  });

  it("does not hand a snapshot to a page that reads its own plan", () => {
    const f = facts({ planRef: "snap:abc" }, { rothConverted: 10_000, rothFirstYear: 2030, rothLastYear: 2030 });
    const roth = scoreReports(f).find((s) => s.pageId === "rothConversion");
    expect(roth?.reason).toBe("This plan converts $10k to Roth in 2030.");
    expect(roth?.optionsPatch).toBeUndefined();
  });

  it("offers the Debt-or-Invest sheet pointed at the costliest debt", () => {
    const f = facts({
      youngestAge: 29,
      clientAge: 29,
      topDebt: { id: "l1", name: "Student loan", balance: 42_000, interestRate: 0.068 },
    });
    const debt = scoreReports(f).find((s) => s.pageId === "earlyYearsDebtOrInvest");
    expect(debt?.reason).toBe("$42k on Student loan at 6.8% — pay it down, or invest?");
    expect(debt?.optionsPatch).toEqual({ liabilityId: "l1" });
  });

  it("drops the ladder's score when the plan already invests every leftover dollar", () => {
    const young = { youngestAge: 31, clientAge: 31 };
    const absorbing = scoreReports(facts({ ...young, absorbsSurplus: true })).find((s) => s.pageId === "earlyYearsLadder");
    const flat = scoreReports(facts({ ...young, absorbsSurplus: false })).find((s) => s.pageId === "earlyYearsLadder");
    expect(flat!.score).toBeLessThan(absorbing!.score);
  });

  it("ranks a Medicare surcharge decades away well below one that is near", () => {
    const score = (irmaaFirstYear: number) =>
      scoreReports(facts({}, { irmaaTotal: 48_000, irmaaFirstYear })).find((s) => s.pageId === "medicareSummary")!.score;
    expect(score(2052)).toBeLessThan(50);
    expect(score(2031)).toBeGreaterThanOrEqual(90);
  });

  it("suggests Withdrawals only when the first draw is within ten years", () => {
    const has = (withdrawalFirstYear: number) =>
      ids(scoreReports(facts({}, { withdrawalFirstYear }))).includes("cashFlowWithdrawals");
    expect(has(2030)).toBe(true);
    expect(has(2065)).toBe(false);
  });

  it("names a lone trust instead of counting it", () => {
    const f = facts({ trusts: [{ id: "t", name: "Family Irrevocable Trust" }] });
    expect(scoreReports(f).find((s) => s.pageId === "entitiesBalanceSheet")!.reason).toBe(
      "Assets, debts and net worth for Family Irrevocable Trust.",
    );
  });

  it("keeps the comparison pages quiet when no scenario changes anything", () => {
    const f = facts({ scenarios: [{ id: "s1", name: "Empty", changeCount: 0, addsRothConversion: false }] });
    const found = ids(scoreReports(f));
    expect(found).not.toContain("retirementComparison");
    expect(found).not.toContain("scenarioChanges");
    expect(found).not.toContain("scenarioComparison");
  });

  it("aims the comparison pages at the chosen scenario", () => {
    const f = facts({
      planRef: "s2",
      scenarios: [
        { id: "s1", name: "Retire at 62", changeCount: 1, addsRothConversion: false },
        { id: "s2", name: "Downsize", changeCount: 3, addsRothConversion: false },
      ],
    });
    const all = scoreReports(f);
    const rc = all.find((s) => s.pageId === "retirementComparison")!;
    expect(rc.optionsPatch).toEqual({ scenarioId: "s2" });
    expect(rc.reason).toBe("Does “Downsize” beat Base Case for retirement?");
    expect(all.find((s) => s.pageId === "scenarioChanges")!.reason).toBe(
      "The 3 changes “Downsize” makes, in plain words.",
    );
    expect(all.find((s) => s.pageId === "scenarioComparison")!.optionsPatch).toEqual({ scenarioIds: ["s1", "s2"] });
  });
});

describe("optionsPatch", () => {
  it("names only fields each page's own options accept", () => {
    // Every patch-bearing rule fires on this plan; a patch whose keys drift
    // from the page schema would otherwise fall back to defaults silently.
    const f = facts(
      {
        planRef: "s1",
        youngestAge: 30,
        clientAge: 30,
        topDebt: { id: "l1", name: "Loan", balance: 10_000, interestRate: 0.07 },
        businesses: [{ id: "b1", name: "Acme LLC" }],
        proposals: [{ id: "p1", name: "Move to index" }],
        scenarios: [
          { id: "s1", name: "Roth ladder", changeCount: 2, addsRothConversion: true },
          { id: "s2", name: "Downsize", changeCount: 1, addsRothConversion: false },
        ],
      },
      { rothConverted: 50_000, rothFirstYear: 2027, rothLastYear: 2028 },
    );
    const patched = scoreReports(f).filter((s) => s.optionsPatch);
    expect(ids(patched)).toEqual(
      expect.arrayContaining([
        "rothConversion", "taxComparison", "retirementComparison", "scenarioChanges",
        "scenarioComparison", "entityCashFlow", "investmentProposal", "earlyYearsDebtOrInvest",
      ]),
    );
    for (const s of patched) {
      const page = PRESENTATION_PAGES[s.pageId];
      const merged = { ...(page.defaultOptions as Record<string, unknown>), ...s.optionsPatch };
      const parsed = page.optionsSchema.safeParse(merged);
      expect(parsed.success, s.pageId).toBe(true);
      for (const key of Object.keys(s.optionsPatch!)) {
        expect((parsed.data as Record<string, unknown>)[key], `${s.pageId}.${key}`).toEqual(s.optionsPatch![key]);
      }
    }
  });
});

describe("pickSuggestions", () => {
  it("always fills four slots, even for a plan with nothing remarkable", () => {
    expect(top(facts())).toHaveLength(4);
  });

  it("gives a young household its early-years sheets, but not every slot", () => {
    const f = facts({
      youngestAge: 30,
      clientAge: 31,
      yearsToRetirement: 35,
      minorChildren: 2,
      topDebt: { id: "l1", name: "Student loan", balance: 30_000, interestRate: 0.055 },
    });
    const picked = top(f);
    const early = picked.filter((s) => categoryOf(s.pageId) === "Early Years");
    expect(early.length).toBeGreaterThanOrEqual(2);
    expect(early.length).toBeLessThan(4);
    expect(ids(picked)).toContain("earlyYearsDebtOrInvest");
    expect(ids(picked)).toContain("lifeInsuranceSummary");
  });

  it("surfaces retirement and Medicare for a couple near retirement who will pay IRMAA", () => {
    const f = facts(
      { clientAge: 61, youngestAge: 60, yearsToRetirement: 4, medicareYear: 2030 },
      { irmaaTotal: 48_000, irmaaFirstYear: 2031 },
    );
    const picked = ids(top(f));
    expect(picked).toContain("medicareSummary");
    expect(picked).toContain("retirementSummary");
    expect(picked).not.toContain("earlyYearsStanding");
  });

  it("swaps only the card just added: the others keep their slots", () => {
    const f = facts({}, { estateTax: 2_100_000, grossEstate: 18_000_000 });
    const before = ids(top(f));
    const added = before[1];
    const after = ids(keepSlots(before, top(f, [added])));
    expect(after).toHaveLength(4);
    expect(after).not.toContain(added);
    expect([after[0], after[2], after[3]]).toEqual([before[0], before[2], before[3]]);
  });

  it("skips every page already in the deck", () => {
    const deck = ["balanceSheet", "cashFlow", "retirementSummary", "taxSummary"];
    for (const s of top(facts(), deck)) expect(deck).not.toContain(s.pageId);
  });
});

describe("keepSlots", () => {
  const s = (pageId: PresentationPageId): ReportSuggestion => ({ pageId, score: 50, reason: "" });

  it("lays out in rank order when nothing was shown before", () => {
    expect(ids(keepSlots([], [s("cashFlow"), s("monteCarlo")]))).toEqual(["cashFlow", "monteCarlo"]);
  });

  it("fills emptied slots in place, then appends any extra newcomers", () => {
    const out = keepSlots(
      ["cashFlow", "monteCarlo", "holdings"],
      [s("holdings"), s("taxSummary"), s("cashFlow"), s("balanceSheet")],
    );
    expect(ids(out)).toEqual(["cashFlow", "taxSummary", "holdings", "balanceSheet"]);
  });
});
