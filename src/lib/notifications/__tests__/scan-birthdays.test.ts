import { describe, it, expect } from "vitest";
import {
  shouldFireOn,
  cadenceWindow,
  occurrenceInWindow,
  ageTurning,
  birthdayDedupKey,
  toISODate,
} from "../scan/birthdays";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("shouldFireOn", () => {
  it("fires daily every day", () => {
    expect(shouldFireOn("daily", utc("2026-08-03"))).toBe(true);
    expect(shouldFireOn("daily", utc("2026-08-04"))).toBe(true);
  });

  it("fires weekly only on Monday", () => {
    expect(shouldFireOn("weekly", utc("2026-08-03"))).toBe(true); // Monday
    expect(shouldFireOn("weekly", utc("2026-08-04"))).toBe(false); // Tuesday
    expect(shouldFireOn("weekly", utc("2026-08-09"))).toBe(false); // Sunday
  });

  it("fires monthly only on the 1st", () => {
    expect(shouldFireOn("monthly", utc("2026-09-01"))).toBe(true);
    expect(shouldFireOn("monthly", utc("2026-09-02"))).toBe(false);
  });
});

describe("cadenceWindow", () => {
  it("looks FORWARD, never back — a birthday is useless the day after", () => {
    expect(cadenceWindow("daily", utc("2026-08-03"))).toEqual({
      from: "2026-08-03",
      to: "2026-08-03",
    });
    expect(cadenceWindow("weekly", utc("2026-08-03"))).toEqual({
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(cadenceWindow("monthly", utc("2026-08-01"))).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("ends a monthly window on the real last day of a short month", () => {
    expect(cadenceWindow("monthly", utc("2026-02-01")).to).toBe("2026-02-28");
    expect(cadenceWindow("monthly", utc("2028-02-01")).to).toBe("2028-02-29");
  });

  it("carries a weekly window across a year boundary", () => {
    expect(cadenceWindow("weekly", utc("2026-12-28"))).toEqual({
      from: "2026-12-28",
      to: "2027-01-03",
    });
  });
});

describe("occurrenceInWindow", () => {
  it("finds a birthday inside the window and returns THIS year's date", () => {
    const w = { from: "2026-08-03", to: "2026-08-09" };
    expect(occurrenceInWindow("1974-08-05", w)).toBe("2026-08-05");
  });

  it("includes both endpoints", () => {
    const w = { from: "2026-08-03", to: "2026-08-09" };
    expect(occurrenceInWindow("1974-08-03", w)).toBe("2026-08-03");
    expect(occurrenceInWindow("1974-08-09", w)).toBe("2026-08-09");
  });

  it("returns null when the birthday falls outside", () => {
    const w = { from: "2026-08-03", to: "2026-08-09" };
    expect(occurrenceInWindow("1974-08-02", w)).toBeNull();
    expect(occurrenceInWindow("1974-08-10", w)).toBeNull();
  });

  // The case a same-year-only implementation gets wrong.
  it("matches a January birthday from a window opened in December", () => {
    const w = { from: "2026-12-28", to: "2027-01-03" };
    expect(occurrenceInWindow("1980-01-02", w)).toBe("2027-01-02");
  });

  it("observes a Feb-29 birthday on Feb 28 in a non-leap year", () => {
    expect(occurrenceInWindow("1996-02-29", { from: "2026-02-25", to: "2026-03-03" }))
      .toBe("2026-02-28");
    expect(occurrenceInWindow("1996-02-29", { from: "2028-02-25", to: "2028-03-03" }))
      .toBe("2028-02-29");
  });
});

describe("ageTurning", () => {
  it("is the occurrence year minus the birth year", () => {
    expect(ageTurning("1974-08-05", "2026-08-05")).toBe(52);
  });

  it("counts a Feb-29 person's Feb-28 observance in a non-leap year", () => {
    expect(ageTurning("1996-02-29", "2026-02-28")).toBe(30);
  });
});

describe("birthdayDedupKey", () => {
  it("is stable for the same contact and occurrence", () => {
    expect(birthdayDedupKey("c-1", "2026-08-05")).toBe("birthday:c-1:2026-08-05");
  });

  // Cadence overlap is real: a weekly window (Mon-Sun) and the following
  // monthly window can both contain the same birthday. The key is what stops
  // that becoming two rows.
  it("collides across cadences for the same birthday, by design", () => {
    expect(birthdayDedupKey("c-1", "2026-08-05")).toBe(
      birthdayDedupKey("c-1", "2026-08-05"),
    );
  });
});

describe("toISODate", () => {
  it("formats in UTC, not local time", () => {
    expect(toISODate(new Date("2026-08-03T23:30:00.000Z"))).toBe("2026-08-03");
  });
});
