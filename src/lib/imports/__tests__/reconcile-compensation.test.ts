import { describe, it, expect } from "vitest";
import { money, groupCompensation, type FileMeta } from "../reconcile-compensation";
import type { Annotated } from "../types";
import type { ExtractedIncome } from "@/lib/extraction/types";

describe("money", () => {
  it("rounds to whole dollars with comma grouping", () => {
    expect(money(239_549.96, "biweekly × 26", ["f1"]).display).toBe("$239,550");
  });

  it("keeps the unrounded amount alongside the display string", () => {
    const m = money(239_549.96, "biweekly × 26", ["f1"]);
    expect(m.amount).toBe(239_549.96);
  });

  it("formats a whole number without a decimal tail", () => {
    expect(money(26_000, "per period × 26", ["f1"]).display).toBe("$26,000");
  });

  it("carries basis and source files through", () => {
    const m = money(1000, "YTD, not annualized", ["f1", "f2"]);
    expect(m.basis).toBe("YTD, not annualized");
    expect(m.fromFiles).toEqual(["f1", "f2"]);
  });

  it("formats zero and negative amounts", () => {
    expect(money(0, "b", []).display).toBe("$0");
    expect(money(-1234.5, "b", []).display).toBe("-$1,235");
  });
});

const FILES: Record<string, FileMeta> = {
  stub1: { documentType: "pay_stub", fileName: "2026-08-14_payslip.pdf" },
  stub2: { documentType: "pay_stub", fileName: "2026-07-31_payslip.pdf" },
  w2:    { documentType: "tax_return", fileName: "W2_2025.pdf" },
};

function inc(
  fileId: string,
  over: Partial<ExtractedIncome> = {},
): Annotated<ExtractedIncome> {
  return {
    type: "salary",
    name: "Salary",
    annualAmount: 239_550,
    owner: "client",
    employer: "The Mount Sinai Hospital",
    sourceTaxYear: 2026,
    basis: "annualized",
    recurrence: "recurring",
    ...over,
    __provenance: { sourceFileId: fileId, section: "incomes" },
    match: { kind: "new" },
  };
}

describe("groupCompensation", () => {
  it("puts two paystubs for one employer and year in one group", () => {
    const groups = groupCompensation([inc("stub1"), inc("stub2")], FILES);
    expect(groups).toHaveLength(1);
    expect(groups[0].incomes).toHaveLength(2);
    expect(groups[0].employer).toBe("The Mount Sinai Hospital");
    expect(groups[0].taxYear).toBe(2026);
  });

  it("separates the same employer in different tax years", () => {
    const groups = groupCompensation(
      [inc("stub1"), inc("w2", { sourceTaxYear: 2025, basis: "actual" })],
      FILES,
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.taxYear).sort()).toEqual([2025, 2026]);
  });

  it("separates different employers", () => {
    const groups = groupCompensation(
      [inc("stub1"), inc("stub2", { employer: "Other Hospital" })],
      FILES,
    );
    expect(groups).toHaveLength(2);
  });

  it("separates client from spouse at the same employer", () => {
    const groups = groupCompensation(
      [inc("stub1"), inc("stub2", { owner: "spouse" })],
      FILES,
    );
    expect(groups).toHaveLength(2);
  });

  it("matches employer case- and whitespace-insensitively", () => {
    const groups = groupCompensation(
      [inc("stub1"), inc("stub2", { employer: "  the mount sinai hospital " })],
      FILES,
    );
    expect(groups).toHaveLength(1);
  });

  it("excludes a row with no employer — it cannot be reconciled", () => {
    expect(groupCompensation([inc("stub1", { employer: undefined })], FILES)).toEqual([]);
  });

  it("excludes a row with no sourceTaxYear", () => {
    expect(groupCompensation([inc("stub1", { sourceTaxYear: undefined })], FILES)).toEqual([]);
  });

  it("excludes non-employment income types", () => {
    expect(groupCompensation([inc("stub1", { type: "social_security" })], FILES)).toEqual([]);
  });
});
