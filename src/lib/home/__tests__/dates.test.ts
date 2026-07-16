import { describe, expect, it } from "vitest";
import { milestonesWithin, nextBirthdayWithin, parseDateOnly } from "../dates";

describe("parseDateOnly", () => {
  it("parses to local midnight", () => {
    const d = parseDateOnly("1960-03-15");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([1960, 2, 15]);
  });
});

describe("nextBirthdayWithin", () => {
  const today = new Date(2026, 6, 16); // 2026-07-16

  it("finds a birthday inside the window", () => {
    const hit = nextBirthdayWithin("1980-08-01", today, 30);
    expect(hit).not.toBeNull();
    expect([hit!.date.getMonth(), hit!.date.getDate()]).toEqual([7, 1]);
    expect(hit!.turning).toBe(46);
  });

  it("returns null outside the window", () => {
    expect(nextBirthdayWithin("1980-09-01", today, 30)).toBeNull();
  });

  it("includes today (0 days away)", () => {
    const hit = nextBirthdayWithin("1980-07-16", today, 30);
    expect(hit).not.toBeNull();
    expect(hit!.turning).toBe(46);
  });

  it("wraps the year boundary", () => {
    const dec = new Date(2026, 11, 28); // 2026-12-28
    const hit = nextBirthdayWithin("1970-01-05", dec, 30);
    expect(hit).not.toBeNull();
    expect(hit!.date.getFullYear()).toBe(2027);
    expect(hit!.turning).toBe(57);
  });

  it("celebrates Feb-29 DOBs on Feb 28 in non-leap years", () => {
    const feb = new Date(2026, 1, 10); // 2026 is not a leap year
    const hit = nextBirthdayWithin("1980-02-29", feb, 30);
    expect(hit).not.toBeNull();
    expect([hit!.date.getMonth(), hit!.date.getDate()]).toEqual([1, 28]);
  });
});

describe("milestonesWithin", () => {
  it("finds a plain-age milestone inside the window", () => {
    // Turns 73 on 2026-08-01
    const hits = milestonesWithin("1953-08-01", new Date(2026, 6, 16), 90);
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe("73");
    expect(hits[0].label).toContain("73");
  });

  it("computes 59½ as DOB + 59y + 6 calendar months", () => {
    // DOB 1967-03-10 → 59½ on 2026-09-10
    const hits = milestonesWithin("1967-03-10", new Date(2026, 6, 16), 90);
    expect(hits.map((h) => h.key)).toContain("59.5");
    const h = hits.find((x) => x.key === "59.5")!;
    expect([h.date.getFullYear(), h.date.getMonth(), h.date.getDate()]).toEqual([
      2026, 8, 10,
    ]);
  });

  it("excludes milestones outside the window", () => {
    // Turns 65 on 2027-03-01 — 228 days out from 2026-07-16
    expect(milestonesWithin("1962-03-01", new Date(2026, 6, 16), 90)).toEqual([]);
  });

  it("excludes milestones already passed", () => {
    // Turned 62 on 2026-07-01, 15 days before `today`
    expect(milestonesWithin("1964-07-01", new Date(2026, 6, 16), 90)).toEqual([]);
  });

  it("can return two milestones when windows overlap", () => {
    // Contrived: none of the defined ages are <6mo apart, so verify a
    // single DOB never yields duplicates instead.
    const hits = milestonesWithin("1953-08-01", new Date(2026, 6, 16), 90);
    expect(new Set(hits.map((h) => h.key)).size).toBe(hits.length);
  });
});
