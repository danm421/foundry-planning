import { describe, it, expect } from "vitest";
import {
  resolveChangeEditor,
  type ChangeEditorInput,
  type DetailsEditorPage,
} from "./change-editor-target";
import type { TargetKind } from "@/engine/scenario/types";

const CLIENT_ID = "client-1";

function change(overrides: Partial<ChangeEditorInput>): ChangeEditorInput {
  return {
    opType: "edit",
    targetKind: "income",
    targetId: "target-1",
    payload: { name: { from: "Old", to: "New" } },
    enabled: true,
    ...overrides,
  };
}

describe("resolveChangeEditor", () => {
  it("returns null for a remove", () => {
    expect(
      resolveChangeEditor(change({ opType: "remove", payload: null })),
    ).toBeNull();
  });

  it("returns null for a disabled change", () => {
    expect(resolveChangeEditor(change({ enabled: false }))).toBeNull();
  });

  const mapped: Array<[TargetKind, DetailsEditorPage]> = [
    ["income", "income-expenses"],
    ["expense", "income-expenses"],
    ["savings_rule", "income-expenses"],
    ["account", "net-worth"],
    ["liability", "net-worth"],
    ["roth_conversion", "techniques"],
    ["reinvestment", "techniques"],
    ["relocation", "techniques"],
    ["asset_transaction", "techniques"],
    ["transfer", "techniques"],
    ["client", "family"],
    ["family_member", "family"],
    ["entity", "family"],
    ["gift", "family"],
    ["external_beneficiary", "family"],
    ["will", "wills"],
    ["client_deduction", "assumptions"],
    ["client_tax_adjustment", "assumptions"],
    ["withdrawal_strategy", "assumptions"],
  ];

  it.each(mapped)(
    "%s -> details/%s with focus = { kind: targetKind, id: targetId }",
    (targetKind, page) => {
      expect(
        resolveChangeEditor(change({ targetKind, targetId: "row-42" })),
      ).toEqual({
        surface: "details",
        page,
        focus: { kind: targetKind, id: "row-42" },
      });
    },
  );

  it("resolves an add the same way as an edit", () => {
    expect(
      resolveChangeEditor(
        change({
          opType: "add",
          targetKind: "gift",
          targetId: "g1",
          payload: { id: "g1", name: "Gift" },
        }),
      ),
    ).toEqual({
      surface: "details",
      page: "family",
      focus: { kind: "gift", id: "g1" },
    });
  });

  // Child kinds are never written as their own change row (they live nested
  // under a parent entity's payload) — the resolver still has to handle them
  // gracefully since the input is only structurally typed.
  const childKinds: TargetKind[] = [
    "beneficiary_designation",
    "expense_schedule_override",
    "extra_payment",
    "income_schedule_override",
    "life_insurance_cash_value_schedule",
    "life_insurance_policy",
    "savings_schedule_override",
    "transfer_schedule",
    "will_bequest",
    "will_bequest_recipient",
  ];

  it.each(childKinds)("%s (a child row) has no standalone editor target", (targetKind) => {
    expect(resolveChangeEditor(change({ targetKind }))).toBeNull();
  });

  describe("plan_settings", () => {
    it("planEndYear alone -> the Solver's Retirement tab", () => {
      expect(
        resolveChangeEditor(
          change({
            targetKind: "plan_settings",
            targetId: "plan-settings-row",
            payload: { planEndYear: { from: 2060, to: 2065 } },
          }),
        ),
      ).toEqual({ surface: "solver-tab", tab: "retirement" });
    });

    it("a single stress field -> the Solver's Stress tab", () => {
      expect(
        resolveChangeEditor(
          change({
            targetKind: "plan_settings",
            payload: { livingExpenseInflationOverride: { from: null, to: 0.04 } },
          }),
        ),
      ).toEqual({ surface: "solver-tab", tab: "stress_test" });
    });

    it("every stress field changed in one payload -> the Stress tab", () => {
      expect(
        resolveChangeEditor(
          change({
            targetKind: "plan_settings",
            payload: {
              livingExpenseInflationOverride: { from: null, to: 0.04 },
              ssBenefitHaircut: { from: null, to: { pct: 0.2, startYear: 2030 } },
              disabilityEvent: {
                from: null,
                to: { person: "client", startYear: 2030, endYear: 2035 },
              },
              marketShock: { from: null, to: { year: 2028, drawdownPct: 0.3 } },
              lifetimeExemptionCap: { from: null, to: 5_000_000 },
              taxRateStress: { from: null, to: { points: [], startYear: 2030 } },
            },
          }),
        ),
      ).toEqual({ surface: "solver-tab", tab: "stress_test" });
    });

    it("a stress field mixed with planEndYear -> the Retirement tab, not the Stress tab", () => {
      expect(
        resolveChangeEditor(
          change({
            targetKind: "plan_settings",
            payload: {
              marketShock: { from: null, to: { year: 2028, drawdownPct: 0.3 } },
              planEndYear: { from: 2060, to: 2065 },
            },
          }),
        ),
      ).toEqual({ surface: "solver-tab", tab: "retirement" });
    });

    it("a stress field mixed with an unrelated non-stress field -> null", () => {
      expect(
        resolveChangeEditor(
          change({
            targetKind: "plan_settings",
            payload: {
              marketShock: { from: null, to: { year: 2028, drawdownPct: 0.3 } },
              filingStatus: { from: "single", to: "married" },
            },
          }),
        ),
      ).toBeNull();
    });

    it("an empty-object payload -> null", () => {
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", payload: {} }),
        ),
      ).toBeNull();
    });

    it("a non-object payload -> null", () => {
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", payload: "not-an-object" }),
        ),
      ).toBeNull();
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", payload: null }),
        ),
      ).toBeNull();
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", payload: ["planEndYear"] }),
        ),
      ).toBeNull();
    });

    it("a removed or disabled plan_settings edit is still null", () => {
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", opType: "remove", payload: null }),
        ),
      ).toBeNull();
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", enabled: false }),
        ),
      ).toBeNull();
    });
  });

  // Ruling T4d-horizon: the client fields the Solver's Retirement tab writes
  // open that tab; anything else stays on the Family page's client dialog.
  describe("client", () => {
    const clientChange = (payload: unknown) =>
      change({ targetKind: "client", targetId: CLIENT_ID, payload });
    const family = { surface: "details", page: "family", focus: { kind: "client", id: CLIENT_ID } };
    const retirementTab = { surface: "solver-tab", tab: "retirement" };

    it("{ lifeExpectancy, planEndAge } (a Solver life-expectancy save) -> the Retirement tab", () => {
      expect(
        resolveChangeEditor(
          clientChange({
            lifeExpectancy: { from: 90, to: 95 },
            planEndAge: { from: 90, to: 95 },
          }),
        ),
      ).toEqual(retirementTab);
    });

    it("{ retirementAge } -> the Retirement tab", () => {
      expect(
        resolveChangeEditor(clientChange({ retirementAge: { from: 65, to: 67 } })),
      ).toEqual(retirementTab);
    });

    it("every Retirement-tab field at once (both spouses) -> the Retirement tab", () => {
      expect(
        resolveChangeEditor(
          clientChange({
            retirementAge: { from: 65, to: 67 },
            retirementMonth: { from: 1, to: 6 },
            spouseRetirementAge: { from: 65, to: 66 },
            spouseRetirementMonth: { from: 1, to: 3 },
            lifeExpectancy: { from: 90, to: 95 },
            spouseLifeExpectancy: { from: 92, to: 94 },
            planEndAge: { from: 92, to: 95 },
          }),
        ),
      ).toEqual(retirementTab);
    });

    it("{ firstName } -> family/client with the change's targetId", () => {
      expect(
        resolveChangeEditor(clientChange({ firstName: { from: "Al", to: "Alice" } })),
      ).toEqual(family);
    });

    it("a Retirement-tab field mixed with any other field -> family/client", () => {
      expect(
        resolveChangeEditor(
          clientChange({
            lifeExpectancy: { from: 90, to: 95 },
            dateOfBirth: { from: "1960-01-01", to: "1961-01-01" },
          }),
        ),
      ).toEqual(family);
    });

    it("an empty or non-object payload -> family/client", () => {
      expect(resolveChangeEditor(clientChange({}))).toEqual(family);
      expect(resolveChangeEditor(clientChange(null))).toEqual(family);
      expect(resolveChangeEditor(clientChange(["retirementAge"]))).toEqual(family);
    });

    it("a removed or disabled client edit is still null", () => {
      expect(
        resolveChangeEditor(
          change({ targetKind: "client", opType: "remove", payload: null }),
        ),
      ).toBeNull();
      expect(
        resolveChangeEditor(
          change({ targetKind: "client", enabled: false, payload: { retirementAge: { from: 65, to: 67 } } }),
        ),
      ).toBeNull();
    });
  });
});
