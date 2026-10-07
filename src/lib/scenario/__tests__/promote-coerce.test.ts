import { describe, it, expect } from "vitest";
import { accounts, expenses, incomes } from "@/db/schema";
import { coerceForTable } from "../promote-coerce";

describe("coerceForTable", () => {
  it("stringifies numeric (decimal) columns and drops unknown keys", () => {
    const out = coerceForTable(accounts, {
      name: "Brokerage",
      value: 1000, // numeric column → must become a string
      growthRate: 0.06, // numeric column → string
      bogusKey: "nope", // not a column → dropped
    });
    expect(out.name).toBe("Brokerage");
    expect(out.value).toBe("1000");
    expect(out.growthRate).toBe("0.06");
    expect("bogusKey" in out).toBe(false);
  });

  it("passes null through and leaves integer/enum/text columns untouched", () => {
    const out = coerceForTable(accounts, { growthRate: null, subType: "brokerage" });
    expect(out.growthRate).toBeNull();
    expect(out.subType).toBe("brokerage");
  });

  // Guard for the generic promote path (unlike save-to-base's hand-enumerated
  // column lists, this walks getTableColumns and so already carries any new
  // column by default) — pins that behavior for paymentMonth so a future
  // rewrite of this coercer can't silently narrow it back to a fixed list.
  it("carries paymentMonth through untouched, like any other integer column", () => {
    const out = coerceForTable(incomes, { name: "Consulting", paymentMonth: 6 });
    expect(out.paymentMonth).toBe(6);
  });

  // Promote-to-base walks getTableColumns, so the jsonb column rides along with
  // no per-kind mapper. Pinned so a rewrite can't narrow it to a fixed list.
  it("carries livingItems through untouched, like any other jsonb column", () => {
    const items = [{ id: "i1", name: "Housing", amount: 3200, frequency: "monthly" }];
    const out = coerceForTable(expenses, { name: "Current Living Expenses", livingItems: items });
    expect(out.livingItems).toEqual(items);
  });
});
