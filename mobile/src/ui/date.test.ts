import { describe, it, expect } from "vitest";
import { formatDay } from "./date";

describe("formatDay", () => {
  it("formats a YYYY-MM-DD date as short month + day", () => {
    expect(formatDay("2026-06-12")).toBe("Jun 12");
  });
  it("is UTC-pinned so Jan 1 never slips back to Dec 31", () => {
    expect(formatDay("2026-01-01")).toBe("Jan 1");
  });
  it("does not zero-pad the day", () => {
    expect(formatDay("2026-12-09")).toBe("Dec 9");
  });
});
