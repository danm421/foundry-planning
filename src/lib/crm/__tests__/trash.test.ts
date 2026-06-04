import { describe, it, expect } from "vitest";
import { daysUntilPurge, HOUSEHOLD_TRASH_RETENTION_DAYS } from "../trash";

describe("daysUntilPurge", () => {
  it("returns the full window for a just-deleted household", () => {
    expect(daysUntilPurge(new Date())).toBe(HOUSEHOLD_TRASH_RETENTION_DAYS);
  });

  it("clamps to 0 once past the retention window", () => {
    const past = new Date(Date.now() - (HOUSEHOLD_TRASH_RETENTION_DAYS + 5) * 86_400_000);
    expect(daysUntilPurge(past)).toBe(0);
  });

  it("accepts an ISO string", () => {
    expect(daysUntilPurge(new Date().toISOString())).toBe(HOUSEHOLD_TRASH_RETENTION_DAYS);
  });
});
