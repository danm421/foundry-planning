import { describe, it, expect } from "vitest";
import {
  applyLtcEvent,
  resolveLtcEvent,
  ltcCareExpenseId,
  ltcHomeSaleId,
  medicalDeductibleForYear,
} from "../ltc-event";
import { computeExpenses } from "../expenses";
import { buildClientData, baseClient, basePlanSettings, sampleAccounts, sampleExpenses } from "./fixtures";
import type { ClientData, LtcEvent, LtcCarePerson } from "../types";

const EVENT_ID = "3f1c2d7e-8a1b-4c5d-9e0f-112233445566";

// John born 1970, Jane born 1972. Plan 2026–2067 so both reach 95.
function plan(event: Partial<LtcEvent> = {}, over: Partial<ClientData> = {}): ClientData {
  const care: LtcCarePerson = {
    person: "client",
    startAge: 85,
    years: 3,
    careSetting: "nursing_private",
    annualCost: 129_575,
    costInflation: 0.05,
  };
  return buildClientData({
    client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 95 },
    planSettings: { ...basePlanSettings, planEndYear: 2067 },
    ltcEvents: [
      {
        id: EVENT_ID,
        name: "LTC",
        people: [care],
        livingExpenseCutPct: null,
        homeSale: null,
        includePolicies: true,
        ...event,
      },
    ],
    ...over,
  });
}

describe("resolveLtcEvent", () => {
  it("returns null with no event", () => {
    expect(resolveLtcEvent(buildClientData())).toBeNull();
  });

  it("resolves care years from the birth year: 85 for 3 years = 2055–2057", () => {
    const r = resolveLtcEvent(plan())!;
    expect(r.people[0]).toMatchObject({ startYear: 2055, endYear: 2057 });
    expect(r.careRanges).toEqual([{ startYear: 2055, endYear: 2057 }]);
  });

  it("skips a person whose start year is before the plan, with a warning", () => {
    const d = plan({ people: [{ ...plan().ltcEvents![0].people[0], startAge: 50 }] });
    const r = resolveLtcEvent(d)!;
    expect(r.people).toEqual([]);
    expect(r.warnings).toContainEqual({ kind: "start_before_plan", person: "client", startYear: 2020 });
    // Nothing is silently applied: the plan comes back untouched.
    expect(applyLtcEvent(d).data).toBe(d);
  });

  it("skips a spouse with no date of birth, with a warning", () => {
    const noDob = plan(
      { people: [{ ...plan().ltcEvents![0].people[0], person: "spouse" }] },
      { client: { ...baseClient, spouseDob: undefined, lifeExpectancy: 95 } },
    );
    const r = resolveLtcEvent(noDob)!;
    expect(r.people).toEqual([]);
    expect(r.warnings).toContainEqual({ kind: "missing_dob", person: "spouse" });
  });

  it("merges overlapping care years of two people into one range", () => {
    const both = plan({
      people: [
        { ...plan().ltcEvents![0].people[0] }, // John 2055–2057
        { ...plan().ltcEvents![0].people[0], person: "spouse", startAge: 84, years: 3 }, // Jane 2056–2058
      ],
    });
    expect(resolveLtcEvent(both)!.careRanges).toEqual([{ startYear: 2055, endYear: 2058 }]);
  });

  it("skips a home sale when the plan already fully sells that home earlier", () => {
    const d = plan(
      { homeSale: { accountId: "acct-home", saleYear: 2055, price: { mode: "projected" }, sellingCostPct: 0.06 } },
      { assetTransactions: [{ id: "t1", name: "Sell home", type: "sell", year: 2040, accountId: "acct-home" }] },
    );
    const r = resolveLtcEvent(d)!;
    expect(r.homeSale).toBeNull();
    expect(r.warnings).toContainEqual({ kind: "home_already_sold", accountId: "acct-home", soldYear: 2040 });
    // The care still applies; only the second sale is dropped.
    const applied = applyLtcEvent(d).data;
    expect(applied.assetTransactions!.map((t) => t.id)).toEqual(["t1"]);
  });

  it("skips a home sale when a Techniques sale of that home falls in the SAME year", () => {
    const d = plan(
      { homeSale: { accountId: "acct-home", saleYear: 2055, price: { mode: "projected" }, sellingCostPct: 0.06 } },
      { assetTransactions: [{ id: "t1", name: "Sell home", type: "sell", year: 2055, accountId: "acct-home" }] },
    );
    const r = resolveLtcEvent(d)!;
    expect(r.homeSale).toBeNull();
    expect(r.warnings).toContainEqual({ kind: "home_already_sold", accountId: "acct-home", soldYear: 2055 });
    expect(applyLtcEvent(d).data.assetTransactions!.map((t) => t.id)).toEqual(["t1"]);
  });

  it("warns when the home account is gone", () => {
    const r = resolveLtcEvent(
      plan({ homeSale: { accountId: "nope", saleYear: 2055, price: { mode: "projected" }, sellingCostPct: 0.06 } }),
    )!;
    expect(r.homeSale).toBeNull();
    expect(r.warnings).toContainEqual({ kind: "home_missing", accountId: "nope" });
  });
});

