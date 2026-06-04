import { describe, it, expect } from "vitest";
import { nameFor, fieldLabel, fmtValue } from "../describe/format";

describe("describe/format", () => {
  it("nameFor resolves the target name map", () => {
    const names = { "income:abc": "Rental income" };
    expect(nameFor({ targetKind: "income", targetId: "abc" }, names)).toBe("Rental income");
    expect(nameFor({ targetKind: "income", targetId: "zzz" }, names)).toBeNull();
  });

  it("fieldLabel maps known fields and humanizes the rest", () => {
    expect(fieldLabel("retirementAge")).toBe("Retirement age");
    expect(fieldLabel("monthlyAmount")).toBe("Monthly amount");
    expect(fieldLabel("some_other_field")).toBe("Some other field");
  });

  it("fmtValue formats years, money, booleans, and nullish", () => {
    expect(fmtValue(2030)).toBe("2030");
    expect(fmtValue(95000)).toBe("$95k");
    expect(fmtValue(62)).toBe("62");
    expect(fmtValue(true)).toBe("Yes");
    expect(fmtValue(null)).toBe("—");
    expect(fmtValue("")).toBe("—");
  });
});

import { describeFromSpec } from "../describe/generic";
import { SPEC } from "../describe/specs";
import type { ScenarioChange } from "@/engine/scenario/types";

function change(partial: Partial<ScenarioChange>): ScenarioChange {
  return {
    id: "c1", scenarioId: "s1", opType: "edit", targetKind: "income",
    targetId: "abc", payload: null, toggleGroupId: null, orderIndex: 0,
    ...partial,
  };
}

describe("describeFromSpec", () => {
  const ctx = { targetNames: { "income:abc": "Rental income" } };

  it("builds an add row", () => {
    const row = describeFromSpec(change({ opType: "add", payload: {} }), ctx, SPEC.income);
    expect(row).toMatchObject({ area: "Income", what: "+ Rental income", op: "add", before: "—", after: "Added" });
  });

  it("builds a remove row", () => {
    const row = describeFromSpec(change({ opType: "remove", payload: null }), ctx, SPEC.income);
    expect(row).toMatchObject({ op: "remove", after: "Removed", what: "Rental income" });
  });

  it("builds a single-field edit row in name mode", () => {
    const row = describeFromSpec(
      change({ opType: "edit", payload: { monthlyAmount: { from: 1500, to: 2000 } } }),
      ctx, SPEC.income,
    );
    expect(row).toMatchObject({ what: "Rental income · Monthly amount", before: "$1.5k", after: "$2.0k", op: "edit" });
  });

  it("builds a single-field edit row in field mode (no entity name)", () => {
    const row = describeFromSpec(
      change({ targetKind: "client", targetId: "p1", opType: "edit", payload: { retirementAge: { from: 65, to: 62 } } }),
      { targetNames: {} }, SPEC.client,
    );
    expect(row).toMatchObject({ what: "Retirement age", before: "65", after: "62", area: "Plan & Assumptions" });
  });

  it("collapses a multi-field edit", () => {
    const row = describeFromSpec(
      change({ opType: "edit", payload: { monthlyAmount: { from: 1, to: 2 }, startYear: { from: 2030, to: 2031 } } }),
      ctx, SPEC.income,
    );
    expect(row).toMatchObject({ what: "Rental income", before: "—", after: "Updated" });
    expect(row.detail.join(" ")).toContain("Monthly amount");
  });

  it("falls back to a capitalized noun when no name is known", () => {
    const row = describeFromSpec(change({ targetId: "zzz", opType: "add", payload: {} }), { targetNames: {} }, SPEC.income);
    expect(row.what).toBe("+ Income source");
  });
});

import { describeChange } from "../describe";

describe("describeChange", () => {
  it("dispatches a known kind via the spec table", () => {
    const row = describeChange(
      change({ targetKind: "roth_conversion", targetId: "r1", opType: "add", payload: {} }),
      { targetNames: { "roth_conversion:r1": "Roth ladder 2026–2030" } },
    );
    expect(row).toMatchObject({ area: "Taxes", what: "+ Roth ladder 2026–2030", op: "add" });
  });

  it("falls back gracefully for an unknown kind", () => {
    const row = describeChange(
      change({ targetKind: "totally_new_kind" as never, targetId: "x", opType: "add", payload: {} }),
      { targetNames: {} },
    );
    expect(row.op).toBe("add");
    expect(row.what.length).toBeGreaterThan(0);
  });
});
