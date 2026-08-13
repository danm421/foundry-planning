import { describe, it, expect } from "vitest";
import { fmtValue } from "../format";

describe("fmtValue — a value that is not a scalar", () => {
  // THE RED. Reproduced on the Warner household 2026-08-12: six of seven
  // strategy cards printed this on a client page.
  it("never renders an object as [object Object]", () => {
    expect(fmtValue([{ id: "a" }, { id: "b" }])).not.toContain("[object Object]");
  });

  it("renders an array of objects as a neutral placeholder", () => {
    expect(fmtValue([{ id: "a" }, { id: "b" }])).toBe("—");
  });

  it("renders a bare object as the same placeholder", () => {
    expect(fmtValue({ id: "a" })).toBe("—");
  });

  it("still renders an array of strings by joining them", () => {
    expect(fmtValue(["Cooper", "Susan"])).toBe("Cooper, Susan");
  });

  it("leaves every scalar exactly as it was", () => {
    expect(fmtValue(null)).toBe("—");
    expect(fmtValue("")).toBe("—");
    expect(fmtValue(true)).toBe("Yes");
    expect(fmtValue(2032)).toBe("2032");
    expect(fmtValue(45_600)).toBe("$46k");
    expect(fmtValue(4.5)).toBe("4.5");
  });
});