describe("applyLtcEvent", () => {
  it("is a no-op with no event (same object back)", () => {
    const d = buildClientData();
    expect(applyLtcEvent(d).data).toBe(d);
  });

  it("is pure — the input is unchanged after two runs", () => {
    const d = plan({ livingExpenseCutPct: 1 });
    const before = JSON.stringify(d);
    applyLtcEvent(d);
    applyLtcEvent(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("sets life expectancy so death falls in the last care year", () => {
    const { data } = applyLtcEvent(plan());
    expect(data.client.lifeExpectancy).toBe(87); // 1970 + 87 = 2057
    expect(data.client.spouseLifeExpectancy).toBe(95);
  });

  it("fills a missing client life expectancy with 95 so a spouse-only event still has a first death", () => {
    const d = plan(
      { people: [{ ...plan().ltcEvents![0].people[0], person: "spouse", startAge: 85 }] },
      { client: { ...baseClient, spouseLifeExpectancy: 95 } }, // client LE undefined
    );
    const { data } = applyLtcEvent(d);
    expect(data.client.lifeExpectancy).toBe(95);
    expect(data.client.spouseLifeExpectancy).toBe(87);
  });

  it("extends planEndYear when care runs past it", () => {
    const d = plan({ people: [{ ...plan().ltcEvents![0].people[0], startAge: 98, years: 4 }] });
    const { data } = applyLtcEvent(d);
    expect(data.client.lifeExpectancy).toBe(101); // dies 2071
    expect(data.planSettings.planEndYear).toBe(2071);
  });

  it("adds one care-cost row per person, in today's dollars grown at care inflation", () => {
    const { data } = applyLtcEvent(plan());
    const row = data.expenses.find((e) => e.id === ltcCareExpenseId(EVENT_ID, "client"))!;
    expect(row).toMatchObject({
      type: "other",
      name: "Long-term care — John",
      annualAmount: 129_575,
      startYear: 2055,
      endYear: 2057,
      growthRate: 0.05,
      inflationStartYear: 2026,
    });
    expect(row.medicalDeductibleByYear![2055]).toBeCloseTo(129_575 * 1.05 ** 29, 4);
    expect(row.medicalDeductibleByYear![2058]).toBeUndefined();
  });

  it("cuts household living rows in care years only — once, even when two people overlap", () => {
    const both = plan({
      livingExpenseCutPct: 1,
      people: [
        { ...plan().ltcEvents![0].people[0] },
        { ...plan().ltcEvents![0].people[0], person: "spouse", startAge: 84, years: 3 },
      ],
    });
    const living = applyLtcEvent(both).data.expenses.find((e) => e.id === sampleExpenses[0].id)!;
    expect(living.scaleWindows).toEqual([{ startYear: 2055, endYear: 2058, factor: 0 }]);
    const insurance = applyLtcEvent(both).data.expenses.find((e) => e.type === "insurance")!;
    expect(insurance.scaleWindows).toBeUndefined();
  });

  it("a partial cut is applied once in a year both people are in care — not compounded", () => {
    // The fixture's living row ends 2055; run it through the care years.
    const both = plan(
      {
        livingExpenseCutPct: 0.6,
        people: [
          { ...plan().ltcEvents![0].people[0] }, // John 2055–2057
          { ...plan().ltcEvents![0].people[0], person: "spouse", startAge: 84, years: 3 }, // Jane 2056–2058
        ],
      },
      { expenses: [{ ...sampleExpenses[0], endYear: 2067 }] },
    );
    const { data } = applyLtcEvent(both);
    const living = (year: number) => computeExpenses(data.expenses, year, data.client).living;
    const base = (year: number) => 80_000 * 1.03 ** (year - 2026);
    // 2056 is a care year for both: × 0.4, not × 0.4 × 0.4 = × 0.16.
    expect(living(2056)).toBeCloseTo(base(2056) * 0.4, 4);
    // 2059 is the first year after all care ends: full again.
    expect(living(2059)).toBeCloseTo(base(2059), 4);
  });

  it("does not cut an entity-owned living row", () => {
    const d = plan(
      { livingExpenseCutPct: 0.5 },
      { expenses: [{ ...sampleExpenses[0], id: "ent-living", ownerEntityId: "trust-1" }] },
    );
    const row = applyLtcEvent(d).data.expenses.find((e) => e.id === "ent-living")!;
    expect(row.scaleWindows).toBeUndefined();
  });

  it("appends one full home sale with the event's price and costs", () => {
    const { data } = applyLtcEvent(
      plan({
        homeSale: { accountId: "acct-home", saleYear: 2055, price: { mode: "custom", amount: 1_200_000 }, sellingCostPct: 0.06 },
      }),
    );
    const sale = data.assetTransactions!.find((t) => t.id === ltcHomeSaleId(EVENT_ID))!;
    expect(sale).toMatchObject({
      type: "sell",
      year: 2055,
      accountId: "acct-home",
      overrideSaleValue: 1_200_000,
      transactionCostPct: 0.06,
      qualifiesForHomeSaleExclusion: true,
      fractionSold: null,
    });
  });

  it("claims the §121 exclusion only for a primary residence — never for a rental", () => {
    const rental = { ...sampleAccounts.find((a) => a.id === "acct-home")!, id: "acct-rental", subType: "rental_property" };
    const sold = (accountId: string) =>
      applyLtcEvent(
        plan(
          { homeSale: { accountId, saleYear: 2055, price: { mode: "projected" }, sellingCostPct: 0.06 } },
          { accounts: [...sampleAccounts, rental] },
        ),
      ).data.assetTransactions!.find((t) => t.id === ltcHomeSaleId(EVENT_ID))!;
    expect(sold("acct-home").qualifiesForHomeSaleExclusion).toBe(true);
    expect(sold("acct-rental").qualifiesForHomeSaleExclusion).toBe(false);
  });

  it("a projected-price sale leaves overrideSaleValue undefined", () => {
    const { data } = applyLtcEvent(
      plan({ homeSale: { accountId: "acct-home", saleYear: 2055, price: { mode: "projected" }, sellingCostPct: 0.06 } }),
    );
    expect(data.assetTransactions!.find((t) => t.id === ltcHomeSaleId(EVENT_ID))!.overrideSaleValue).toBeUndefined();
  });
});

describe("medicalDeductibleForYear", () => {
  it("sums only rows that carry the map", () => {
    const { data } = applyLtcEvent(plan());
    expect(medicalDeductibleForYear(data.expenses, 2056)).toBeCloseTo(129_575 * 1.05 ** 30, 4);
    expect(medicalDeductibleForYear(data.expenses, 2040)).toBe(0);
  });
});
