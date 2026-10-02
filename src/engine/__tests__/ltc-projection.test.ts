import { describe, it, expect } from "vitest";
import { runProjection, runProjectionWithEvents } from "../projection";
import { ltcCareExpenseId, ltcHomeSaleId } from "../ltc-event";
import { runMonteCarlo } from "../monteCarlo/run";
import { createReturnEngine } from "../monteCarlo/returns";
import type { MixSegment } from "../monteCarlo/trial";
import { LEGACY_FM_CLIENT } from "../ownership";
import {
  buildClientData,
  baseClient,
  basePlanSettings,
  sampleAccounts,
  sampleLiabilities,
} from "./fixtures";
import type { Account, AssetTransaction, ClientData, LtcEvent } from "../types";

const ID = "3f1c2d7e-8a1b-4c5d-9e0f-112233445566";
const john85for3 = {
  person: "client" as const,
  startAge: 85,
  years: 3,
  careSetting: "nursing_private" as const,
  annualCost: 129_575,
  costInflation: 0.05,
};

function withEvent(event: Partial<LtcEvent>, over: Partial<ClientData> = {}): ClientData {
  return buildClientData({
    client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 95 },
    planSettings: { ...basePlanSettings, planEndYear: 2067 },
    ltcEvents: [
      { id: ID, name: "LTC", people: [john85for3], livingExpenseCutPct: null, homeSale: null, includePolicies: true, ...event },
    ],
    ...over,
  });
}

/** A household default checking account, so sale proceeds and Monte Carlo
 *  liquid balances have somewhere to land. */
