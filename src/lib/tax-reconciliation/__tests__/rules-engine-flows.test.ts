import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { engineFlowRules } from "../rules/engine-flows";
import { CLIENT_ID, engineYearFixture, inputFixture, planFixture } from "./fixtures";
import type { EngineYear } from "../types";

// Typed, not `Record<string, unknown>`: an untyped bag silently swallows a misspelled override, so
// a test could think it was pinning `rmdAmount` or `growthDetail` while the ledger kept its zero.
type Ledger = EngineYear["accountLedgers"][string];
type Growth = NonNullable<Ledger["growthDetail"]>;
const ledger = (over: Partial<Ledger> = {}): Ledger =>
  ({ beginningValue: 0, growth: 0, contributions: 0, distributions: 0, internalContributions: 0, internalDistributions: 0, rmdAmount: 0, fees: 0, endingValue: 0, entries: [], ...over });
const growth = (over: Partial<Growth> = {}): Growth =>
  ({ ordinaryIncome: 0, qualifiedDividends: 0, stCapitalGains: 0, ltCapitalGains: 0, taxExempt: 0, basisIncrease: 0, ...over });

const plan = () => planFixture({ accounts: [
  { id: "ira", name: "Rollover IRA", category: "retirement", subType: "traditional_ira" },
  { id: "brk", name: "Brokerage", category: "taxable", subType: "brokerage" },
  { id: "chk", name: "Checking", category: "cash", subType: "checking" },
] });
const planWithAnnuity = () => planFixture({ accounts: [...plan().accounts,
  { id: "ann", name: "Qualified annuity", category: "annuity", subType: "qualified" }] });
const taxDetail = (over: Partial<NonNullable<EngineYear["taxDetail"]>>) =>
  ({ ...engineYearFixture().taxDetail!, ...over });

describe("engineFlowRules — all skipped without an engine year", () => {
  it("returns nothing", () => {
    const f = emptyTaxReturnFacts(2025); f.income.iraDistributionsGross = 41_000; f.income.capitalGainOrLoss = 60_000;
    expect(engineFlowRules(inputFixture({ facts: f, plan: plan() }))).toEqual({ suggestions: [], checks: [] });
  });
});

