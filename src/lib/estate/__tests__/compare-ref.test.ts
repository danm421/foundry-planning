import { describe, it, expect } from "vitest";
import {
  readCompareSelection,
  refLabel,
  resolveCompareAsOf,
  BASE_REF,
  type CompareAsOf,
  type ColumnYears,
} from "@/lib/estate/compare-ref";
import type { ScenarioOption } from "@/components/scenario/scenario-picker-dropdown";

const SCENARIOS: ScenarioOption[] = [
  { id: "s-base", name: "Base Facts", isBaseCase: true },
  { id: "s-prop", name: "Proposed Plan", isBaseCase: false },
];

describe("readCompareSelection", () => {
  it("defaults to base on the left and solo mode when no params are set", () => {
    expect(readCompareSelection(new URLSearchParams(""))).toEqual({
      left: BASE_REF,
      right: null,
      unsupportedRight: false,
    });
  });

  it("returns solo mode when useSearchParams() hands back null", () => {
    expect(readCompareSelection(null)).toEqual({
      left: BASE_REF,
      right: null,
      unsupportedRight: false,
    });
  });

  it("reads the left column from ?scenario=", () => {
    const sel = readCompareSelection(new URLSearchParams("scenario=s-prop"));
    expect(sel.left).toBe("s-prop");
    expect(sel.right).toBeNull();
  });

  it("reads the right column from ?compare=", () => {
    const sel = readCompareSelection(
      new URLSearchParams("scenario=s-prop&compare=base"),
    );
    expect(sel).toEqual({ left: "s-prop", right: "base", unsupportedRight: false });
  });

  it("falls back to solo and flags a snapshot ref, which this feature cannot serve", () => {
    const sel = readCompareSelection(new URLSearchParams("compare=snap:abc"));
    expect(sel.right).toBeNull();
    expect(sel.unsupportedRight).toBe(true);
  });

  it("treats an empty ?compare= as solo, not as the base case", () => {
    const sel = readCompareSelection(new URLSearchParams("compare="));
    expect(sel.right).toBeNull();
    expect(sel.unsupportedRight).toBe(false);
  });
});

describe("resolveCompareAsOf", () => {
  const LEFT: ColumnYears = {
    todayYear: 2026,
    retirementYear: 2030,
    firstDeathYear: 2060,
    secondDeathYear: 2061,
  };
  const RIGHT: ColumnYears = { ...LEFT, firstDeathYear: 2058, secondDeathYear: 2059 };

  it("resolves today to each column's own first year", () => {
    expect(resolveCompareAsOf({ kind: "today" }, LEFT)).toBe("today");
  });

  it("passes split through untouched", () => {
    expect(resolveCompareAsOf({ kind: "split" }, LEFT)).toBe("split");
  });

  it("resolves last death to each column's OWN year, not a shared one", () => {
    const sel: CompareAsOf = { kind: "milestone", milestone: "lastDeath" };
    expect(resolveCompareAsOf(sel, LEFT)).toBe(2061);
    expect(resolveCompareAsOf(sel, RIGHT)).toBe(2059);
  });

  it("resolves first death per column", () => {
    const sel: CompareAsOf = { kind: "milestone", milestone: "firstDeath" };
    expect(resolveCompareAsOf(sel, LEFT)).toBe(2060);
    expect(resolveCompareAsOf(sel, RIGHT)).toBe(2058);
  });

  it("falls back to first death when a column has no second death", () => {
    const single: ColumnYears = { ...LEFT, secondDeathYear: null };
    expect(
      resolveCompareAsOf({ kind: "milestone", milestone: "lastDeath" }, single),
    ).toBe(2060);
  });

  it("falls back to today when a column has no death events at all", () => {
    const none: ColumnYears = { ...LEFT, firstDeathYear: null, secondDeathYear: null };
    expect(
      resolveCompareAsOf({ kind: "milestone", milestone: "lastDeath" }, none),
    ).toBe("today");
  });

  it("pins an explicitly chosen calendar year to that year on both columns", () => {
    expect(resolveCompareAsOf({ kind: "year", year: 2045 }, LEFT)).toBe(2045);
    expect(resolveCompareAsOf({ kind: "year", year: 2045 }, RIGHT)).toBe(2045);
  });
});

describe("refLabel", () => {
  // The app-wide convention: several surfaces label the base with this literal
  // rather than its stored name, which is why the base case is not renamable.
  // Preferring the stored name here printed "Base case" in the picker beside
  // "Base Case" in the column header — two labels for one thing, side by side.
  it("always names the base case by the app-wide literal, stored name or not", () => {
    expect(refLabel(BASE_REF, SCENARIOS)).toBe("Base case");
    expect(refLabel(BASE_REF, [])).toBe("Base case");
  });

  it("names a live scenario by id", () => {
    expect(refLabel("s-prop", SCENARIOS)).toBe("Proposed Plan");
  });

  it("does not invent a name for an unknown id", () => {
    expect(refLabel("s-gone", SCENARIOS)).toBe("Unknown scenario");
  });
});