const checking: Account = {
  id: "acct-checking",
  name: "Joint Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 10_000,
  basis: 10_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const proceeds = (data: ClientData, year: number, txId: string): number =>
  runProjection(data).find((p) => p.year === year)!.income.bySource?.[`technique-proceeds:${txId}`] ?? 0;

describe("LTC event through runProjection", () => {
  it("bills the care cost only in care years", () => {
    const years = runProjection(withEvent({}));
    const key = ltcCareExpenseId(ID, "client");
    expect(years.find((y) => y.year === 2054)!.expenses.bySource[key]).toBeUndefined();
    // Billed once: a second pass of the pre-pass would add a same-id row and
    // this year would read 2× the cost.
    expect(years.find((y) => y.year === 2055)!.expenses.bySource[key]).toBeCloseTo(129_575 * 1.05 ** 29, 2);
    expect(years.find((y) => y.year === 2058)!.expenses.bySource[key]).toBeUndefined();
  });

  it("the person in care dies in the last care year; the spouse lives on", () => {
    const years = runProjection(withEvent({}));
    const deathYear = years.find((y) => (y.deathTransfers ?? []).some((t) => t.deathOrder === 1));
    expect(deathYear?.year).toBe(2057);
    expect(years[years.length - 1].year).toBe(2067); // Jane, 1972 + 95
  });

  it("both in care: the projection ends at the later care end", () => {
    const years = runProjection(
      withEvent({ people: [john85for3, { ...john85for3, person: "spouse", startAge: 86, years: 2 }] }),
    );
    expect(years[years.length - 1].year).toBe(2059); // Jane 1972 + 86 + 2 − 1
  });

  it("with no event, the projection is identical to a plan without the field", () => {
    const base = buildClientData();
    const withEmpty = buildClientData({ ltcEvents: [] });
    expect(JSON.stringify(runProjection(withEmpty))).toBe(JSON.stringify(runProjection(base)));
  });

  it("the home sale pays off both linked loans; the sale-year BoY value is pre-sale", () => {
    const loans = [
      { ...sampleLiabilities[0], linkedPropertyId: "acct-home" },
      { ...sampleLiabilities[0], id: "liab-heloc", name: "HELOC", balance: 50_000, linkedPropertyId: "acct-home" },
    ];
    const sale = { accountId: "acct-home", saleYear: 2030, price: { mode: "projected" as const }, sellingCostPct: 0.06 };
    const noSale = runProjection(withEvent({}, { liabilities: loans }));
    const sold = runProjection(withEvent({ homeSale: sale }, { liabilities: loans }));
    const y = sold.find((p) => p.year === 2030)!;
    // The preview (Task 12) reads these — they must be the pre-sale figures.
    expect(y.accountLedgers["acct-home"].beginningValue).toBeCloseTo(
      noSale.find((p) => p.year === 2030)!.accountLedgers["acct-home"].beginningValue,
      2,
    );
    const next = sold.find((p) => p.year === 2031)!;
    expect(next.liabilityBalancesBoY["liab-mortgage"]).toBeUndefined();
    expect(next.liabilityBalancesBoY["liab-heloc"]).toBeUndefined();
    expect(next.accountLedgers["acct-home"]).toBeUndefined();
  });

  it("a later Techniques sale of the same home finds nothing to sell — no double proceeds", () => {
    const sale = { accountId: "acct-home", saleYear: 2030, price: { mode: "projected" as const }, sellingCostPct: 0.06 };
    const later = { id: "t-later", name: "Sell home", type: "sell" as const, year: 2035, accountId: "acct-home" };
    // Positive control: alone, the Techniques sale produces proceeds under this key.
    expect(proceeds(withEvent({}, { assetTransactions: [later] }), 2035, later.id)).toBeGreaterThan(0);
    const years = runProjection(withEvent({ homeSale: sale }, { assetTransactions: [later] }));
    const y2035 = years.find((p) => p.year === 2035)!;
    expect(y2035.income.bySource?.[`technique-proceeds:${later.id}`] ?? 0).toBe(0);
    expect(years.find((p) => p.year === 2030)!.income.bySource?.[`technique-proceeds:${ltcHomeSaleId(ID)}`]).toBeGreaterThan(0);
  });
});

// The pre-pass runs inside runProjection, so runProjectionWithEvents' own
// reads of `data` see the RAW horizon. Its gift ledger must still cover every
// year the projection ran.
describe("LTC event through runProjectionWithEvents", () => {
  it("care past planEndYear extends the gift ledger with the projection", () => {
    const data = buildClientData({
      client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 80 },
      planSettings: { ...basePlanSettings, planEndYear: 2055 },
      ltcEvents: [
        { id: ID, name: "LTC", people: [john85for3], livingExpenseCutPct: null, homeSale: null, includePolicies: true },
      ],
    });
    const result = runProjectionWithEvents(data);
    expect(result.years[result.years.length - 1].year).toBe(2057);
    expect(result.giftLedger.map((g) => g.year)).toEqual(result.years.map((y) => y.year));
  });

  it("a gift in a care-extended year gets its annual exclusion", () => {
    // 2056 is past the raw planEndYear (2055) but inside John's care (2055–2057).
    const data = buildClientData({
      client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 80 },
      planSettings: { ...basePlanSettings, planEndYear: 2055 },
      gifts: [{ id: "g-2056", year: 2056, amount: 19_000, grantor: "client", useCrummeyPowers: false }],
      ltcEvents: [
        { id: ID, name: "LTC", people: [john85for3], livingExpenseCutPct: null, homeSale: null, includePolicies: true },
      ],
    });
    const y2056 = runProjectionWithEvents(data).giftLedger.find((g) => g.year === 2056)!;
    expect(y2056.giftsGiven).toBe(19_000);
    expect(y2056.perGrantor.client.taxableGiftsThisYear).toBe(0); // 19,000 fully excluded
  });

  it("without an event the gift ledger still runs to planEndYear, past a final death", () => {
    // Both die by 2052 (John 1970+80, Jane 1972+80); the projection stops there.
    const data = buildClientData({ client: { ...baseClient, lifeExpectancy: 80, spouseLifeExpectancy: 80 } });
    const result = runProjectionWithEvents(data);
    expect(result.years[result.years.length - 1].year).toBeLessThan(basePlanSettings.planEndYear);
    expect(result.giftLedger[result.giftLedger.length - 1].year).toBe(basePlanSettings.planEndYear);
  });
});

