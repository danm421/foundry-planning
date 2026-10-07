import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES, type PresentationPageId } from "@/components/presentations/registry";
import type { PlanFacts, ProjectedFacts } from "../plan-facts";
import type { ChangeDetail, ChangeType, MovedTest, ScenarioFacts } from "../scenario-facts";
import { scenarioMatches } from "../scenario-rules";
import { keepSlots, missingEssentials, pickSuggestions, scoreReports, type ReportSuggestion } from "../score-reports";

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
  lifetimeTax: { total: 0, federal: 0, state: 0, capitalGains: 0 },
  topFederalRate: null,
  bracketEdgeYears: 0,
  conversionTopRate: null,
  conversionEdgeYears: 0,
  conversionYears: 0,
  amtOrNiitYears: 0,
  bigGain: null,
  itemizingYears: 0,
  aboveLineTotal: 0,
  belowLineTaken: 0,
  endingPortfolio: 0,
  ssFirstYear: null,
  lifetimeExpenses: 0,
  lifetimeSavings: 0,
  lifetimeDebtPayments: 0,
  giftsGiven: 0,
  firstToDie: null,
  employerMatch: false,
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
    goalCount: 0,
    salaryIncome: 180_000,
    annualSavings: 20_000,
    absorbsSurplus: true,
    bracketMode: false,
    hasMovableDeferral: true,
    stressItems: [],
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
    scenario: null,
    ...over,
  };
}

const NOTHING_MOVED: Record<MovedTest, boolean> = {
  convertsMore: false, portfolio: false, tax: false, stateTax: false, irmaa: false,
  estate: false, gains: false, deductions: false, socialSecurity: false,
};

function scenario(
  changes: Partial<Record<ChangeType, ChangeDetail>>,
  moved: Partial<Record<MovedTest, boolean>> = {},
  base: Partial<ProjectedFacts> = {},
): ScenarioFacts {
  return {
    id: "s1",
    name: "New Plan",
    changeCount: Object.values(changes).reduce((n, d) => n + d!.count, 0),
    changes,
    base: { ...NO_PROJECTION_SIGNALS, ...base },
    moved: { ...NOTHING_MOVED, ...moved },
  };
}

