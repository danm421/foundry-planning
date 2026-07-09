import { describe, it, expect } from "vitest";
import { formatDay, formatMonth } from "./date";

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

describe("formatMonth", () => {
  it("formats a YYYY-MM month key as long month + year", () => {
    expect(formatMonth("2026-07")).toBe("July 2026");
  });
  it("is UTC-pinned so January never slips back to December", () => {
    expect(formatMonth("2026-01")).toBe("January 2026");
  });
  it("formats December correctly at year end", () => {
    expect(formatMonth("2025-12")).toBe("December 2025");
  });
});