// R12 — the Techniques sale and the LTC sale fall in the SAME year. The
// Techniques sale sells; the LTC sale is dropped with a home_already_sold
// warning (I6): no second proceeds, no second loan payoff, no crash. The
// engine-level guard for a second same-year sale is pinned in
// asset-transactions.test.ts.
describe("LTC home sale in the same year as a Techniques sale of that home", () => {
  const mortgage = { ...sampleLiabilities[0], linkedPropertyId: "acct-home" };
  const techniques: AssetTransaction = { id: "t-same", name: "Sell home", type: "sell", year: 2030, accountId: "acct-home" };
  const over = { accounts: [...sampleAccounts, checking], liabilities: [mortgage], assetTransactions: [techniques] };
  const saleDebitsAndCredits = (data: ClientData) =>
    runProjection(data)
      .find((p) => p.year === 2030)!
      .accountLedgers["acct-checking"].entries.filter((e) => e.label.startsWith("Sale proceeds:"));

  it.each([
    ["projected price", { mode: "projected" as const }],
    ["custom price", { mode: "custom" as const, amount: 900_000 }],
  ])("exactly one of the two sales produces proceeds (%s)", (_label, price) => {
    const sale = { accountId: "acct-home", saleYear: 2030, price, sellingCostPct: 0.06 };
    // Positive control: alone, the LTC sale produces proceeds under its key.
    expect(proceeds(withEvent({ homeSale: sale }, { ...over, assetTransactions: [] }), 2030, ltcHomeSaleId(ID))).toBeGreaterThan(0);

    const both = withEvent({ homeSale: sale }, over);
    const techOnly = withEvent({}, over);
    expect(proceeds(both, 2030, techniques.id)).toBeGreaterThan(0);
    expect(proceeds(both, 2030, ltcHomeSaleId(ID))).toBe(0);
    // The cash that reached checking is the Techniques sale's alone — the
    // second sale neither deposits phantom proceeds nor pays the mortgage twice.
    expect(saleDebitsAndCredits(both)).toEqual(saleDebitsAndCredits(techOnly));
    const y2031 = runProjection(both).find((p) => p.year === 2031)!;
    expect(y2031.accountLedgers["acct-home"]).toBeUndefined();
    expect(y2031.liabilityBalancesBoY["liab-mortgage"]).toBeUndefined();
  });
});

// R7 — Monte Carlo runs runProjection once per trial on one input.
describe("LTC event through runMonteCarlo", () => {
  const INDICES = [
    { id: "eq", arithMean: 0.08, stdDev: 0.15 },
    { id: "bd", arithMean: 0.04, stdDev: 0.05 },
  ];
  const CORR = [
    [1, 0.1],
    [0.1, 1],
  ];
  const engine = (seed: number) => createReturnEngine({ indices: INDICES, correlation: CORR, seed });
  const mixForAll = (data: ClientData): Map<string, MixSegment[]> =>
    new Map(
      data.accounts
        .filter((a) => a.category === "taxable" || a.category === "retirement" || a.category === "cash")
        .map((a) => [a.id, [{ fromYear: 0, mix: [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bd", weight: 0.4 }] }]]),
    );
  const run = (data: ClientData) =>
    runMonteCarlo({ data, returnEngine: engine(7), accountMixes: mixForAll(data), trials: 5, yieldEvery: 5 });

  it("the same plan with a care event ends with less liquid wealth, trial by trial (same seed)", async () => {
    const accounts = [...sampleAccounts, checking];
    const plain = withEvent({}, { accounts, ltcEvents: [] });
    const cared = withEvent({}, { accounts });
    const a = await run(plain);
    const b = await run(cared);
    expect(b.byYearLiquidAssetsPerTrial[0].length).toBe(a.byYearLiquidAssetsPerTrial[0].length);
    for (let t = 0; t < 5; t++) {
      expect(b.endingLiquidAssets[t]).toBeLessThan(a.endingLiquidAssets[t]);
    }
  });

  it("care running past planEndYear extends every trial's year arrays consistently", async () => {
    // Jane dies 2052 and John's care runs 2055–2057, so the horizon moves from
    // 2055 to 2057 inside runProjection only.
    const data = buildClientData({
      accounts: [...sampleAccounts, checking],
      client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 80 },
      planSettings: { ...basePlanSettings, planEndYear: 2055 },
      ltcEvents: [
        { id: ID, name: "LTC", people: [john85for3], livingExpenseCutPct: null, homeSale: null, includePolicies: true },
      ],
    });
    const deterministic = runProjection(data);
    expect(deterministic[deterministic.length - 1].year).toBe(2057);

    const result = await run(data);
    expect(result.trialsRun).toBe(5);
    for (let t = 0; t < 5; t++) {
      const series = result.byYearLiquidAssetsPerTrial[t];
      expect(series.length).toBe(deterministic.length); // 2026..2057
      expect(result.endingLiquidAssets[t]).toBe(series[series.length - 1]);
    }
  });
});
