import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ProjectionYear } from "../types";
import { buildMarriedEstateFixture } from "./fixtures/married-estate-fixture";

// `hypotheticalEstateTax` is a per-year reporting field (Balance Sheet "Today"
// view). Monte Carlo runs runProjection 1000× and never reads it, yet computing
// it is ~80% of MC compute (7 structuredClones + a death pass, every year).
// `skipHypotheticalEstateTax` lets the MC trial path opt out. These tests lock
// the two invariants that make that safe: (1) skipping changes NOTHING else in
// the projection, and (2) the required field is still populated (zero-sentinel).

const stripHypothetical = (years: ProjectionYear[]) =>
  years.map((y) => {
    const copy: Partial<ProjectionYear> = { ...y };
    delete copy.hypotheticalEstateTax;
    return copy;
  });

describe("runProjection: skipHypotheticalEstateTax", () => {
  it("produces a projection identical to the default path apart from the hypothetical field", () => {
    const data = buildMarriedEstateFixture();
    const full = runProjection(data);
    const skipped = runProjection(data, { skipHypotheticalEstateTax: true });

    // Everything MC scores (liquid assets, taxes, cash flow, death events, …)
    // is byte-identical — the hypothetical runs on structuredClones and never
    // feeds back into projection state, so opting out cannot move any number.
    expect(stripHypothetical(skipped)).toEqual(stripHypothetical(full));
  });

  it("still populates hypotheticalEstateTax with a zeroed sentinel when skipped", () => {
    const data = buildMarriedEstateFixture();
    const skipped = runProjection(data, { skipHypotheticalEstateTax: true });

    for (const year of skipped) {
      expect(year.hypotheticalEstateTax).toBeDefined();
      expect(year.hypotheticalEstateTax.primaryFirst.totals).toEqual({
        federal: 0,
        state: 0,
        admin: 0,
        total: 0,
      });
      // Sentinel never carries the married both-orderings shape the real
      // computation emits before the first death.
      expect(year.hypotheticalEstateTax.spouseFirst).toBeUndefined();
    }
  });

  it("the default path really does compute a non-trivial hypothetical (guards the test above)", () => {
    const data = buildMarriedEstateFixture();
    const full = runProjection(data);
    // A married household emits the spouseFirst ordering in at least one
    // pre-first-death year; the sentinel never does. If this ever stops being
    // true the skip/stub discriminator above is meaningless.
    expect(full.some((y) => y.hypotheticalEstateTax.spouseFirst !== undefined)).toBe(true);
  });
});
