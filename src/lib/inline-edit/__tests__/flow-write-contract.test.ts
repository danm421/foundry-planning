// Contract tests for the Cash Flow board's inline amount editor: do the payloads
// `flow-write.ts` builds actually get ACCEPTED by the validators they are sent to?
//
// `flow-write.test.ts` next door asserts the payloads' SHAPE. Every assertion
// there is against this module's own output, so a route tightening its schema —
// `annualAmount` going `z.number()`, `savings_rule` becoming nested-only — leaves
// it fully green while every inline save 400s in the browser. That is a failure
// mode this app has shipped before (a revocable-trust account upsert 400'd on a
// too-strict schema), and it is invisible to a unit test that never imports the
// thing on the other end of the fetch.
//
// So these import the REAL validators and drive the REAL payloads through them.

import { describe, it, expect } from "vitest";
import {
  buildFlowScenarioDesiredFields,
  buildFlowScenarioFields,
  flowAmountPatch,
  ssClaimAgePatch,
} from "../flow-write";
import { incomeUpdateSchema } from "@/lib/schemas/incomes";
import { expenseUpdateSchema } from "@/lib/schemas/expenses";
import { TARGET_KIND_TO_FIELD } from "@/engine/scenario/applyChanges";
import type { Income } from "@/engine/types";

// ── Base mode ───────────────────────────────────────────────────────────────
// `useScenarioWriter` sends `flowAmountPatch(next)` as the entire PUT body, so
// the update schemas have to accept a body carrying nothing else.

describe("base-mode PUT body vs the real update schemas", () => {
  it("incomeUpdateSchema accepts the lone-amount patch and preserves the value", () => {
    const parsed = incomeUpdateSchema.safeParse(flowAmountPatch(275000));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.annualAmount).toBe("275000");
  });

  it("expenseUpdateSchema accepts the lone-amount patch and preserves the value", () => {
    const parsed = expenseUpdateSchema.safeParse(flowAmountPatch(14400));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.annualAmount).toBe("14400");
  });

  // The editor's own `Math.abs` is upstream of this, but the schema is the last
  // line of defence: `annualAmount` is unsigned on all three tables, so a
  // negative reaching the column flips an expense into an inflow for the whole
  // projection.
  it("the patch a negative input produces is non-negative once parsed", () => {
    const parsed = expenseUpdateSchema.safeParse(flowAmountPatch(-14400));
    expect(parsed.success).toBe(true);
    expect(Number(parsed.success && parsed.data.annualAmount)).toBeGreaterThanOrEqual(0);
  });

  // The claim-age patch is the one inline payload whose three keys all go through
  // per-field COERCERS rather than straight through: `claimingAgeOptional` maps
  // anything falsy to null, `claimingAgeMonthsOptional` runs a Number(), and
  // `claimingAgeMode` is a bare nullable string. Reading the schema says they are
  // accepted; only parsing says they arrive intact. A `claimingAgeMonths` coerced
  // to null or a dropped `claimingAgeMode` both return 200 and leave the claim age
  // exactly where it was.
  it("incomeUpdateSchema accepts the lone claim-age patch and preserves all three columns", () => {
    const parsed = incomeUpdateSchema.safeParse(ssClaimAgePatch(67.5));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.claimingAge).toBe(67);
    expect(parsed.success && parsed.data.claimingAgeMonths).toBe(6);
    expect(parsed.success && parsed.data.claimingAgeMode).toBe("years");
  });

  // The whole-year case is the one the coercers can eat: `claimingAgeMonths: 0` is
  // falsy, and a `?? null`-style guard on it would strip the column that decides
  // whether the claim is at 67y 0mo or keeps a stale 6mo.
  it("preserves a ZERO month count rather than dropping it as falsy", () => {
    const parsed = incomeUpdateSchema.safeParse(ssClaimAgePatch(67));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.claimingAgeMonths).toBe(0);
    expect(parsed.success && parsed.data.claimingAge).toBe(67);
  });
});

// ── Scenario mode ───────────────────────────────────────────────────────────

describe("scenario-mode payload vs the changes route's writable kinds", () => {
  // `POST /scenarios/[sid]/changes` builds its `targetKind` enum from
  // `TARGET_KIND_TO_FIELD`, and `lookupBaseEntity` THROWS for any kind mapping to
  // `null` (nested-only). Both of the board's write paths depend on all three
  // kinds being present AND top-level: the enum rejects an unknown kind with a
  // 400, the null mapping surfaces as a 500.
  it.each([
    ["income", "incomes"],
    ["expense", "expenses"],
    ["savings_rule", "savingsRules"],
  ])("%s is a writable, top-level target kind", (kind, field) => {
    expect(TARGET_KIND_TO_FIELD).toHaveProperty(kind);
    expect(TARGET_KIND_TO_FIELD[kind as keyof typeof TARGET_KIND_TO_FIELD]).toBe(field);
  });

  // The route validates `desiredFields` as `z.record(z.string(), z.unknown())`,
  // so the risk is not rejection but silent loss: JSON.stringify drops any key
  // whose value is `undefined`, which is exactly what `buildFlowScenarioFields`
  // exists to prune ahead of time. If a raw engine row were ever sent instead,
  // the wire payload and the object would disagree about which fields the
  // scenario is overriding.
  it("survives the JSON round-trip the fetch performs, losing no key", () => {
    // `claimingAge: undefined` is not decoration — it is what the engine
    // resolvers emit (`x ?? undefined`) for every absent optional column, and it
    // is the only input that makes this assertion discriminating. Without the
    // prune, the payload OBJECT carries the key and the WIRE does not, so the two
    // key sets diverge and the scenario silently disagrees with itself about
    // which fields it overrides.
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
      claimingAge: undefined,
    };
    const payload = buildFlowScenarioDesiredFields(
      buildFlowScenarioFields(income),
      flowAmountPatch(275000),
    );

    expect(payload).not.toHaveProperty("claimingAge");

    const overTheWire = JSON.parse(JSON.stringify(payload));
    expect(Object.keys(overTheWire).sort()).toEqual(Object.keys(payload).sort());
    expect(overTheWire.isSelfEmployment).toBe(true);
    expect(overTheWire.endYearRef).toBe("client_retirement");
    expect(overTheWire.annualAmount).toBe("275000");
  });
});
