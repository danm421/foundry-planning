import { describe, it, expect } from "vitest";
import { money, pct, yearWithRef, joinSegments, ENUM_LABELS } from "../labels";

describe("labels helpers", () => {
  it("money formats compact USD and coerces decimal strings", () => {
    expect(money(150000)).toBe("$150k");
    expect(money("100000.00")).toBe("$100k");
    expect(money(null)).toBe("—");
  });
  it("pct formats a 0–1 fraction as whole percent", () => {
    expect(pct(0.065)).toBe("6.5%");
    expect(pct(1)).toBe("100%");
    expect(pct(null)).toBe("—");
  });
  it("yearWithRef annotates a resolved year with its milestone label", () => {
    expect(yearWithRef(2031, "client_retirement")).toBe("2031 (Client Retirement)");
    expect(yearWithRef(2031, null)).toBe("2031");
    expect(yearWithRef(undefined, null)).toBe("—");
  });
  it("joinSegments drops empties and joins with the separator", () => {
    expect(joinSegments(["a", "", null, "b"])).toBe("a · b");
  });
  it("ENUM_LABELS maps known enum values", () => {
    expect(ENUM_LABELS.conversionType.fixed_amount).toBe("Fixed amount");
    expect(ENUM_LABELS.transferMode.one_time).toBe("One-time");
  });
});