describe("engineFlowRules — IRA distributions (4a > $1,000; plan < 50%)", () => {
  it("reviews toward Techniques when the plan draws less than half, counting RMDs and retirement/annuity withdrawals", () => {
    const f = emptyTaxReturnFacts(2025); f.income.iraDistributionsGross = 41_000;
    const engineYear = engineYearFixture({ withdrawals: { byAccount: { ira: 5_150, brk: 20_000 }, total: 25_150 }, accountLedgers: { ira: ledger({ rmdAmount: 5_150 }) } });
    const r = engineFlowRules(inputFixture({ facts: f, plan: plan(), engineYear }));
    const s = r.suggestions.find((x) => x.id === "income.iraDistributions")!;
    expect(s.kind).toBe("review");
    expect(s.section).toBe("income");
    expect(s.planFigure.amount).toBeCloseTo(10_000, 0);       // (5,150 + 5,150) / 1.03; the brokerage draw is not an IRA distribution
    expect(s.link?.href).toMatch(/techniques$/);
    expect(s.meaning).toMatch(/living expenses are understated/);
    // The pair is what the card shows, so a swapped field has to redden here.
    expect(s.returnFigure).toMatchObject({ label: "IRA distributions", amount: 41_000, display: "$41,000" });
    expect(s.returnFigure.lineRefs).toEqual([{ form: "1040", line: "4a", label: "IRA distributions", amount: 41_000 }]);
    expect(s.planFigure).toMatchObject({ label: "Retirement withdrawals + RMDs in the plan", display: "$10,000", year: 2026 });
    expect(s.delta).toMatchObject({ display: "Plan is $31,000 short", tone: "short" });
    // Ordered, so exchanging the two interpolations reddens while the prose stays free.
    expect(s.headline).toMatch(/\$41,000[\s\S]*2025[\s\S]*\$10,000[\s\S]*2026/);
    // Engine-level: there is no single plan row to write, so this arm only links out.
    expect(s.action).toBeUndefined();
    expect(s.link?.href).toBe(`/clients/${CLIENT_ID}/details/techniques`);
    expect(r.checks).toEqual([]);
  });

  it("counts an annuity draw but only a retirement account's RMD", () => {
    const f = emptyTaxReturnFacts(2025); f.income.iraDistributionsGross = 41_000;
    // The category filters are what decide WHICH accounts stand behind the plan figure. Drop the
    // annuity arm and this falls to $5,000; count RMDs on taxable or cash accounts and it jumps to
    // $68,252 — either way the $10,000 below reddens.
    const engineYear = engineYearFixture({
      withdrawals: { byAccount: { ann: 5_150, brk: 20_000 }, total: 25_150 },
      accountLedgers: { ira: ledger({ rmdAmount: 5_150 }), brk: ledger({ rmdAmount: 20_000 }), chk: ledger({ rmdAmount: 40_000 }) },
    });
    const s = engineFlowRules(inputFixture({ facts: f, plan: planWithAnnuity(), engineYear })).suggestions.find((x) => x.id === "income.iraDistributions")!;
    expect(s.planFigure.amount).toBeCloseTo(10_000, 0);       // (5,150 annuity draw + 5,150 IRA RMD) / 1.03
  });

  it("checks when the plan draws at least half", () => {
    const f = emptyTaxReturnFacts(2025); f.income.iraDistributionsGross = 41_000;
    const engineYear = engineYearFixture({ withdrawals: { byAccount: { ira: 30_000 }, total: 30_000 } });
    const r = engineFlowRules(inputFixture({ facts: f, plan: plan(), engineYear }));
    expect(r.checks.map((c) => c.id)).toContain("income.iraDistributions");
    // Printed return-first, so a swap of the two reddens.
    expect(r.checks).toEqual([{ id: "income.iraDistributions", label: "IRA distributions", returnDisplay: "$41,000", planDisplay: "$29,126" }]);
    expect(r.suggestions).toEqual([]);
  });

  it("says nothing at or below the $1,000 floor, or when line 4a is blank", () => {
    const engineYear = engineYearFixture({ withdrawals: { byAccount: {}, total: 0 } });
    const at = emptyTaxReturnFacts(2025); at.income.iraDistributionsGross = 1_000;
    expect(engineFlowRules(inputFixture({ facts: at, plan: plan(), engineYear }))).toEqual({ suggestions: [], checks: [] });
    // Null is not zero: a return that never mentioned line 4a says nothing about IRA draws.
    expect(engineFlowRules(inputFixture({ facts: emptyTaxReturnFacts(2025), plan: plan(), engineYear }))).toEqual({ suggestions: [], checks: [] });
  });
});

