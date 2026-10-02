import { describe, it, expect } from "vitest";
import {
  DETAIL_TYPES,
  DETAIL_GROUP_ORDER,
  detailType,
  detailEditorTarget,
} from "../plan-detail-catalog";

describe("plan detail catalog", () => {
  it("has one row per type key, each in a known group", () => {
    const keys = DETAIL_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(27);
    for (const t of DETAIL_TYPES) expect(DETAIL_GROUP_ORDER).toContain(t.group);
  });

  it("singletons are edit-only", () => {
    for (const k of [
      "social_security",
      "tax_rates",
      "growth_inflation",
      "savings_withdrawals",
      "client_info",
    ] as const) {
      expect(detailType(k)).toMatchObject({ add: false, edit: true, delete: false });
    }
  });

  it("routes a create with its variant", () => {
    expect(detailEditorTarget("account", { intent: "create", variant: "cash" })).toEqual({
      surface: "details",
      page: "net-worth",
      focus: { intent: "create", kind: "account", variant: "cash" },
    });
    expect(detailEditorTarget("business", { intent: "create" }).focus).toEqual({
      intent: "create",
      kind: "account",
      variant: "business",
    });
  });

  it("routes assumptions singletons to their tab", () => {
    expect(detailEditorTarget("growth_inflation", { intent: "edit", id: "ignored" })).toEqual({
      surface: "details",
      page: "assumptions",
      focus: { intent: "edit", kind: "plan_settings", id: "growth-inflation" },
    });
  });

  it("routes a delete", () => {
    expect(detailEditorTarget("expense", { intent: "delete", id: "e1" }).focus).toEqual({
      intent: "delete",
      kind: "expense",
      id: "e1",
    });
  });
});
