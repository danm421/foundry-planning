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
