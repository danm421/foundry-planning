// src/lib/projection-explain/__tests__/compose.test.ts
// COMPOSITION (Task 8): the tax adapter's components() decomposes a single year's
// tax bill into labeled, source-keyed parts; explainComposition wraps it with the
// year resolution + analysisContext + notes the tool returns.
import { describe, expect, it } from "vitest";
import { explainComposition } from "../explain";
import { taxAdapter } from "../subjects/tax";
import { DRILL_CTX, makeTaxDetail, makeTaxResult, makeYear } from "./fixtures";
import type { ProjectionYear } from "@/engine/types";
import type { DrillContext } from "../types";

// A retirement-year tax bill: the tax-line pieces sum exactly to flow.totalTax
// (regular 30k + capGains 8k + NIIT 2k + addl Medicare 1k + state 6k = 47k; AMT,
// FICA, and penalty are 0 and drop out). The income driving it comes from a 401k
// withdrawal + an IRA RMD, both source-keyed via taxDetail.bySource.
function compositionFixture(): { year: ProjectionYear; ctx: DrillContext } {
  const year = makeYear({
    year: 2062,
    taxDetail: makeTaxDetail({
      "withdrawal:k401": { type: "ordinary", amount: 120_000 },
      "ira:rmd": { type: "rmd", amount: 40_000 },
    }),
    taxResult: makeTaxResult({
      flow: {
        regularFederalIncomeTax: 30_000,
        capitalGainsTax: 8_000,
        niit: 2_000,
        additionalMedicare: 1_000,
        stateTax: 6_000,
        totalFederalTax: 41_000,
        totalTax: 47_000,
      },
    }),
  });
  const ctx: DrillContext = {
    ...DRILL_CTX,
    accountNames: { k401: "Dan 401k", ira: "Dan IRA" },
  };
  return { year, ctx };
}

// Self-employed variant: the engine folds SECA self-employment tax straight into
// flow.totalTax with NO line field (year-tax.ts), so the eight line fields
// (47k here) fall $18,360 short of the reported totalTax (65,360). The residual
// guard must surface that gap as its own tax_line so the sum still reconciles.
function secaFixture(): { year: ProjectionYear; ctx: DrillContext } {
  const { ctx } = compositionFixture();
  const year = makeYear({
    year: 2062,
    taxDetail: makeTaxDetail({ "withdrawal:k401": { type: "ordinary", amount: 120_000 } }),
    taxResult: makeTaxResult({
      flow: {
        regularFederalIncomeTax: 30_000,
        capitalGainsTax: 8_000,
        niit: 2_000,
        additionalMedicare: 1_000,
        stateTax: 6_000,
        totalFederalTax: 59_360, // 41k federal lines + 18,360 SECA folded in
        totalTax: 65_360, // 47k lines + 18,360 SECA (no line field for seTax)
      },
    }),
  });
  return { year, ctx };
}

