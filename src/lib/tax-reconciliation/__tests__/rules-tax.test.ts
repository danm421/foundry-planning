import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { taxRules } from "../rules/tax";
import { engineYearFixture, inputFixture } from "./fixtures";
import type { SectionId, Suggestion } from "../types";

// `returnFigure.label` is the id on purpose: the "where the difference comes from" sentence prints
// labels, so naming them after the ids lets a test pin WHICH suggestions were picked and in what order.
const sug = (id: string, amount: number, section: SectionId = "income"): Suggestion => ({ id, section, kind: "update", status: "open", headline: id, meaning: "", returnFigure: { label: id, amount, display: "", lineRefs: [] }, planFigure: { label: "", amount: 0, display: "", year: 2026 }, delta: { amount: -amount, display: "", tone: "short" } });
const taxResult = (federal: number) => ({ flow: { totalFederalTax: federal, adjustedGrossIncome: 0, taxableIncome: 0 } }) as never;

describe("taxRules", () => {
  it("explains a federal gap (> 15% and $2,000) with the three largest income-side gaps, deflated", () => {
    const f = emptyTaxReturnFacts(2025); f.tax.totalTax = 30_000;
    const engineYear = engineYearFixture({ taxResult: taxResult(15_450) }); // 15,000 in 2025 dollars
    const others = [sug("income.capitalGains", 60_000), sug("household.filingStatus", 0), sug("income.iraDistributions", 41_000), sug("income.wages.w2.0", 5_000), sug("business.scheduleC.0", 80_000)];
    const r = taxRules(inputFixture({ facts: f, engineYear }), others);
    const s = r.suggestions.find((x) => x.id === "tax.federal")!;
    expect(s.kind).toBe("info");
    expect(s.planFigure.amount).toBeCloseTo(15_000, 0);
    expect(s.meaning).toMatch(/business\.scheduleC\.0|Schedule C/);
    expect(s.meaning.indexOf("income.wages.w2.0")).toBe(-1);   // fourth-largest is not listed
    // Largest first, so a broken sort reddens rather than quietly reordering the sentence.
    expect(s.meaning).toMatch(/business\.scheduleC\.0[\s\S]*income\.capitalGains[\s\S]*income\.iraDistributions/);
    // The pair the card shows, both halves, so a swapped field reddens.
    expect(s).toMatchObject({ section: "tax", status: "open" });
    expect(s.action).toBeUndefined();
    expect(s.returnFigure).toMatchObject({ label: "Federal tax", amount: 30_000, display: "$30,000" });
    expect(s.returnFigure.lineRefs).toEqual([{ form: "1040", line: "24", label: "Total tax", amount: 30_000 }]);
    expect(s.planFigure).toMatchObject({ label: "Federal tax in the plan", display: "$15,000", year: 2026 });
    expect(s.delta).toMatchObject({ display: "Plan is $15,000 short", tone: "short" });
    // Ordered, so exchanging the two interpolations reddens while the prose stays free.
    expect(s.headline).toMatch(/2025[\s\S]*\$30,000[\s\S]*\$15,000[\s\S]*2026/);
    expect(r.checks).toEqual([]);
  });

  it("names only income-side gaps, skips ones with no delta, and says nothing when there are none", () => {
    const f = emptyTaxReturnFacts(2025); f.tax.totalTax = 30_000;
    const engineYear = engineYearFixture({ taxResult: taxResult(15_450) });
    // The section filter is what ROUTES the sentence. Without it the two largest gaps here are a
    // deduction and a filing-status finding — neither of which is income the tax follows.
    const noDelta = sug("income.other", 90_000);
    noDelta.delta = { amount: null, display: "—", tone: "neutral" };
    const others = [
      sug("deductions.charitable", 500_000, "deductions"), sug("household.filingStatus", 400_000, "household"),
      sug("savings.hsa", 300_000, "savings"), noDelta,
      sug("business.scheduleC.0", 80_000, "business"), sug("spending.implied", 60_000, "spending"), sug("income.capitalGains", 10_000),
    ];
    const s = taxRules(inputFixture({ facts: f, engineYear }), others).suggestions.find((x) => x.id === "tax.federal")!;
    expect(s.meaning).toMatch(/business\.scheduleC\.0[\s\S]*spending\.implied[\s\S]*income\.capitalGains/);
    for (const id of ["deductions.charitable", "household.filingStatus", "savings.hsa", "income.other"]) {
      expect(s.meaning.indexOf(id)).toBe(-1);
    }

    // A gap with no number behind it is dropped, not merely sorted last: with only two real gaps
    // beside it there is room in the top three, and "income.other (—)" would be the contribution.
    const sparse = taxRules(inputFixture({ facts: f, engineYear }), [sug("business.scheduleC.0", 80_000, "business"), sug("income.capitalGains", 10_000), noDelta]).suggestions.find((x) => x.id === "tax.federal")!;
    expect(sparse.meaning).toMatch(/business\.scheduleC\.0[\s\S]*income\.capitalGains/);
    expect(sparse.meaning.indexOf("income.other")).toBe(-1);

    // With nothing to name, the card still explains the gap and simply stops there.
    const alone = taxRules(inputFixture({ facts: f, engineYear }), []).suggestions.find((x) => x.id === "tax.federal")!;
    expect(alone.meaning).toMatch(/fix the income cards first/);
    expect(alone.meaning).not.toMatch(/Where the difference comes from/);
  });

  it("checks when federal tax is in line and reports a settlement over $5,000 either way", () => {
    const f = emptyTaxReturnFacts(2025); f.tax.totalTax = 30_000; f.payments.amountOwed = 6_400;
    const r = taxRules(inputFixture({ facts: f, engineYear: engineYearFixture({ taxResult: taxResult(30_900) }) }), []);
    expect(r.checks[0].id).toBe("tax.federal");
    expect(r.suggestions[0]).toMatchObject({ id: "tax.settlement", kind: "info" });
    expect(r.suggestions[0].headline).toMatch(/owed \$6,400/);
    // Printed return-first, so a swap of the two reddens.
    expect(r.checks).toEqual([{ id: "tax.federal", label: "Federal tax", returnDisplay: "$30,000", planDisplay: "$30,000" }]);
    // The settlement is a return-side fact with no plan number behind it, so it carries no delta.
    const s = r.suggestions[0];
    expect(s).toMatchObject({ section: "tax", status: "open" });
    expect(s.action).toBeUndefined();
    expect(s.returnFigure).toMatchObject({ label: "Amount owed", amount: 6_400, display: "$6,400" });
    expect(s.returnFigure.lineRefs).toEqual([{ form: "1040", line: "37", label: "Amount you owe", amount: 6_400 }]);
    expect(s.planFigure).toEqual({ label: "Plan", amount: null, display: "Pays as it goes", year: 2026 });
    expect(s.delta).toEqual({ amount: null, display: "—", tone: "neutral" });
    expect(s.meaning).toMatch(/under-withholding/);
  });

  it("needs both tolerance legs to speak, and stays quiet without a tax figure on either side", () => {
    const f = emptyTaxReturnFacts(2025); f.tax.totalTax = 30_000;
    // $3,000 clears the dollar floor but is only 10% of the tax paid.
    const pctOnly = taxRules(inputFixture({ facts: f, engineYear: engineYearFixture({ taxResult: taxResult(27_810) }) }), []);
    expect(pctOnly.suggestions).toEqual([]);
    expect(pctOnly.checks).toEqual([{ id: "tax.federal", label: "Federal tax", returnDisplay: "$30,000", planDisplay: "$27,000" }]);

    // $1,500 on a $5,000 bill is 30% but under the $2,000 floor.
    const small = emptyTaxReturnFacts(2025); small.tax.totalTax = 5_000;
    const absOnly = taxRules(inputFixture({ facts: small, engineYear: engineYearFixture({ taxResult: taxResult(3_605) }) }), []);
    expect(absOnly.suggestions).toEqual([]);
    expect(absOnly.checks).toEqual([{ id: "tax.federal", label: "Federal tax", returnDisplay: "$5,000", planDisplay: "$3,500" }]);

    // No engine year, an engine year that never ran the tax calc, and a return with no line 24: all
    // three leave the federal comparison out entirely rather than comparing against a zero.
    expect(taxRules(inputFixture({ facts: f }), [])).toEqual({ suggestions: [], checks: [] });
    expect(taxRules(inputFixture({ facts: f, engineYear: engineYearFixture() }), [])).toEqual({ suggestions: [], checks: [] });
    expect(taxRules(inputFixture({ facts: emptyTaxReturnFacts(2025), engineYear: engineYearFixture({ taxResult: taxResult(30_900) }) }), [])).toEqual({ suggestions: [], checks: [] });
  });

  it("reports a large refund, prefers the refund wording, and ignores a settlement at the floor", () => {
    const refunded = emptyTaxReturnFacts(2025); refunded.payments.refund = 9_000;
    const s = taxRules(inputFixture({ facts: refunded }), []).suggestions[0];
    expect(s).toMatchObject({ id: "tax.settlement", section: "tax", kind: "info" });
    expect(s.headline).toMatch(/refunded \$9,000/);
    expect(s.returnFigure).toMatchObject({ label: "Refund", amount: 9_000, display: "$9,000" });
    expect(s.returnFigure.lineRefs).toEqual([{ form: "1040", line: "34", label: "Refund", amount: 9_000 }]);
    expect(s.meaning).toMatch(/withholding the household could have kept/);

    // A return carrying both is a refund return; the wording and the line must follow the refund.
    const both = emptyTaxReturnFacts(2025); both.payments.refund = 6_000; both.payments.amountOwed = 7_000;
    const b = taxRules(inputFixture({ facts: both }), []).suggestions[0];
    expect(b.headline).toMatch(/refunded \$6,000/);
    expect(b.returnFigure).toMatchObject({ label: "Refund", amount: 6_000 });

    // $5,000 is the floor, not a threshold that fires.
    const at = emptyTaxReturnFacts(2025); at.payments.refund = 5_000; at.payments.amountOwed = 5_000;
    expect(taxRules(inputFixture({ facts: at }), [])).toEqual({ suggestions: [], checks: [] });
    expect(taxRules(inputFixture({ facts: emptyTaxReturnFacts(2025) }), [])).toEqual({ suggestions: [], checks: [] });
  });
});
