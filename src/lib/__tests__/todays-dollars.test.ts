import { describe, expect, it } from "vitest";
import { isTodaysDollars } from "@/lib/todays-dollars";

describe("isTodaysDollars", () => {
  it("is on for a future-dated entry whose amount is in today's dollars", () => {
    // planStartYear = 2026, entry starts in 2035 → inflationStartYear = 2026.
    expect(isTodaysDollars(2026, 2035)).toBe(true);
  });

  it("is on for a PAST-dated entry whose amount is in today's dollars", () => {
    // Already-retired client: expense started in 2017 but the amount is the
    // current ($2026) figure, so inflationStartYear = planStartYear = 2026.
    // The basis year (2026) is GREATER than startYear (2017) — the case the
    // old `< startYear` test silently dropped.
    expect(isTodaysDollars(2026, 2017)).toBe(true);
  });

  it("is off when no basis year is stored (inflate from the entry's own start)", () => {
    expect(isTodaysDollars(null, 2017)).toBe(false);
    expect(isTodaysDollars(undefined, 2017)).toBe(false);
  });

  it("is off when the basis year equals the entry's own start year", () => {
    // Behaviourally identical to null; the checkbox stays unchecked.
    expect(isTodaysDollars(2026, 2026)).toBe(false);
  });
});
