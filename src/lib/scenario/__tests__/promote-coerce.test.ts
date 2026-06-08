import { describe, it, expect } from "vitest";
import { accounts } from "@/db/schema";
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
});
