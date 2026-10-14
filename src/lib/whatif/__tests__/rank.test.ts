// src/lib/whatif/__tests__/rank.test.ts
import { describe, it, expect } from "vitest";
import { rankVariants } from "../rank";
import type { VariantResult } from "../run";

const row = (label: string, endingPortfolio: number, lifetimeTax: number, status: "done" | "failed" = "done"): VariantResult => ({
  label,
  status,
  solve: null,
  caveats: [],
  ...(status === "done"
    ? {
        metrics: {
          successRate: null, endingPortfolio, lifetimeTax, netToHeirs: null,
          heirIncomeTax: null, yearsFullyFunded: 30, firstShortfallYear: null,
        },
      }
    : {}),
});

describe("rankVariants", () => {
  it("leaves rows unranked when no rankBy is given", () => {
    expect(rankVariants([row("a", 1, 1)])).toEqual({ rows: [row("a", 1, 1)], best: null });
  });

  it("ranks higher ending portfolio first by default, keeping input order", () => {
    const { rows, best } = rankVariants([row("a", 100, 0), row("b", 300, 0), row("c", 200, 0)], { metric: "endingPortfolio" });
    expect(rows.map((r) => [r.label, r.rank])).toEqual([["a", 3], ["b", 1], ["c", 2]]);
    expect(best).toBe("b");
  });

  it("ranks lower lifetime tax first by default", () => {
    expect(rankVariants([row("a", 0, 500), row("b", 0, 100)], { metric: "lifetimeTax" }).best).toBe("b");
  });

  it("leaves failed rows unranked, in their input position", () => {
    const { rows } = rankVariants([row("x", 0, 0, "failed"), row("a", 5, 0)], { metric: "endingPortfolio" });
    expect(rows.map((r) => r.rank)).toEqual([null, 1]);
  });
});