const CONVERTING: Partial<ProjectedFacts> = {
  rothConverted: 1_834_060, rothFirstYear: 2040, rothLastYear: 2054,
  conversionTopRate: 0.24, conversionEdgeYears: 9, conversionYears: 15,
  lifetimeTax: { total: 2_000_000, federal: 1_700_000, state: 300_000, capitalGains: 0 },
};

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
    const f = facts({ scenarios: [{ id: "s1", name: "Roth ladder", changeCount: 2, hasRothConversion: true }] });
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
    const f = facts({ scenarios: [{ id: "s1", name: "Empty", changeCount: 0, hasRothConversion: false }] });
    const found = ids(scoreReports(f));
    expect(found).not.toContain("retirementComparison");
    expect(found).not.toContain("scenarioChanges");
    expect(found).not.toContain("scenarioComparison");
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
        bracketMode: true,
        stressItems: ["a market drop"],
        willCount: 1,
        trusts: [{ id: "t1", name: "Trust" }],
        topDebt: { id: "l1", name: "Loan", balance: 10_000, interestRate: 0.07 },
        businesses: [{ id: "b1", name: "Acme LLC" }],
        proposals: [{ id: "p1", name: "Move to index" }],
        scenarios: [
          { id: "s1", name: "Roth ladder", changeCount: 2, hasRothConversion: true },
          { id: "s2", name: "Downsize", changeCount: 1, hasRothConversion: false },
        ],
      },
      { rothConverted: 50_000, rothFirstYear: 2027, rothLastYear: 2028, firstToDie: "spouse", estateTax: 1, depletionYear: 2050 },
    );
    const patched = scoreReports(f).filter((s) => s.optionsPatch);
    expect(ids(patched)).toEqual(
      expect.arrayContaining([
        "rothConversion", "taxComparison", "retirementComparison", "scenarioChanges",
        "scenarioComparison", "entityCashFlow", "investmentProposal", "earlyYearsDebtOrInvest",
        "incomeTaxBracketFederal", "earlyYearsTidbits", "estateSummary", "monteCarlo",
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

  it("names only fields each page's own options accept — scenario table", () => {
    const every: Partial<Record<ChangeType, ChangeDetail>> = {
      roth: { count: 1 }, retirementAge: { count: 1, who: "Alex", fromAge: 65, toAge: 62 }, planLength: { count: 1 },
      socialSecurity: { count: 1, fromAge: 67, toAge: 70 }, otherIncome: { count: 1 }, spending: { count: 1 },
      savings: { count: 1 }, relocation: { count: 1, name: "Move to Florida", year: 2030 },
      assetTransaction: { count: 1, year: 2030 }, gifts: { count: 1 }, estateDocs: { count: 1 },
      entities: { count: 1, id: "t1", name: "Family Trust" }, investments: { count: 1 },
      stress: { count: 1, ltc: true }, debts: { count: 1 }, insurance: { count: 1 }, taxSettings: { count: 1 },
      withdrawalOrder: { count: 1 }, accounts: { count: 1, transfer: true },
    };
    const allMoved = Object.fromEntries(Object.keys(NOTHING_MOVED).map((k) => [k, true])) as Record<MovedTest, boolean>;
    const f = facts(
      { planRef: "s1", bracketMode: true, yearsToRetirement: 3, stressItems: ["a market drop"], scenario: scenario(every, allMoved) },
      { ...CONVERTING, depletionYear: 2050, estateTax: 1_000_000, firstToDie: "spouse", ssFirstYear: 2036 },
    );
    const patched = scenarioMatches(f).filter((s) => s.optionsPatch);
    expect(patched.length).toBeGreaterThan(15);
    for (const s of patched) {
      const page = PRESENTATION_PAGES[s.pageId];
      const merged = { ...(page.defaultOptions as Record<string, unknown>), ...s.optionsPatch };
      const parsed = page.optionsSchema.safeParse(merged);
      expect(parsed.success, `${s.changeType}:${s.pageId}`).toBe(true);
      for (const key of Object.keys(s.optionsPatch!)) {
        expect((parsed.data as Record<string, unknown>)[key], `${s.pageId}.${key}`).toEqual(s.optionsPatch![key]);
      }
    }
  });
});

describe("plan rules — pages that had none, and pages that printed empty", () => {
  const converting = { rothConverted: 312_000, rothFirstYear: 2027, rothLastYear: 2031, conversionTopRate: 0.24, conversionEdgeYears: 4, conversionYears: 5 };

  it("suggests Tax Bracket for a plan that converts, pointed at the conversion years", () => {
    const b = scoreReports(facts({ bracketMode: true }, converting)).find((s) => s.pageId === "incomeTaxBracketFederal")!;
    expect(b.score).toBe(88);
    expect(b.reason).toBe("The conversions reach the 24% bracket, filling it to within $10k in 4 of 5 years — this shows the room left each year.");
    expect(b.optionsPatch).toEqual({ range: "rothConversionYears" });
  });

  it("never suggests a bracket page or Roth or Traditional on flat tax", () => {
    const f = facts(
      { bracketMode: false, youngestAge: 30, clientAge: 30, salaryIncome: 300_000, preTax: 2_000_000 },
      { ...converting, lifetimeTax: { total: 900_000, federal: 700_000, state: 200_000, capitalGains: 0 } },
    );
    const found = ids(scoreReports(f));
    expect(found).not.toContain("incomeTaxBracketFederal");
    expect(found).not.toContain("incomeTaxBracketState");
    expect(found).not.toContain("earlyYearsRoth");
  });

  it("never suggests the state pages where the state taxes no income", () => {
    const f = facts({ bracketMode: true }, { ...converting, lifetimeTax: { total: 400_000, federal: 400_000, state: 0, capitalGains: 0 } });
    const found = ids(scoreReports(f));
    expect(found).not.toContain("incomeTaxBracketState");
    expect(found).not.toContain("incomeTaxState");
  });

  it("gives every income-tax page a reason to exist", () => {
    const f = facts(
      { bracketMode: true },
      {
        ...converting,
        lifetimeTax: { total: 900_000, federal: 700_000, state: 150_000, capitalGains: 40_000 },
        amtOrNiitYears: 3,
        bigGain: { year: 2030, gain: 140_000 },
        itemizingYears: 4,
      },
    );
    const found = ids(scoreReports(f));
    for (const id of ["incomeTaxBracketState", "incomeTaxFederal", "incomeTaxState", "incomeTaxIncome", "incomeTaxBelowLine", "incomeTaxOtherTaxes"]) {
      expect(found, id).toContain(id);
    }
  });

  it("suggests Portfolio Growth and Portfolio Activity on the plan's own numbers", () => {
    const f = facts({ liquidPortfolio: 2_400_000, annualSavings: 20_000 }, { withdrawalFirstYear: 2038 });
    const all = scoreReports(f);
    expect(all.find((s) => s.pageId === "cashFlowGrowth")!.reason).toBe("What the $2.4M portfolio earns each year, by asset type.");
    expect(all.find((s) => s.pageId === "cashFlowActivity")!.reason).toBe("Shows the turn from adding to the portfolio to drawing on it, in 2038.");
  });

  it("gates the Early Years levers on a deferral they can move", () => {
    const young = { youngestAge: 30, clientAge: 30, bracketMode: true };
    expect(ids(scoreReports(facts({ ...young, hasMovableDeferral: false })))).not.toContain("earlyYearsLadder");
    expect(ids(scoreReports(facts({ ...young, hasMovableDeferral: false })))).not.toContain("earlyYearsWaiting");
    expect(ids(scoreReports(facts({ ...young, hasMovableDeferral: true })))).toContain("earlyYearsRoth");
  });

  it("adds Things Worth Knowing with notes picked from the plan, never empty", () => {
    const f = facts({ youngestAge: 30, clientAge: 30, roth: 0, topDebt: { id: "l1", name: "Loan", balance: 9_000, interestRate: 0.07 } });
    const t = scoreReports(f).find((s) => s.pageId === "earlyYearsTidbits")!;
    expect(t.optionsPatch).toEqual({ tidbits: ["debt-avalanche-snowball", "taxes-roth-vs-traditional"] });
    expect(t.reason).toBe("Short notes picked for this plan: paying down debt and Roth vs traditional.");
  });

  it("starts the estate pages with whoever dies first in the projection", () => {
    const f = facts({ willCount: 1, trusts: [{ id: "t", name: "Trust" }] }, { estateTax: 500_000, firstToDie: "spouse" });
    for (const id of ["estateSummary", "estateFlowChart", "estateFlow"] as const) {
      expect(scoreReports(f).find((s) => s.pageId === id)!.optionsPatch, id).toEqual({ ordering: "spouseFirst" });
    }
  });

  it("points Plan Story at the chosen scenario as its proposal", () => {
    const f = facts({ planRef: "s1", storyChapterCount: 3, scenario: { id: "s1", name: "New Plan", changeCount: 1, changes: { debts: { count: 1 } }, base: null, moved: {} as never } });
    expect(scoreReports(f).find((s) => s.pageId === "planStory")!.optionsPatch).toEqual({ scenarioId: "s1" });
  });

  it("names a stress test the plan runs under", () => {
    const a = scoreReports(facts({ stressItems: ["a market drop", "long-term care"] })).find((s) => s.pageId === "assumptions")!;
    expect(a.score).toBe(55);
    expect(a.reason).toBe("Spells out the stress test the plan runs under: a market drop and long-term care.");
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

describe("scenario cards", () => {
  it("brings up the Roth pages for a scenario that converts, ahead of every plan fact", () => {
    const f = facts(
      {
        planRef: "s1",
        bracketMode: true,
        giftCount: 1,
        proposals: [{ id: "p1", name: "Move to index" }],
        scenario: scenario({ roth: { count: 1 } }, { convertsMore: true, stateTax: true }),
      },
      { ...CONVERTING, lifetimeTax: { total: 2_020_000, federal: 1_700_000, state: 320_000, capitalGains: 0 } },
    );
    expect(ids(top(f))).toEqual(["rothConversion", "incomeTaxBracketFederal", "taxComparison", "incomeTaxBracketState"]);
    const [roth] = top(f);
    expect(roth.reason).toBe("“New Plan” converts $1.8M to Roth, 2040–2054 — what it costs now and saves later.");
    expect(roth.optionsPatch).toEqual({ scenarioId: "s1" });
  });

  it("brings up no Roth cards when the conversion is capped to nothing", () => {
    const f = facts({ planRef: "s1", bracketMode: true, scenario: scenario({ roth: { count: 1 } }, { convertsMore: false }) });
    const found = ids(scoreReports(f).filter((s) => s.changeType === "roth"));
    expect(found).toEqual([]);
  });

  it("keeps Tax Bracket in the top four of a scenario that changes many things (Cooper & Susan's New Plan)", () => {
    const f = facts(
      {
        planRef: "s1",
        bracketMode: true,
        scenario: scenario(
          {
            roth: { count: 1 },
            retirementAge: { count: 1, who: "Cooper", fromAge: 65, toAge: 67 },
            estateDocs: { count: 1 },
            spending: { count: 1 },
            savings: { count: 2 },
            investments: { count: 1 },
            assetTransaction: { count: 2, year: 2030 },
            accounts: { count: 2, transfer: true },
          },
          { convertsMore: true, portfolio: true, tax: true },
        ),
      },
      CONVERTING,
    );
    const picked = ids(top(f));
    expect(picked.slice(0, 3)).toEqual(["rothConversion", "retirementSummary", "incomeTaxBracketFederal"]);
    expect(picked).toHaveLength(4);
  });

  it("keeps Tax Bracket in the top four beside a Social Security claim and a move (Mike & Jane's Proposed Plan)", () => {
    const f = facts(
      {
        planRef: "s1",
        bracketMode: true,
        scenario: scenario(
          {
            socialSecurity: { count: 1, fromAge: 67, toAge: 70 },
            investments: { count: 1 },
            relocation: { count: 1, name: "Move to Florida", year: 2027 },
            roth: { count: 1 },
          },
          { convertsMore: true, stateTax: true, socialSecurity: true, portfolio: true },
          { lifetimeTax: { total: 2_400_000, federal: 1_700_000, state: 700_000, capitalGains: 0 } },
        ),
      },
      CONVERTING,
    );
    expect(ids(top(f))).toContain("incomeTaxBracketFederal");
    expect(ids(top(f))).toContain("rothConversion");
  });

  it("leads a retire-early scenario with Retirement Summary, then the verdict", () => {
    const f = facts(
      { planRef: "s1", scenario: scenario({ retirementAge: { count: 1, who: "Alex", fromAge: 65, toAge: 60 } }, { portfolio: true }) },
      { depletionYear: 2051 },
    );
    const [first, second] = top(f);
    expect(first.pageId).toBe("retirementSummary");
    expect(first.reason).toBe("“New Plan” moves Alex's retirement from 65 to 60 — what funds each year, and how long it lasts.");
    expect(second.pageId).toBe("retirementComparison");
    expect(second.reason).toBe("Retiring at 60 instead of 65: the portfolio now runs out in 2051 (Base Case: never).");
  });

  it("never brings up a bracket page from a scenario on flat tax", () => {
    const f = facts({ planRef: "s1", bracketMode: false, scenario: scenario({ roth: { count: 1 }, withdrawalOrder: { count: 1 } }, { convertsMore: true, tax: true }) }, CONVERTING);
    expect(ids(scoreReports(f))).not.toContain("incomeTaxBracketFederal");
    expect(ids(scoreReports(f))).not.toContain("incomeTaxBracketState");
  });

  it("points Business & Trusts only at a trust still in the plan", () => {
    const kept = facts({ planRef: "s1", scenario: scenario({ entities: { count: 1, id: "t1", name: "Family Trust" } }) });
    const removed = facts({ planRef: "s1", scenario: scenario({ entities: { count: 1, name: "Family Trust" } }) });
    expect(scoreReports(kept).find((s) => s.pageId === "entityCashFlow")?.optionsPatch).toEqual({ entityId: "t1", entityName: "Family Trust" });
    expect(scoreReports(removed).find((s) => s.pageId === "entityCashFlow")?.changeType).toBeUndefined();
    // The only trust is gone: Business & Trusts has nothing to print.
    expect(scoreReports(removed).find((s) => s.pageId === "entitiesBalanceSheet")?.changeType).toBeUndefined();
  });

  it("never names a removed trust, and keeps Entities only while another entity remains", () => {
    const removedOnly = facts({ planRef: "s1", scenario: scenario({ entities: { count: 1, name: "Family Trust" } }) });
    const reasons = (f: PlanFacts) =>
      Object.fromEntries(scenarioMatches(f).filter((s) => s.changeType === "entities").map((s) => [s.pageId, s.reason]));
    expect(reasons(removedOnly)).toMatchObject({
      estateFlowChart: "Shows what passes at each death without Family Trust.",
      estateSummary: "Who receives what without Family Trust.",
      mapNetWorth: "Who owns what without Family Trust.",
    });
    expect(reasons(removedOnly)).not.toHaveProperty("entitiesBalanceSheet");

    const otherRemains = facts({
      planRef: "s1",
      trusts: [{ id: "t2", name: "Kids Trust" } as PlanFacts["trusts"][number]],
      scenario: scenario({ entities: { count: 1, name: "Family Trust" } }),
    });
    expect(reasons(otherRemains).entitiesBalanceSheet).toBe("Assets, debts and net worth for each trust and business.");
  });

  it("prints no 'from 0' when the old age was blank", () => {
    const f = facts({ planRef: "s1", scenario: scenario({ retirementAge: { count: 1, who: "Susan", toAge: 62 }, socialSecurity: { count: 1, toAge: 70 } }, { socialSecurity: true }) });
    const text = scenarioMatches(f).map((s) => s.reason).join("\n");
    expect(text).toContain("moves Susan's retirement to 62");
    expect(text).toContain("Retiring at 62:");
    expect(text).toContain("moves Social Security to 70");
    expect(text).not.toMatch(/ 0 |undefined|NaN|instead of/);
  });

  it("brings up no Roth card for a chosen scenario whose conversion converts nothing", () => {
    const chosen = { id: "s1", name: "Proposed Plan", changeCount: 1, hasRothConversion: true };
    const f = facts({ planRef: "s1", scenarios: [chosen], scenario: scenario({ roth: { count: 1 } }, { convertsMore: false }) });
    expect(ids(scoreReports(f))).not.toContain("rothConversion");
    expect(ids(scoreReports(f))).not.toContain("taxComparison");
    const other = { id: "s2", name: "Ladder", changeCount: 1, hasRothConversion: true };
    const named = scoreReports({ ...f, scenarios: [chosen, other] }).find((s) => s.pageId === "rothConversion");
    expect(named?.reason).toContain("“Ladder” adds Roth conversions");
    expect(named?.optionsPatch).toEqual({ scenarioId: "s2" });
  });

  it("says a Roth scenario that lowers federal tax saved it, with nothing about conversion years", () => {
    const f = facts(
      { planRef: "s1", bracketMode: true, scenario: scenario({ roth: { count: 1 } }, { convertsMore: true }, CONVERTING) },
      { ...CONVERTING, lifetimeTax: { total: 1_940_000, federal: 1_640_000, state: 300_000, capitalGains: 0 } },
    );
    const federal = scenarioMatches(f).find((s) => s.pageId === "incomeTaxFederal");
    expect(federal?.reason).toBe("Federal tax line by line: down $60k against Base Case.");
  });

  it("gates the state-bracket, above-line and federal-tax cards on the figure they quote", () => {
    const quiet = (over: Partial<ProjectedFacts>, changes: Partial<Record<ChangeType, ChangeDetail>>, moved: Partial<Record<MovedTest, boolean>>) =>
      scenarioMatches(facts({ planRef: "s1", bracketMode: true, scenario: scenario(changes, moved) }, { ...NO_PROJECTION_SIGNALS, ...over })).map((s) => s.pageId);
    const lt = (federal: number, state = 0) => ({ total: federal + state, federal, state, capitalGains: 0 });
    // State bracket: state tax moved under $5k.
    expect(quiet({ rothConverted: 5_000, lifetimeTax: lt(0, 2_000) }, { roth: { count: 1 } }, { convertsMore: true, stateTax: false })).not.toContain("incomeTaxBracketState");
    expect(quiet({ rothConverted: 5_000, lifetimeTax: lt(0, 9_000) }, { roth: { count: 1 } }, { convertsMore: true, stateTax: true })).toContain("incomeTaxBracketState");
    // Above-line: only the below-line figure moved.
    expect(quiet({ belowLineTaken: 20_000 }, { savings: { count: 1 } }, { deductions: true })).not.toContain("incomeTaxAboveLine");
    expect(quiet({ aboveLineTotal: 20_000 }, { savings: { count: 1 } }, { deductions: true })).toContain("incomeTaxAboveLine");
    // Tax settings: total tax moved on state tax alone, federal barely.
    expect(quiet({ lifetimeTax: lt(1_000, 30_000) }, { taxSettings: { count: 1 } }, { tax: true })).not.toContain("incomeTaxFederal");
    expect(quiet({ lifetimeTax: lt(30_000) }, { taxSettings: { count: 1 } }, { tax: true })).toContain("incomeTaxFederal");
  });

  it("offers Plan Changes and Retirement Comparison for any scenario that changes something", () => {
    const f = facts({ planRef: "s1", scenario: scenario({ debts: { count: 1 } }) });
    const all = scoreReports(f);
    expect(all.find((s) => s.pageId === "scenarioChanges")).toMatchObject({ changeType: "anyChange", optionsPatch: { scenarioId: "s1" } });
    expect(all.find((s) => s.pageId === "retirementComparison")).toMatchObject({ changeType: "anyChange", optionsPatch: { scenarioId: "s1" } });
  });

  it("says \"its changes\" where the sentence already names the scenario", () => {
    const f = facts(
      {
        planRef: "s1",
        scenario: {
          ...scenario({ investments: { count: 2 }, roth: { count: 1 } }, { portfolio: true }, { endingPortfolio: 1_000_000 }),
          changeCount: 4,
        },
      },
      { ...CONVERTING, endingPortfolio: 5_800_000 },
    );
    const reason = (id: string) => scoreReports(f).find((s) => s.pageId === id)?.reason;
    expect(reason("cashFlowGrowth")).toBe(
      "“New Plan” changes how the portfolio grows: with all 4 of its changes, ending portfolio up $4.8M against Base Case.",
    );
    expect(reason("retirementComparison")).toBe(
      "Does “New Plan” beat Base Case? With all 4 of its changes, ending portfolio up $4.8M against Base Case.",
    );

    const spend = facts(
      { planRef: "s1", scenario: { ...scenario({ spending: { count: 2 }, roth: { count: 1 } }, { portfolio: true }, { endingPortfolio: 1_000_000 }), changeCount: 3 } },
      { ...CONVERTING, endingPortfolio: 5_800_000 },
    );
    expect(scoreReports(spend).find((s) => s.pageId === "retirementComparison")?.reason).toBe(
      "Can the plan afford “New Plan”? With all 3 of its changes, ending portfolio up $4.8M against Base Case.",
    );
  });

  it("names the whole scenario, not one change, when it changes several things", () => {
    const f = facts(
      {
        planRef: "s1",
        bracketMode: true,
        scenario: scenario(
          {
            retirementAge: { count: 1, who: "Cooper", fromAge: 65, toAge: 67 },
            roth: { count: 1 },
            relocation: { count: 1, name: "Move to Florida", year: 2027 },
          },
          { convertsMore: true, portfolio: true, stateTax: true },
          { lifetimeTax: { total: 2_000_000, federal: 1_700_000, state: 600_000, capitalGains: 0 }, endingPortfolio: 1_000_000 },
        ),
      },
      { ...CONVERTING, lifetimeTax: { total: 1_600_000, federal: 1_200_000, state: 200_000, capitalGains: 0 }, endingPortfolio: 18_500_000 },
    );
    const all = scoreReports(f);
    const reason = (id: string) => all.find((s) => s.pageId === id)?.reason;
    expect(reason("retirementComparison")).toBe(
      "Retiring at 67 instead of 65: with all 3 changes in “New Plan”, ending portfolio up $17.5M against Base Case.",
    );
    expect(reason("incomeTaxBracketState")).toBe(
      "With all 3 changes in “New Plan”, state tax down $400k — this shows each year's state bracket.",
    );
  });

  it("brings up no scenario cards when no change type survived, even with a change count", () => {
    const f = facts({ planRef: "s1", scenario: { ...scenario({}, { portfolio: true }), changeCount: 3 } });
    expect(scoreReports(f).some((s) => s.changeType)).toBe(false);
  });

  it("skips the scenario tier when Base Case couldn't be projected", () => {
    const f = facts({ planRef: "s1", scenario: { ...scenario({ roth: { count: 1 } }, { convertsMore: true }), base: null } }, CONVERTING);
    expect(scoreReports(f).some((s) => s.changeType)).toBe(false);
  });
});

describe("missingEssentials", () => {
  const s = (pageId: PresentationPageId, score: number, optionsPatch?: Record<string, unknown>): ReportSuggestion =>
    ({ pageId, score, reason: `${pageId} reason`, optionsPatch });
  const ALL = [
    s("balanceSheet", 40), s("clientProfile", 30), s("retirementSummary", 22),
    s("taxComparison", 92, { scenarioId: "s1" }), s("retirementComparison", 64, { scenarioId: "s1" }),
  ];

  it("lists the three essentials a deck is missing, in order", () => {
    expect(ids(missingEssentials(ALL, [], "base", new Set()))).toEqual(["balanceSheet", "clientProfile", "retirementSummary"]);
  });

  it("skips one already in the deck or already on a card", () => {
    const deck = [{ pageId: "balanceSheet" as const, options: {} }];
    expect(ids(missingEssentials(ALL, deck, "base", new Set(["retirementSummary"])))).toEqual(["clientProfile"]);
  });

  it("adds the comparison that fits the chosen scenario best", () => {
    expect(ids(missingEssentials(ALL, [], "s1", new Set())).at(-1)).toBe("taxComparison");
  });

  it("counts a comparison page as present only when it points at this scenario", () => {
    const pointedElsewhere = [{ pageId: "retirementComparison" as const, options: { scenarioId: "s2" } }];
    const pointedHere = [{ pageId: "scenarioComparison" as const, options: { scenarioIds: ["s3", "s1"] } }];
    expect(ids(missingEssentials(ALL, pointedElsewhere, "s1", new Set()))).toContain("taxComparison");
    expect(ids(missingEssentials(ALL, pointedHere, "s1", new Set()))).not.toContain("taxComparison");
  });

  it("does not repeat a comparison that is already a card", () => {
    expect(ids(missingEssentials(ALL, [], "s1", new Set(["taxComparison"])))).not.toContain("taxComparison");
  });

  it("offers no comparison for a snapshot", () => {
    expect(ids(missingEssentials(ALL, [], "snap:x", new Set()))).toEqual(["balanceSheet", "clientProfile", "retirementSummary"]);
  });
});
