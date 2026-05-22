import { describe, it, expect } from "vitest";
import { nextDueDate } from "./recurrence";

describe("nextDueDate", () => {
  it("returns null when recurrence is none", () => {
    expect(nextDueDate("none", "2026-05-21")).toBeNull();
  });
  it("returns null when current due is null", () => {
    expect(nextDueDate("weekly", null)).toBeNull();
  });
  it("adds 7 days for weekly", () => {
    expect(nextDueDate("weekly", "2026-05-21")).toBe("2026-05-28");
  });
  it("adds one calendar month for monthly", () => {
    expect(nextDueDate("monthly", "2026-05-21")).toBe("2026-06-21");
  });
  it("clamps month-end overflow (Jan 31 → Feb 28)", () => {
    expect(nextDueDate("monthly", "2026-01-31")).toBe("2026-02-28");
  });
  it("adds three calendar months for quarterly", () => {
    expect(nextDueDate("quarterly", "2026-05-21")).toBe("2026-08-21");
  });
  it("rolls year boundary correctly", () => {
    expect(nextDueDate("quarterly", "2026-11-15")).toBe("2027-02-15");
  });
});
