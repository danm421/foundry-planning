import { describe, it, expect } from "vitest";
import { PLAN_TOKENS } from "../tokens";
import { OBSERVATION_TOPICS } from "@/lib/schemas/observations";
import {
  OBSERVATION_LIBRARY,
  tokensIn,
  visibleLibraryEntries,
  previewLibraryEntry,
} from "../observation-library";

const KNOWN = new Set(PLAN_TOKENS.map((t) => t.id));

describe("OBSERVATION_LIBRARY", () => {
  it("has the eleven entries the spec lists, with unique ids", () => {
    expect(OBSERVATION_LIBRARY).toHaveLength(11);
    expect(new Set(OBSERVATION_LIBRARY.map((e) => e.id)).size).toBe(11);
  });

  // A typo here prints an em-dash to a client. Every token in every body must
  // be a registered token.
  it("every token in every body exists in PLAN_TOKENS", () => {
    for (const entry of OBSERVATION_LIBRARY) {
      const ids = tokensIn(entry.body);
      expect(ids.length, entry.id).toBeGreaterThan(0);
      for (const id of ids) expect(KNOWN.has(id), `${entry.id} → {{${id}}}`).toBe(true);
    }
  });

  it("every entry carries a real topic", () => {
    for (const entry of OBSERVATION_LIBRARY) {
      expect(OBSERVATION_TOPICS).toContain(entry.topic);
    }
  });

  it("the plan-confidence entry says it needs a Monte Carlo page", () => {
    const mc = OBSERVATION_LIBRARY.find((e) => e.id === "plan-confidence");
    expect(mc?.label).toBe("Plan confidence (needs a Monte Carlo page in the deck)");
  });
});

describe("visibleLibraryEntries", () => {
  const allResolved = Object.fromEntries(PLAN_TOKENS.map((t) => [t.id, "x"]));

  it("shows everything when the token map has not loaded", () => {
    expect(visibleLibraryEntries(null)).toEqual(OBSERVATION_LIBRARY);
  });

  it("hides an entry whose body has an unresolved token", () => {
    const solo = { ...allResolved, spouse_first_name: null, spouse_retirement_age: null };
    const ids = visibleLibraryEntries(solo).map((e) => e.id);
    expect(ids).not.toContain("spouse-retirement-timing");
    expect(ids).toContain("retirement-timing");
    const noDebt = { ...allResolved, largest_liability: null };
    expect(visibleLibraryEntries(noDebt).map((e) => e.id)).not.toContain("debt");
  });

  it("shows every entry when every token resolves", () => {
    expect(visibleLibraryEntries(allResolved)).toHaveLength(11);
  });
});

describe("previewLibraryEntry", () => {
  const entry = OBSERVATION_LIBRARY.find((e) => e.id === "net-worth")!;
  it("substitutes resolved values", () => {
    expect(previewLibraryEntry(entry, { net_worth: "$1,738,000", total_liabilities: "$412,000" })).toBe(
      "Your net worth today is $1,738,000, with $412,000 of debt outstanding.",
    );
  });
  it("shows an ellipsis per token while values are loading", () => {
    expect(previewLibraryEntry(entry, null)).toBe("Your net worth today is …, with … of debt outstanding.");
  });
});
