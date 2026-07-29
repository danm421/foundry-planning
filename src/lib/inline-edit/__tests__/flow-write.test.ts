import { describe, it, expect } from "vitest";
import {
  buildFlowScenarioDesiredFields,
  buildFlowScenarioFields,
  flowAmountPatch,
  flowYearPatch,
} from "../flow-write";
import type { FlowPatch } from "../flow-write";
import type { Expense, Income, SavingsRule } from "@/engine/types";

describe("buildFlowScenarioFields", () => {
  it("strips `id` — identity is never data", () => {
    const out = buildFlowScenarioFields({ id: "inc-1", name: "Salary", annualAmount: 250000 });
    expect(out).not.toHaveProperty("id");
    expect(out).toEqual({ name: "Salary", annualAmount: 250000 });
  });

  // `scheduleOverrides` has its own targetKind (income_schedule_override et al),
  // so copying the effective schedule into the parent row's payload would leave
  // two change rows claiming the same year-by-year amounts.
  it("strips `scheduleOverrides` even when the row has a populated one", () => {
    const out = buildFlowScenarioFields({
      id: "inc-1",
      annualAmount: 250000,
      scheduleOverrides: { 2026: 20000, 2027: 21000 },
    });
    expect(out).not.toHaveProperty("scheduleOverrides");
    expect(out).toEqual({ annualAmount: 250000 });
  });

  // The engine resolvers write `x ?? undefined` for every absent optional
  // column. An explicit `undefined` in desiredFields would diff against a base
  // `null` as a change and write undefined over it.
  it("drops undefined values but KEEPS null and false", () => {
    const out = buildFlowScenarioFields({
      id: "exp-1",
      claimingAge: undefined,
      deductionType: null,
      isDefault: false,
      endYear: 0,
    });
    expect(out).not.toHaveProperty("claimingAge");
    expect(out).toEqual({ deductionType: null, isDefault: false, endYear: 0 });
  });

  // The whole reason this takes the ENGINE row and not `ExpenseView`: the view
  // has no `endsAtMedicareEligibilityOwner`, so a view-sourced payload would drop
  // the flag that stops a pre-Medicare health expense double-counting against
  // modeled Medicare premiums. Same class of gap as SavingsRule's
  // `fundFromExpenseReduction` below.
  it("carries the engine-only fields the view types drop (expense)", () => {
    const expense: Expense = {
      id: "exp-1",
      type: "living",
      name: "Health insurance",
      annualAmount: 14400,
      startYear: 2026,
      endYear: 2050,
      growthRate: 0.03,
      endsAtMedicareEligibilityOwner: "client",
    };
    expect(buildFlowScenarioFields(expense).endsAtMedicareEligibilityOwner).toBe("client");
  });

  it("carries the engine-only fields the view types drop (savings rule)", () => {
    const rule: SavingsRule = {
      id: "sav-1",
      accountId: "acct-1",
      annualAmount: 12000,
      isDeductible: true,
      startYear: 2026,
      endYear: 2035,
      fundFromExpenseReduction: true,
    };
    expect(buildFlowScenarioFields(rule).fundFromExpenseReduction).toBe(true);
  });
});

describe("flowAmountPatch", () => {
  it("stringifies the amount — the routes and the diff both compare numeric strings", () => {
    expect(flowAmountPatch(250000)).toEqual({ annualAmount: "250000" });
  });

  // DISCRIMINATING: outflow cards render in accounting parens, so a minus sign is
  // exactly what an advisor reaches for when they mean "this is an expense".
  // `annualAmount` is unsigned on all three tables — a negative would turn the
  // expense into an inflow for the whole projection.
  it("drops the sign, keeps the magnitude", () => {
    expect(flowAmountPatch(-5000)).toEqual({ annualAmount: "5000" });
  });

  it("passes zero through as '0', not '-0'", () => {
    expect(flowAmountPatch(-0)).toEqual({ annualAmount: "0" });
  });
});

