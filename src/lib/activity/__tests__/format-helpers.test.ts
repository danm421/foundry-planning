import { describe, it, expect } from "vitest";
import { formatDiffValue } from "../format-helpers";

describe("formatDiffValue", () => {
  it("formats currency", () => {
    expect(formatDiffValue(50000, "currency")).toBe("$50,000");
    expect(formatDiffValue(50000.5, "currency")).toBe("$50,001");
    expect(formatDiffValue(0, "currency")).toBe("$0");
    expect(formatDiffValue(null, "currency")).toBe("—");
  });

  it("formats percent", () => {
    expect(formatDiffValue(0.065, "percent")).toBe("6.5%");
    expect(formatDiffValue(0, "percent")).toBe("0%");
    expect(formatDiffValue(null, "percent")).toBe("—");
  });

  it("formats reference", () => {
    expect(
      formatDiffValue({ id: "u1", display: "Jane Smith" }, "reference"),
    ).toBe("Jane Smith");
    expect(formatDiffValue(null, "reference")).toBe("—");
  });

  it("formats text", () => {
    expect(formatDiffValue("hello", "text")).toBe("hello");
    expect(formatDiffValue(true, "text")).toBe("Yes");
    expect(formatDiffValue(false, "text")).toBe("No");
    expect(formatDiffValue(null, "text")).toBe("—");
  });

  it("formats date", () => {
    expect(formatDiffValue("1980-01-15", "date")).toBe("Jan 15, 1980");
    expect(formatDiffValue(null, "date")).toBe("—");
  });
});
