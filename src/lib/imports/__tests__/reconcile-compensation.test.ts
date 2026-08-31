import { describe, it, expect } from "vitest";
import {
  money,
  groupCompensation,
  reconcileGroup,
  annotateReconciliation,
  type FileMeta,
} from "../reconcile-compensation";
import type { Annotated } from "../types";
import { emptyImportPayload } from "../types";
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
  combo: { documentType: "tax_return", fileName: "combined_household_wages.pdf" },
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

describe("reconcileGroup", () => {
  it("collapses two paystubs of the same job to ONE figure, never their sum", () => {
    const group = groupCompensation([inc("stub1"), inc("stub2")], FILES)[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.recurring?.amount).toBe(239_550);
    expect(r.recurring?.display).toBe("$239,550");
    expect(r.supersedes).toHaveLength(1);
    expect(r.confidence).toBe("high");
  });

  it("prefers the annualized paystub for an OPEN year", () => {
    const group = groupCompensation(
      [inc("stub1", { annualAmount: 239_550 }),
       inc("w2", { annualAmount: 250_000, basis: "actual" })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.recurring?.amount).toBe(239_550);
    expect(r.recurring?.basis).toContain("annualized");
  });

  it("prefers the W-2 actual for a CLOSED year", () => {
    const group = groupCompensation(
      [inc("stub1", { sourceTaxYear: 2025, annualAmount: 239_550 }),
       inc("w2", { sourceTaxYear: 2025, annualAmount: 250_000, basis: "actual" })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.recurring?.amount).toBe(250_000);
    expect(r.recurring?.basis).toContain("actual");
  });

  it("keeps variable pay separate and does not fold it into recurring", () => {
    const group = groupCompensation(
      [inc("stub1"),
       inc("stub1", { name: "Incentive", annualAmount: 20_925, recurrence: "variable" })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.recurring?.amount).toBe(239_550);
    expect(r.variable?.amount).toBe(20_925);
    expect(r.total.amount).toBe(260_475);
  });

  it("flags needs-review when two same-kind documents disagree beyond 1%", () => {
    const group = groupCompensation(
      [inc("stub1", { annualAmount: 239_550 }),
       inc("stub2", { annualAmount: 300_000 })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.confidence).toBe("needs-review");
    expect(r.conflicts.join(" ")).toContain("$300,000");
  });

  it("stays high-confidence when they agree within 1%", () => {
    const group = groupCompensation(
      [inc("stub1", { annualAmount: 239_550 }),
       inc("stub2", { annualAmount: 239_600 })],
      FILES,
    )[0];
    expect(reconcileGroup(group, FILES, 2026).confidence).toBe("high");
  });

  it("names every superseded row with a reason", () => {
    const group = groupCompensation([inc("stub1"), inc("stub2")], FILES)[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.supersedes[0].reason).toMatch(/same employer/i);
    expect(r.supersedes[0].sourceFileId).toBeTruthy();
  });

  it("supersedes nothing when the group has a single row", () => {
    const group = groupCompensation([inc("stub1")], FILES)[0];
    expect(reconcileGroup(group, FILES, 2026).supersedes).toEqual([]);
  });

  // Regression for review finding 1: a winner picked purely on `basis` can
  // have no `annualAmount` (it's optional), which used to make `build()`
  // bail before ever looking at the other row — reporting recurring: undefined
  // / total: $0 at "high" confidence even though a usable figure existed.
  it("does not silently report $0 when the preferred-basis row has no amount", () => {
    const group = groupCompensation(
      [inc("stub1", { annualAmount: undefined }),
       inc("w2", { annualAmount: 250_000, basis: "actual" })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.recurring?.amount).toBe(250_000);
    expect(r.total.amount).toBe(250_000);
    // the amount-less row is still tracked, not silently dropped
    expect(r.supersedes).toHaveLength(1);
  });

  // Regression for review finding 2: two rows from the SAME document (e.g.
  // base salary + shift differential on one paystub) are not two documents
  // measuring the same earnings — the "measured twice" reason is false for
  // same-file rows, so they must not be superseded against each other.
  it("does not supersede two recurring lines from the SAME document", () => {
    const group = groupCompensation(
      [inc("stub1"),
       inc("stub1", { name: "Shift Differential", annualAmount: 5_000 })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.supersedes).toEqual([]);
  });

  it("treats exactly 1% disagreement as within tolerance", () => {
    const group = groupCompensation(
      [inc("stub1", { annualAmount: 200_000 }),
       inc("stub2", { annualAmount: 198_000, basis: "actual" })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.confidence).toBe("high");
  });

  it("flags needs-review just over the 1% tolerance boundary", () => {
    const group = groupCompensation(
      [inc("stub1", { annualAmount: 200_000 }),
       inc("stub2", { annualAmount: 197_999, basis: "actual" })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.confidence).toBe("needs-review");
  });

  it("falls back to the first row when none carries the preferred basis", () => {
    const group = groupCompensation(
      [inc("stub1", { basis: undefined }),
       inc("stub2", { basis: undefined, annualAmount: 239_600 })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.recurring?.amount).toBe(239_550);
  });

  // Regression for review round 2: reconciliation happens at the DOCUMENT
  // level. One document (stub1) reports two recurring lines that are its own
  // distinct pieces of pay (base + shift differential) — those SUM. A second
  // document (w2) reports the combined figure as one row — it loses (open
  // year prefers the annualized document) and is superseded, but the winning
  // figure must be the winning DOCUMENT'S SUM, not just one of its two rows.
  it("sums two rows from the SAME document, then supersedes the other document's combined figure", () => {
    const group = groupCompensation(
      [inc("stub1"),
       inc("stub1", { name: "Shift Differential", annualAmount: 5_000 }),
       inc("w2", { annualAmount: 244_550, basis: "actual" })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.recurring?.amount).toBe(244_550);
    expect(r.supersedes).toHaveLength(1);
    expect(r.supersedes[0].sourceFileId).toBe("w2");
  });

  it("raises exactly ONE conflict per losing document, naming its SUM", () => {
    const group = groupCompensation(
      [inc("stub1"),
       inc("stub1", { name: "Shift Differential", annualAmount: 5_000 }),
       inc("w2", { annualAmount: 241_000, basis: "actual" })],
      FILES,
    )[0];
    const r = reconcileGroup(group, FILES, 2026);
    expect(r.confidence).toBe("needs-review");
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toContain("$241,000");
  });
});

describe("annotateReconciliation", () => {
  function payloadWith(rows: Annotated<ExtractedIncome>[]) {
    const p = emptyImportPayload();
    p.incomes = rows;
    return p;
  }

  it("marks the superseded row but KEEPS it in the payload", () => {
    const { payload } = annotateReconciliation(
      payloadWith([inc("stub1"), inc("stub2")]), FILES, 2026,
    );
    expect(payload.incomes).toHaveLength(2);
    const marked = payload.incomes.filter((r) => r.reconciliation);
    expect(marked).toHaveLength(1);
    expect(marked[0].reconciliation?.reason).toMatch(/same employer/i);
  });

  it("leaves the surviving row unmarked", () => {
    const { payload } = annotateReconciliation(
      payloadWith([inc("stub1"), inc("stub2")]), FILES, 2026,
    );
    expect(payload.incomes.filter((r) => !r.reconciliation)).toHaveLength(1);
  });

  it("adds one warning naming both documents", () => {
    const { payload } = annotateReconciliation(
      payloadWith([inc("stub1"), inc("stub2")]), FILES, 2026,
    );
    expect(payload.warnings.join(" ")).toContain("The Mount Sinai Hospital");
  });

  it("marks nothing when the rows are genuinely different jobs", () => {
    const { payload } = annotateReconciliation(
      payloadWith([inc("stub1"), inc("stub2", { employer: "Other Hospital" })]), FILES, 2026,
    );
    expect(payload.incomes.some((r) => r.reconciliation)).toBe(false);
  });

  it("leaves rows lacking the facts completely untouched", () => {
    const { payload } = annotateReconciliation(
      payloadWith([inc("stub1", { employer: undefined }), inc("stub2", { employer: undefined })]),
      FILES, 2026,
    );
    expect(payload.incomes.some((r) => r.reconciliation)).toBe(false);
    expect(payload.warnings).toEqual([]);
  });

  it("is idempotent — running twice marks the same single row", () => {
    const once = annotateReconciliation(payloadWith([inc("stub1"), inc("stub2")]), FILES, 2026);
    const twice = annotateReconciliation(once.payload, FILES, 2026);
    expect(twice.payload.incomes.filter((r) => r.reconciliation)).toHaveLength(1);
    expect(twice.payload.warnings).toHaveLength(1);
  });

  // Regression: the superseded-row lookup used to be ONE map shared across
  // every group, keyed `sourceFileId|rowName`. A combined document covering
  // two employers with a generic row label ("Wages") repeats that same key
  // in two DIFFERENT groups, so the second group's Supersede used to
  // overwrite the first's in the map — stamping a row with another
  // employer's reason text. Both groups here share the SAME `combo` file id
  // and the SAME losing row name ("Wages") to reproduce that collision.
  it("scopes the superseded-row lookup to its own group — a shared file id across two employers must not collide", () => {
    const rows: Annotated<ExtractedIncome>[] = [
      inc("stub1", { name: "Base Pay" }),
      inc("combo", { name: "Wages", basis: "actual" }),
      inc("stub2", { owner: "spouse", employer: "Other Hospital", name: "Base Salary" }),
      inc("combo", { owner: "spouse", employer: "Other Hospital", name: "Wages", basis: "actual" }),
    ];
    const { payload } = annotateReconciliation(payloadWith(rows), FILES, 2026);
    const marked = payload.incomes.filter((r) => r.reconciliation);
    expect(marked).toHaveLength(2);

    const mountSinaiRow = marked.find((r) => r.employer === "The Mount Sinai Hospital");
    const otherHospitalRow = marked.find((r) => r.employer === "Other Hospital");
    expect(mountSinaiRow?.reconciliation?.reason).toContain("The Mount Sinai Hospital");
    expect(mountSinaiRow?.reconciliation?.reason).not.toContain("Other Hospital");
    expect(otherHospitalRow?.reconciliation?.reason).toContain("Other Hospital");
    expect(otherHospitalRow?.reconciliation?.reason).not.toContain("The Mount Sinai Hospital");
  });
});
