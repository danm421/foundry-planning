import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { buildTaxOtherTaxesDrillData } from "../view-model";
import { makeTaxYears, makeTaxResult, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";
import { dataLight } from "@/brand";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "full" as const, showCallout: false },
};

// Task 14b / D2 — a working household claiming BOTH credit kinds. Traced through
// calculate.ts's roll-up so the numbers are the engine's, not invented:
//   subpartA        = regularFed 10,000 + capGains 1,000 + AMT 0 = 11,000
//   totalFederalTax = max(0, 11,000 − nonrefundable 4,000) + NIIT 0 + addlMed 0
//                     − refundable 1,500                              =  5,500
//   totalTax        = 5,500 + state 3,000 + FICA 9,180               = 17,680
//   Other           = totalTax − regularFed (PRE-credit)             =  7,680
// The named tax columns alone sum to 13,180 — they OVERSHOOT Other by exactly the
// 5,500 of credits, which is the column this fixture exists to pin.
const CREDIT_YEAR = {
  year: 2030,
  ages: { client: 44, spouse: 42 },
  taxResult: makeTaxResult({
    flow: {
      regularFederalIncomeTax: 10_000,
      capitalGainsTax: 1_000,
      fica: 9_180,
      stateTax: 3_000,
      taxCredits: 4_000,
      refundableCredits: 1_500,
      totalFederalTax: 5_500,
      totalTax: 17_680,
    },
  }),
} as unknown as ProjectionYear;

const creditInput = {
  years: [CREDIT_YEAR],
  clientData: makeClientData(),
  options: { range: "full" as const, showCallout: false },
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: null,
};

describe("buildTaxOtherTaxesDrillData", () => {
  it("breaks out the Other bucket and totals it (= Federal page Other)", () => {
    const d = buildTaxOtherTaxesDrillData(base);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.capitalGainsTax).toBe(1_350);
    expect(r.cells.niit).toBe(300);
    expect(r.cells.fica).toBe(13_000);
    expect(r.cells.stateTax).toBe(9_000);
    expect(r.cells.total).toBe(23_650); // 1_350 + 0 + 300 + 0 + 13_000 + 9_000
    expect(d.chartSpec).toBeDefined();
  });

  it("emits a 6-series stacked chart summing to the Other total", () => {
    const d = buildTaxOtherTaxesDrillData(base);
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual([
      "capitalGainsTax", "amt", "niit", "additionalMedicare", "fica", "stateTax",
    ]);
    // Reuse the Federal TAX_STACK tokens.
    const byId = Object.fromEntries(d.chartSpec!.stacks.map((s) => [s.seriesId, s.color]));
    expect(byId.capitalGainsTax).toBe(dataLight.yellow);
    expect(byId.fica).toBe(dataLight.green);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const sum = d.chartSpec!.stacks.reduce((a, s) => a + s.values[i], 0);
    expect(sum).toBeCloseTo(r.cells.total);
  });

  it("C2: Other-Taxes components (incl. penalty) sum to the total", () => {
    const y = { year: 2030, ages: { client: 58 }, taxResult: { flow: {
      regularFederalIncomeTax: 30_000, capitalGainsTax: 0, amtAdditional: 0, niit: 0,
      additionalMedicare: 0, fica: 0, stateTax: 2_000, earlyWithdrawalPenalty: 1_000,
      totalTax: 33_000,
    } } } as never;
    const data = buildTaxOtherTaxesDrillData({
      years: [y], clientData: makeClientData(),
      options: { range: "full", showCallout: false } as never,
      scenarioLabel: "B", clientName: "T", spouseName: null,
    });
    const r = data.table.rows[0].cells;
    const componentSum = r.capitalGainsTax + r.amt + r.niit + r.additionalMedicare
      + r.fica + r.stateTax + r.earlyWithdrawalPenalty;
    expect(componentSum).toBe(r.total); // total = totalTax − regularFed = 3_000
  });

  // D2 (Task 14b). One load-bearing assertion per `it` on purpose: two assertions
  // in one block are NOT two covered assertions — once the first throws the second
  // never runs, so a mutation table would credit coverage that never executed.
  it("D2: the named columns sum to the Total once credits apply", () => {
    const r = buildTaxOtherTaxesDrillData(creditInput).table.rows[0].cells;
    const componentSum = r.capitalGainsTax + r.amt + r.niit + r.additionalMedicare
      + r.fica + r.stateTax + r.earlyWithdrawalPenalty + r.credits;
    expect(componentSum).toBe(r.total); // 13,180 − 5,500 = 7,680
  });

  it("D2: the credits column is the NEGATIVE of both credit kinds combined", () => {
    const r = buildTaxOtherTaxesDrillData(creditInput).table.rows[0].cells;
    // Nonrefundable 4,000 + refundable 1,500, entering the bucket as a reduction.
    expect(r.credits).toBe(-5_500);
  });

  it("D2: the chart stack carries the negative credits series and still sums to the Total", () => {
    const d = buildTaxOtherTaxesDrillData(creditInput);
    const i = d.chartSpec!.xAxis.domain.indexOf(2030);
    const stackSum = d.chartSpec!.stacks.reduce((a, s) => a + s.values[i], 0);
    expect(stackSum).toBeCloseTo(d.table.rows[0].cells.total);
  });

  it("D2: the credits column is spliced in immediately before the Total", () => {
    // The row cells always carry `credits` (mirroring earlyWithdrawalPenalty), so
    // the sum test above passes even with the column hidden — this is what pins
    // that the figure is actually RENDERED, and where.
    const d = buildTaxOtherTaxesDrillData(creditInput);
    expect(d.table.columns.map((c) => c.key)).toEqual([
      "capitalGainsTax", "amt", "niit", "additionalMedicare", "fica", "stateTax",
      "credits", "total",
    ]);
  });

  it("D2: the credits column is zero-suppressed when no visible year claims one", () => {
    const d = buildTaxOtherTaxesDrillData(base);
    expect(d.table.columns.map((c) => c.key)).toEqual([
      "capitalGainsTax", "amt", "niit", "additionalMedicare", "fica", "stateTax",
      "total",
    ]);
  });
});
