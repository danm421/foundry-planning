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
      resolveChangeEditor(change({ opType: "remove", payload: null }), CLIENT_ID),
    ).toBeNull();
  });

  it("returns null for a disabled change", () => {
    expect(resolveChangeEditor(change({ enabled: false }), CLIENT_ID)).toBeNull();
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
        resolveChangeEditor(change({ targetKind, targetId: "row-42" }), CLIENT_ID),
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
        CLIENT_ID,
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
    expect(resolveChangeEditor(change({ targetKind }), CLIENT_ID)).toBeNull();
  });

  describe("plan_settings", () => {
    it("planEndYear alone -> family/client with the supplied clientId", () => {
      expect(
        resolveChangeEditor(
          change({
            targetKind: "plan_settings",
            targetId: "plan-settings-row",
            payload: { planEndYear: { from: 2060, to: 2065 } },
          }),
          CLIENT_ID,
        ),
      ).toEqual({
        surface: "details",
        page: "family",
        focus: { kind: "client", id: CLIENT_ID },
      });
    });

    it("a single stress field -> the Solver's Stress tab", () => {
      expect(
        resolveChangeEditor(
          change({
            targetKind: "plan_settings",
            payload: { livingExpenseInflationOverride: { from: null, to: 0.04 } },
          }),
          CLIENT_ID,
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
          CLIENT_ID,
        ),
      ).toEqual({ surface: "solver-tab", tab: "stress_test" });
    });

    it("a stress field mixed with planEndYear -> family/client, not the Stress tab", () => {
      expect(
        resolveChangeEditor(
          change({
            targetKind: "plan_settings",
            payload: {
              marketShock: { from: null, to: { year: 2028, drawdownPct: 0.3 } },
              planEndYear: { from: 2060, to: 2065 },
            },
          }),
          CLIENT_ID,
        ),
      ).toEqual({
        surface: "details",
        page: "family",
        focus: { kind: "client", id: CLIENT_ID },
      });
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
          CLIENT_ID,
        ),
      ).toBeNull();
    });

    it("an empty-object payload -> null", () => {
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", payload: {} }),
          CLIENT_ID,
        ),
      ).toBeNull();
    });

    it("a non-object payload -> null", () => {
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", payload: "not-an-object" }),
          CLIENT_ID,
        ),
      ).toBeNull();
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", payload: null }),
          CLIENT_ID,
        ),
      ).toBeNull();
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", payload: ["planEndYear"] }),
          CLIENT_ID,
        ),
      ).toBeNull();
    });

    it("a removed or disabled plan_settings edit is still null", () => {
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", opType: "remove", payload: null }),
          CLIENT_ID,
        ),
      ).toBeNull();
      expect(
        resolveChangeEditor(
          change({ targetKind: "plan_settings", enabled: false }),
          CLIENT_ID,
        ),
      ).toBeNull();
    });
  });
});
