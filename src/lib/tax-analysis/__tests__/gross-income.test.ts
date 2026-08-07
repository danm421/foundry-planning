import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts, emptyBusiness, emptyK1 } from "@/lib/schemas/tax-return-facts";
import { buildGrossIncome } from "../gross-income";
import { landlordSingle, retireeMfj, highEarnerMfj } from "./fixtures";

describe("buildGrossIncome", () => {
  it("grosses a rental back up to rents received (the filed return's headline case)", () => {
    // Line 9 is 118,546 and already net of a 6,141 rental loss which is itself
    // net of 8,413 of depreciation. 19,600 of rent actually arrived.
    const g = buildGrossIncome(landlordSingle());
    expect(g.total).toBe(144287); // 118,546 − (−6,141) + 19,600
    expect(g.uplifts).toEqual([{ key: "rental", gross: 19600, net: -6141 }]);
  });

  it("anchors on filed line 9 rather than summing rows", () => {
    const f = landlordSingle();
    f.income.totalIncome = 999; // deliberately inconsistent with its components
    expect(buildGrossIncome(f).total).toBe(999 + 6141 + 19600);
  });

  it("returns a null total when line 9 was not extracted, but still reports uplifts", () => {
    const g = buildGrossIncome(retireeMfj()); // fixture has no totalIncome
    expect(g.total).toBeNull();
    expect(g.uplifts).toEqual([{ key: "socialSecurity", gross: 62000, net: 52700 }]);
  });

  it("grosses Schedule C up to total gross receipts across every business", () => {
    const f = emptyTaxReturnFacts(2025);
    f.income.totalIncome = 80000;
    f.income.scheduleCNet = 80000;
    f.businesses = [
      { ...emptyBusiness(), name: "A", netProfit: 50000, grossReceipts: 140000 },
      { ...emptyBusiness(), name: "B", netProfit: 30000, grossReceipts: 60000 },
    ];
    const g = buildGrossIncome(f);
    expect(g.uplifts).toEqual([{ key: "business", gross: 200000, net: 80000 }]);
    expect(g.total).toBe(200000);
  });

  it("skips the Schedule C uplift when ANY business is missing gross receipts", () => {
    // A partial sum would be paired against the FULL net, understating gross —
    // on a profitable business that yields a "gross" BELOW line 9.
    const f = emptyTaxReturnFacts(2025);
    f.income.totalIncome = 80000;
    f.income.scheduleCNet = 80000;
    f.businesses = [
      { ...emptyBusiness(), name: "A", netProfit: 50000, grossReceipts: 140000 },
      { ...emptyBusiness(), name: "B", netProfit: 30000, grossReceipts: null },
    ];
    expect(buildGrossIncome(f).uplifts).toEqual([]);
    expect(buildGrossIncome(f).total).toBe(80000);
  });

  it("grosses the 1040's a/b pairs up to the a line (4a, 5a, 6a)", () => {
    const f = emptyTaxReturnFacts(2025);
    f.income.totalIncome = 100000;
    f.income.iraDistributionsGross = 50000; // 4a — 10,000 is nondeductible basis
    f.income.iraDistributionsTaxable = 40000; // 4b
    f.income.pensionsGross = 30000; // 5a
    f.income.pensionsTaxable = 24000; // 5b
    f.income.ssBenefitsGross = 40000; // 6a
    f.income.ssBenefitsTaxable = 34000; // 6b
    const g = buildGrossIncome(f);
    expect(g.uplifts.map((u) => u.key)).toEqual(["ira", "pensions", "socialSecurity"]);
    expect(g.total).toBe(100000 + 10000 + 6000 + 6000);
  });

  it("emits no uplift when the a line equals the b line", () => {
    // retireeMfj's IRA is fully taxable (4a === 4b): a zero uplift would light
    // the Gross column up to say nothing.
    expect(buildGrossIncome(retireeMfj()).uplifts.map((u) => u.key)).not.toContain("ira");
  });

  it("never grosses up a K-1 — its boxes are already allocated nets", () => {
    const f = emptyTaxReturnFacts(2025);
    f.income.totalIncome = 60000;
    f.income.scheduleENet = 60000;
    f.k1s = [{ ...emptyK1(), entityName: "Acme LLC", ordinaryBusinessIncome: 60000 }];
    const g = buildGrossIncome(f);
    expect(g.uplifts).toEqual([]);
    expect(g.total).toBe(60000);
  });

  it("excludes tax-exempt interest — a §103 exclusion is not gross income", () => {
    // retireeMfj carries 12,000 of muni interest (2a); it is not on line 9 and
    // is deliberately not added here.
    const f = retireeMfj();
    f.income.totalIncome = 188700;
    expect(buildGrossIncome(f).total).toBe(188700 + 9300); // SS uplift only
  });

  it("reports no uplift for a wage-and-portfolio return (gross === line 9)", () => {
    const f = highEarnerMfj();
    f.income.totalIncome = 467000;
    const g = buildGrossIncome(f);
    expect(g.uplifts).toEqual([]);
    expect(g.total).toBe(467000);
  });

  it("returns an empty result for a blank return", () => {
    const g = buildGrossIncome(emptyTaxReturnFacts(2025));
    expect(g.total).toBeNull();
    expect(g.uplifts).toEqual([]);
  });
});