describe("buildFlowScenarioDesiredFields", () => {
  // The payload is a WHOLESALE replace of the scenario_changes row, so anything
  // absent here is an override this scenario silently loses.
  it("overrides the amount and preserves every other field of the row", () => {
    const income: Income = {
      id: "inc-1",
      type: "salary",
      name: "Cooper's Salary",
      annualAmount: 250000,
      startYear: 2026,
      endYear: 2035,
      growthRate: 0.03,
      owner: "client",
      isSelfEmployment: true,
      endYearRef: "client_retirement",
    };
    const fields = buildFlowScenarioFields(income);

    const out = buildFlowScenarioDesiredFields(fields, flowAmountPatch(275000));

    expect(out.annualAmount).toBe("275000");
    // The scenario's own endYear override and the SECA flag both survive.
    expect(out.endYearRef).toBe("client_retirement");
    expect(out.isSelfEmployment).toBe(true);
    expect(out.owner).toBe("client");
    expect(out.name).toBe("Cooper's Salary");
  });

  it("does not mutate the field set it was handed", () => {
    const fields = { annualAmount: 250000, name: "Salary" };
    buildFlowScenarioDesiredFields(fields, flowAmountPatch(1));
    expect(fields.annualAmount).toBe(250000);
  });
});

describe("FlowPatch rejects account-only growth fields", () => {
  it("does not accept model/ticker portfolio ids or an account growthSource", () => {
    // Flows store growthSource via `itemGrowthSourceEnum` = ["custom","inflation"] only
    // (src/db/schema.ts:478-481). The account enum (:429-437) is the one with
    // model_portfolio / ticker_portfolio. These directives are the assertion: if any
    // of these became assignable again, tsc fails with "Unused '@ts-expect-error'".

    // @ts-expect-error flows have no model_portfolio growth source
    const a: FlowPatch = { growthSource: "model_portfolio" };
    // @ts-expect-error flows have no ticker_portfolio growth source
    const b: FlowPatch = { growthSource: "ticker_portfolio" };
    // @ts-expect-error flows have no model_portfolio_id column
    const c: FlowPatch = { modelPortfolioId: "mp-1" };
    // @ts-expect-error flows have no ticker_portfolio_id column
    const d: FlowPatch = { tickerPortfolioId: "tp-1" };

    // Reference them so no-unused-vars stays quiet; the assertion is the directives.
    expect([a, b, c, d]).toHaveLength(4);
  });

  it("still accepts the two growth sources flows really have", () => {
    const custom: FlowPatch = { growthSource: "custom" };
    const inflation: FlowPatch = { growthSource: "inflation" };
    expect([custom.growthSource, inflation.growthSource]).toEqual(["custom", "inflation"]);
  });
});

describe("flowYearPatch", () => {
  it("emits the start pair", () => {
    expect(flowYearPatch("start", 2035, "client_retirement")).toEqual({
      startYear: 2035,
      startYearRef: "client_retirement",
    });
  });

  it("emits the end pair", () => {
    expect(flowYearPatch("end", 2059, "client_end")).toEqual({
      endYear: 2059,
      endYearRef: "client_end",
    });
  });

  it("emits an EXPLICIT null ref when un-anchoring", () => {
    // null is a REAL value here: "manual year, not anchored". If it were
    // stripped the way growthRate: null is, the old ref would persist and keep
    // dragging the year with it — un-anchoring would be impossible.
    expect(flowYearPatch("start", 2042, null)).toEqual({
      startYear: 2042,
      startYearRef: null,
    });
  });
});

describe("the null rule is per field, not global", () => {
  const effective = {
    id: "inc-1",
    name: "Salary",
    annualAmount: "200000",
    startYear: 2026,
    startYearRef: "plan_start",
    endYear: 2035,
    endYearRef: "client_retirement",
    owner: "client",
    growthRate: "0.03",
  };

  it("carries startYearRef: null through to the scenario payload", () => {
    const fields = buildFlowScenarioFields(effective);
    const out = buildFlowScenarioDesiredFields(fields, flowYearPatch("start", 2030, null));
    expect(out).toHaveProperty("startYearRef", null);
    expect(out.startYear).toBe(2030);
  });

  it("carries endYearRef: null through to the scenario payload", () => {
    const fields = buildFlowScenarioFields(effective);
    const out = buildFlowScenarioDesiredFields(fields, flowYearPatch("end", 2050, null));
    expect(out).toHaveProperty("endYearRef", null);
    expect(out.endYear).toBe(2050);
  });

  it("retains unrelated fields when only the owner changes", () => {
    const fields = buildFlowScenarioFields(effective);
    const out = buildFlowScenarioDesiredFields(fields, { owner: "spouse" });
    expect(out.owner).toBe("spouse");
    expect(out.annualAmount).toBe("200000");
    expect(out.startYearRef).toBe("plan_start");
    expect(out.endYearRef).toBe("client_retirement");
    expect(out.growthRate).toBe("0.03");
  });
});
