import { describe, it, expect } from "vitest";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import {
  DETAIL_TYPES,
  DETAIL_GROUP_ORDER,
  detailType,
  detailEditorTarget,
  NOT_YET_READY,
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

  it("trust / entity has no Add: its create form refuses to save inside a scenario", () => {
    expect(detailType("trust")).toMatchObject({ add: false, edit: true, delete: true });
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

describe("will variants", () => {
  it("name the two grantors Client and the co-client label, never Spouse", () => {
    expect(detailType("will").variants).toEqual([
      { value: "client", label: "Client" },
      { value: "spouse", label: CO_CLIENT_LABEL },
    ]);
  });
});

describe("NOT_YET_READY", () => {
  it("lists only real catalog keys", () => {
    const keys = new Set(DETAIL_TYPES.map((t) => t.key));
    for (const k of NOT_YET_READY) expect(keys.has(k)).toBe(true);
  });

  it("holds the types whose workstream is still open", () => {
    expect([...NOT_YET_READY].sort()).toEqual(
      [
        "note_receivable", "gift_series",
        "family_member", "external_beneficiary",
      ].sort(),
    );
  });
});
