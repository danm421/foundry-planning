import { describe, it, expect } from "vitest";
import { findDuplicates } from "../dedup";
import type { ParsedRow } from "../rows";

// Unit tests for findDuplicates against an injected existingHouseholds list —
// no DB. Ported from the pre-rework `dryRun dedup matcher` describe block
// (git show b40a4dbca:src/lib/crm/__tests__/import.test.ts) so the matcher
// keeps its own discriminating coverage now that it's a standalone module.
// The full pipeline (readGrid -> detectMapping -> buildPreview) still has one
// integration-level dedup case in ../../__tests__/import.test.ts.

const existing = [
  { id: "h1", name: "Smith Family" },
  { id: "h2", name: "Johnson Household" },
  { id: "h3", name: "García Estate" },
  { id: "h4", name: "Patel Family Trust" },
];

/** A minimal, error-free ParsedRow carrying just the household name dedup reads. */
function row(name: string, overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    rowIndex: 0,
    household: { name, status: "prospect" },
    primary: { role: "primary", firstName: "Anne", lastName: "X" },
    errors: [],
    warnings: [],
    ...overrides,
  };
}

describe("findDuplicates", () => {
  it("flags an exact match as duplicate (score 100)", async () => {
    const { duplicates } = await findDuplicates([row("Smith Family")], {
      existingHouseholds: existing,
    });
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].matches[0]).toMatchObject({ id: "h1", name: "Smith Family" });
    expect(duplicates[0].matches[0].score).toBe(100);
  });

  it("flags a close typo (Smith Famly) as duplicate above threshold", async () => {
    const { duplicates } = await findDuplicates([row("Smith Famly")], {
      existingHouseholds: existing,
    });
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].matches[0].id).toBe("h1");
    expect(duplicates[0].matches[0].score).toBeGreaterThanOrEqual(75);
  });

  it("reports no duplicate when no candidate clears the 75 threshold", async () => {
    const { duplicates } = await findDuplicates([row("Zzzz Quux Corp")], {
      existingHouseholds: existing,
    });
    expect(duplicates).toHaveLength(0);
  });

  it("is case insensitive", async () => {
    const { duplicates } = await findDuplicates([row("smith family")], {
      existingHouseholds: existing,
    });
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].matches[0].id).toBe("h1");
  });

  it("returns at most 3 matches and respects descending sort order", async () => {
    const many = [
      { id: "a", name: "Acme Family" },
      { id: "b", name: "Acme Familie" },
      { id: "c", name: "Acme Famile" },
      { id: "d", name: "Acme Famly" },
      { id: "e", name: "Acme Famili" },
    ];
    const { duplicates } = await findDuplicates([row("Acme Family")], {
      existingHouseholds: many,
    });
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].matches.length).toBeLessThanOrEqual(3);
    // The exact match must lead.
    expect(duplicates[0].matches[0].id).toBe("a");
    // Scores monotonically non-increasing.
    const scores = duplicates[0].matches.map((m) => m.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it("normalizes accents so García matches Garcia", async () => {
    const { duplicates } = await findDuplicates([row("Garcia Estate")], {
      existingHouseholds: existing,
    });
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].matches[0].id).toBe("h3");
    // Pin the exact score, not just the winning id: fuzzball's token_set_ratio
    // is forgiving enough that a de-accented "Garcia Estate" still scores ~89
    // against "García Estate" even without diacritic stripping (there's no
    // closer decoy in `existing` to displace it as the top match). Only a
    // correctly stripped, byte-identical comparison scores a clean 100 — that
    // exactness is what actually catches a corrupted combining-marks regex.
    expect(duplicates[0].matches[0].score).toBe(100);
  });

  // New logic (not moved from the old dryRun, which never saw errored rows —
  // parseCsv filtered them upstream): an unimportable row can't be a dupe.
  it("skips an errored row even when its household name would otherwise match", async () => {
    const errored = row("Smith Family", {
      errors: [{ field: "primaryLast", message: "Primary last name is required." }],
    });
    const { duplicates } = await findDuplicates([errored], {
      existingHouseholds: existing,
    });
    expect(duplicates).toHaveLength(0);
  });
});
