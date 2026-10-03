import { describe, it, expect } from "vitest";
import { withRidersFollowingTheirBusiness, withoutBusinessCashRiders } from "../business-cash-rider";

const add = (targetId: string, payload: Record<string, unknown>, targetKind = "account") => ({
  opType: "add",
  targetKind,
  targetId,
  payload: { id: targetId, ...payload },
});

describe("withoutBusinessCashRiders", () => {
  const business = add("biz", { name: "Acme", category: "business" });
  const cash = add("cash", { name: "Acme — Cash", parentAccountId: "biz", isDefaultChecking: true });

  it("folds a scenario business's default cash into the business", () => {
    expect(withoutBusinessCashRiders([business, cash])).toEqual([business]);
  });

  it("keeps the business's other children", () => {
    const reserve = add("res", { name: "Acme Reserve", parentAccountId: "biz" });
    expect(withoutBusinessCashRiders([business, cash, reserve])).toEqual([business, reserve]);
  });

  it("keeps an orphaned cash row whose business is not added here, so it can still be deleted", () => {
    expect(withoutBusinessCashRiders([cash])).toEqual([cash]);
  });

  it("keeps edits and removes of a cash account", () => {
    const edit = { ...cash, opType: "edit" };
    expect(withoutBusinessCashRiders([business, edit])).toEqual([business, edit]);
  });
});

describe("withRidersFollowingTheirBusiness", () => {
  const row = (base: ReturnType<typeof add>, enabled: boolean, toggleGroupId: string | null) => ({
    ...base,
    enabled,
    toggleGroupId,
  });
  const business = row(add("biz", { name: "Acme", category: "business" }), false, "g1");

  it("gives the cash its business's switch and group", () => {
    const cash = row(add("cash", { parentAccountId: "biz", isDefaultChecking: true }), true, null);
    expect(withRidersFollowingTheirBusiness([cash, business])[0]).toMatchObject({
      targetId: "cash",
      enabled: false,
      toggleGroupId: "g1",
    });
  });

  it("leaves the business's other children and orphaned cash alone", () => {
    const reserve = row(add("res", { parentAccountId: "biz" }), true, null);
    const orphan = row(add("orphan", { parentAccountId: "gone", isDefaultChecking: true }), true, null);
    expect(withRidersFollowingTheirBusiness([business, reserve, orphan])).toEqual([business, reserve, orphan]);
  });
});