describe("engineFlowRules — investment income, capital gains, other", () => {
  it("reviews investment income when the return is more than double the plan's taxable+cash yield and $2,000 apart", () => {
    const f = emptyTaxReturnFacts(2025); f.income.taxableInterest = 8_000; f.income.ordinaryDividends = 18_000; f.income.taxExemptInterest = 12_000; // 38,000
    const engineYear = engineYearFixture({ accountLedgers: { brk: ledger({ growthDetail: growth({ ordinaryIncome: 2_060, qualifiedDividends: 8_240 }) }), ira: ledger({ growthDetail: growth({ ordinaryIncome: 50_000 }) }) } });
    const s = engineFlowRules(inputFixture({ facts: f, plan: plan(), engineYear })).suggestions.find((x) => x.id === "income.investmentIncome")!;
    expect(s.planFigure.amount).toBeCloseTo(10_000, 0);       // IRA growth excluded
    expect(s.link?.href).toMatch(/net-worth$/);
    expect(s.kind).toBe("review");
    expect(s.action).toBeUndefined();
    expect(s.returnFigure).toMatchObject({ label: "Interest and dividends", amount: 38_000, display: "$38,000" });
    // All three lines are cited, in 1040 order, each carrying its own figure.
    expect(s.returnFigure.lineRefs).toEqual([
      { form: "1040", line: "2a", label: "Tax-exempt interest", amount: 12_000 },
      { form: "1040", line: "2b", label: "Taxable interest", amount: 8_000 },
      { form: "1040", line: "3b", label: "Ordinary dividends", amount: 18_000 },
    ]);
    expect(s.planFigure).toMatchObject({ label: "Taxable and cash account yield in the plan", display: "$10,000", year: 2026 });
    expect(s.delta).toMatchObject({ display: "Plan is $28,000 short", tone: "short" });
    expect(s.headline).toMatch(/\$38,000[\s\S]*\$10,000/);
  });

  it("counts a cash account's yield and the income kinds only — never realized gains or basis", () => {
    const f = emptyTaxReturnFacts(2025); f.income.taxableInterest = 38_000;
    // Drop the cash arm and this loses $3,000; count gains or basis and it gains $288,000.
    const engineYear = engineYearFixture({ accountLedgers: {
      chk: ledger({ growthDetail: growth({ ordinaryIncome: 1_030, taxExempt: 2_060, stCapitalGains: 99_000, ltCapitalGains: 99_000, basisIncrease: 99_000 }) }),
      brk: ledger({ growthDetail: growth({ qualifiedDividends: 7_210 }) }),
    } });
    const s = engineFlowRules(inputFixture({ facts: f, plan: plan(), engineYear })).suggestions.find((x) => x.id === "income.investmentIncome")!;
    expect(s.planFigure.amount).toBeCloseTo(10_000, 0);       // (1,030 + 2,060 + 7,210) / 1.03
  });

  it("checks investment income under either leg, and says nothing when all three lines are blank", () => {
    const brk = engineYearFixture({ accountLedgers: { brk: ledger({ growthDetail: growth({ qualifiedDividends: 10_300 }) }) } });
    const half = emptyTaxReturnFacts(2025); half.income.taxableInterest = 19_000;   // not more than double $10,000
    expect(engineFlowRules(inputFixture({ facts: half, plan: plan(), engineYear: brk })).checks)
      .toEqual([{ id: "income.investmentIncome", label: "Interest and dividends", returnDisplay: "$19,000", planDisplay: "$10,000" }]);

    // The $2,000 floor on its own: $2,500 is five times the plan's $500, but only $2,000 apart.
    const small = emptyTaxReturnFacts(2025); small.income.taxableInterest = 2_500;
    const tiny = engineYearFixture({ accountLedgers: { brk: ledger({ growthDetail: growth({ qualifiedDividends: 515 }) }) } });
    const r = engineFlowRules(inputFixture({ facts: small, plan: plan(), engineYear: tiny }));
    expect(r.suggestions).toEqual([]);
    expect(r.checks).toEqual([{ id: "income.investmentIncome", label: "Interest and dividends", returnDisplay: "$2,500", planDisplay: "$500" }]);

    // All three null means the return said nothing about yield; a single zero means it said zero.
    expect(engineFlowRules(inputFixture({ facts: emptyTaxReturnFacts(2025), plan: plan(), engineYear: brk })).checks.map((c) => c.id))
      .not.toContain("income.investmentIncome");
    const zero = emptyTaxReturnFacts(2025); zero.income.taxableInterest = 0;
    expect(engineFlowRules(inputFixture({ facts: zero, plan: plan(), engineYear: brk })).checks.map((c) => c.id))
      .toContain("income.investmentIncome");
  });

  it("reviews capital gains when the plan realizes under a quarter of a gain over $5,000, distinguishing proceeds from gain", () => {
    const f = emptyTaxReturnFacts(2025); f.income.capitalGainOrLoss = 60_000;
    const engineYear = engineYearFixture({ taxDetail: taxDetail({ capitalGains: 5_150, stCapitalGains: 0 }) });
    const s = engineFlowRules(inputFixture({ facts: f, plan: plan(), engineYear })).suggestions.find((x) => x.id === "income.capitalGains")!;
    expect(s.planFigure.amount).toBeCloseTo(5_000, 0);
    expect(s.meaning).toMatch(/gain, not the proceeds/);
    expect(s.meaning).toMatch(/spending/i);
    expect(s.kind).toBe("review");
    expect(s.action).toBeUndefined();
    expect(s.returnFigure).toMatchObject({ label: "Capital gains", amount: 60_000, display: "$60,000" });
    // Without a Schedule D the citation is line 7 itself.
    expect(s.returnFigure.lineRefs).toEqual([{ form: "1040", line: "7", label: "Capital gain or loss", amount: 60_000 }]);
    expect(s.planFigure).toMatchObject({ label: "Gains the plan realizes", display: "$5,000", year: 2026 });
    expect(s.delta).toMatchObject({ display: "Plan is $55,000 short", tone: "short" });
    expect(s.headline).toMatch(/\$60,000[\s\S]*2025[\s\S]*\$5,000[\s\S]*2026/);
    expect(s.link?.href).toBe(`/clients/${CLIENT_ID}/details/net-worth`);
  });

  it("prefers Schedule D's two legs over line 7, and counts short-term gains the plan realizes", () => {
    // Line 7 is deliberately a different, tiny number: read it instead of Schedule D and the $5,000
    // floor swallows the whole finding. Drop the short-term term and the plan figure falls to $3,000.
    const f = emptyTaxReturnFacts(2025);
    f.income.netLongTermGain = 50_000; f.income.netShortTermGain = 10_000; f.income.capitalGainOrLoss = 1_000;
    const engineYear = engineYearFixture({ taxDetail: taxDetail({ capitalGains: 3_090, stCapitalGains: 2_060 }) });
    const s = engineFlowRules(inputFixture({ facts: f, plan: plan(), engineYear })).suggestions.find((x) => x.id === "income.capitalGains")!;
    expect(s.returnFigure.amount).toBe(60_000);
    expect(s.returnFigure.lineRefs).toEqual([
      { form: "Sched D", line: "15", label: "Long-term gain", amount: 50_000 },
      { form: "Sched D", line: "7", label: "Short-term gain", amount: 10_000 },
    ]);
    expect(s.planFigure.amount).toBeCloseTo(5_000, 0);        // (3,090 + 2,060) / 1.03
  });

  it("checks gains the plan mostly realizes, and ignores a small gain or a loss", () => {
    const f = emptyTaxReturnFacts(2025); f.income.capitalGainOrLoss = 60_000;
    const r = engineFlowRules(inputFixture({ facts: f, plan: plan(), engineYear: engineYearFixture({ taxDetail: taxDetail({ capitalGains: 20_600 }) }) }));
    expect(r.suggestions).toEqual([]);
    expect(r.checks).toEqual([{ id: "income.capitalGains", label: "Capital gains", returnDisplay: "$60,000", planDisplay: "$20,000" }]);

    // $5,000 is the floor, not a threshold that fires; a net loss is not a gain at all.
    const at = emptyTaxReturnFacts(2025); at.income.capitalGainOrLoss = 5_000;
    expect(engineFlowRules(inputFixture({ facts: at, plan: plan(), engineYear: engineYearFixture() }))).toEqual({ suggestions: [], checks: [] });
    const loss = emptyTaxReturnFacts(2025); loss.income.capitalGainOrLoss = -3_000;
    expect(engineFlowRules(inputFixture({ facts: loss, plan: plan(), engineYear: engineYearFixture() }))).toEqual({ suggestions: [], checks: [] });
  });

  it("reports other income as info when the plan carries under half of more than $5,000", () => {
    const f = emptyTaxReturnFacts(2025); f.income.unemployment = 4_000; f.income.otherIncome = 3_000;
    const engineYear = engineYearFixture({ income: { ...engineYearFixture().income, other: 1_030 } });
    const s = engineFlowRules(inputFixture({ facts: f, plan: plan(), engineYear })).suggestions.find((x) => x.id === "income.other")!;
    expect(s.kind).toBe("info");
    // One-off income is not a write and not a link: it is reported and left alone.
    expect(s.action).toBeUndefined();
    expect(s.link).toBeUndefined();
    expect(s.returnFigure).toMatchObject({ label: "Unemployment and other income", amount: 7_000, display: "$7,000" });
    expect(s.returnFigure.lineRefs).toEqual([
      { form: "Sched 1", line: "7", label: "Unemployment", amount: 4_000 },
      { form: "Sched 1", line: "9", label: "Other income", amount: 3_000 },
    ]);
    expect(s.planFigure).toMatchObject({ label: "Other income in the plan", display: "$1,000", year: 2026 });
    expect(s.planFigure.amount).toBeCloseTo(1_000, 0);
    expect(s.delta).toMatchObject({ display: "Plan is $6,000 short", tone: "short" });
    expect(s.headline).toMatch(/\$7,000/);
  });

  it("checks other income the plan mostly carries, and ignores small or blank amounts", () => {
    const f = emptyTaxReturnFacts(2025); f.income.unemployment = 4_000; f.income.otherIncome = 3_000;
    const carried = engineYearFixture({ income: { ...engineYearFixture().income, other: 4_120 } });
    expect(engineFlowRules(inputFixture({ facts: f, plan: plan(), engineYear: carried })).checks)
      .toEqual([{ id: "income.other", label: "Other income", returnDisplay: "$7,000", planDisplay: "$4,000" }]);

    const at = emptyTaxReturnFacts(2025); at.income.otherIncome = 5_000;
    expect(engineFlowRules(inputFixture({ facts: at, plan: plan(), engineYear: engineYearFixture() }))).toEqual({ suggestions: [], checks: [] });
    expect(engineFlowRules(inputFixture({ facts: emptyTaxReturnFacts(2025), plan: plan(), engineYear: engineYearFixture() }))).toEqual({ suggestions: [], checks: [] });
  });
});