describe("taxAdapter.components (COMPOSITION)", () => {
  it("decomposes a tax year into labeled, source-keyed components", () => {
    const { year, ctx } = compositionFixture();
    const parts = taxAdapter.components(year, ctx);
    expect(parts.map((p) => p.label)).toContain("Regular federal income tax");
    expect(parts.find((p) => p.label.includes("401k"))?.sourceId).toBeDefined();
    expect(Math.round(parts.reduce((s, p) => s + (p.type === "tax_line" ? p.amount : 0), 0)))
      .toBe(Math.round(year.taxResult!.flow.totalTax));
  });

  it("tags tax-line parts and income-source parts with distinct types", () => {
    const { year, ctx } = compositionFixture();
    const parts = taxAdapter.components(year, ctx);
    const taxLines = parts.filter((p) => p.type === "tax_line");
    const sources = parts.filter((p) => p.type === "income_source");
    // Only the nonzero tax lines survive (5 of the 8 fields are nonzero here).
    expect(taxLines.map((p) => p.label).sort()).toEqual(
      ["Additional Medicare", "Capital gains tax", "NIIT", "Regular federal income tax", "State tax"].sort(),
    );
    // income-source parts carry a sourceId; tax lines never do.
    expect(sources.every((p) => typeof p.sourceId === "string")).toBe(true);
    expect(taxLines.every((p) => p.sourceId === undefined)).toBe(true);
    expect(sources.map((p) => p.label)).toEqual(
      expect.arrayContaining(["Dan 401k — Withdrawal", "Dan IRA — RMD"]),
    );
    // No-SECA client: the eight lines already reconcile, so NO residual line.
    expect(taxLines.some((p) => p.label.includes("Self-employment"))).toBe(false);
  });

  it("emits a residual tax_line so the sum invariant holds for self-employed clients", () => {
    const { year, ctx } = secaFixture();
    const parts = taxAdapter.components(year, ctx);
    const taxLines = parts.filter((p) => p.type === "tax_line");
    // The residual line appears with the honest SECA-inclusive label…
    const residual = taxLines.find((p) => p.label === "Self-employment tax and other federal adjustments");
    expect(residual).toBeDefined();
    expect(residual!.amount).toBe(18_360);
    // …and the tax_line parts (eight lines + residual) reconcile to totalTax.
    expect(Math.round(parts.reduce((s, p) => s + (p.type === "tax_line" ? p.amount : 0), 0)))
      .toBe(Math.round(year.taxResult!.flow.totalTax));
  });

  it("degrades to a single Total tax component when taxResult is absent", () => {
    const year = makeYear({
      year: 2062,
      taxResult: undefined,
      expenses: { ...makeYear({ year: 2062 }).expenses, taxes: 50_000 },
    });
    const parts = taxAdapter.components(year, DRILL_CTX);
    expect(parts).toEqual([{ label: "Total tax", amount: 50_000 }]);
    // The degraded part carries no tax_line type, so it is never summed as one.
    expect(parts.every((p) => p.type !== "tax_line")).toBe(true);
  });
});

describe("explainComposition", () => {
  it("returns the pure composition for an in-range year with a single-year boundary", () => {
    const { year, ctx } = compositionFixture();
    const out = explainComposition({
      adapter: taxAdapter,
      years: [makeYear({ year: 2061 }), year, makeYear({ year: 2063 })],
      year: 2062,
      compareTo: "none",
      ctx,
    });
    expect(out.available).toBe(true);
    if (!out.available) return;
    expect(out.subject).toBe("tax");
    expect(out.year).toBe(2062);
    expect(out.figure).toBe(47_000);
    expect(out.componentBreakdown.some((p) => p.label === "Regular federal income tax")).toBe(true);
    // Single-year composition — boundaryAnalyzed is the year alone, no "prev→next".
    expect(out.analysisContext.boundaryAnalyzed).toBe("2062");
    expect(out.analysisContext.boundaryAnalyzed).not.toContain("→");
  });

  it("rejects an out-of-range year with the available range", () => {
    const { year, ctx } = compositionFixture();
    const out = explainComposition({
      adapter: taxAdapter,
      years: [year],
      year: 2099,
      compareTo: "none",
      ctx,
    });
    expect(out.available).toBe(false);
    if (out.available) return;
    expect(out.availableYears).toEqual({ first: 2062, last: 2062 });
    expect(out.reason).toContain("2099");
  });

  it("degrades honestly (no throw) when compareTo is a LEVEL reference (Task 9)", () => {
    const { year, ctx } = compositionFixture();
    const out = explainComposition({
      adapter: taxAdapter,
      years: [year],
      year: 2062,
      compareTo: "prior_year",
      ctx,
    });
    expect(out.available).toBe(true);
    if (!out.available) return;
    // Composition still runs; a note flags that level-comparison isn't available yet.
    expect(out.componentBreakdown.length).toBeGreaterThan(0);
    expect(out.notes.some((n) => /comparison/i.test(n) && n.includes("prior_year"))).toBe(true);
  });

  it("degrades the breakdown to expenses.taxes when the year lacks taxResult", () => {
    const noTax = makeYear({
      year: 2062,
      taxResult: undefined,
      expenses: { ...makeYear({ year: 2062 }).expenses, taxes: 50_000 },
    });
    const out = explainComposition({
      adapter: taxAdapter,
      years: [noTax],
      year: 2062,
      compareTo: "none",
      ctx: DRILL_CTX,
    });
    expect(out.available).toBe(true);
    if (!out.available) return;
    expect(out.degraded).toBe(true);
    expect(out.figure).toBe(50_000);
    expect(out.componentBreakdown).toEqual([{ label: "Total tax", amount: 50_000 }]);
    expect(out.notes.join(" ")).toContain("expenses.taxes");
  });
});
