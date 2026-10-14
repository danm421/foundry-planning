// src/lib/whatif/__tests__/rank.test.ts
import { describe, it, expect } from "vitest";
import type { SolveFor } from "../changes";
import { WhatIfValidationError } from "../errors";
import { checkRankBy, rankVariants } from "../rank";
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

const solved = (
  label: string,
  kind: SolveFor["kind"],
  value: number,
  status: "converged" | "unreachable" | "max-iterations" = "converged",
  endingPortfolio = 0,
): VariantResult => ({
  ...row(label, endingPortfolio, 0),
  solve: { kind, value, status, achievedSuccess: 0.85 },
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

  // A retirement-age solve returns the earliest age that reaches the target,
  // so the lower answer is the better one.
  it("ranks a retirement-age solve's lowest age first", () => {
    const { rows, best } = rankVariants(
      [solved("a", "retirement_age", 65), solved("b", "retirement_age", 62)],
      { metric: "solvedValue" },
    );
    expect(rows.map((r) => r.rank)).toEqual([2, 1]);
    expect(best).toBe("b");
  });

  it("ranks a max-spending solve's highest spend first", () => {
    const { best } = rankVariants(
      [solved("a", "max_spending", 150_000), solved("b", "max_spending", 180_000)],
      { metric: "solvedValue" },
    );
    expect(best).toBe("b");
  });

  // An unreachable solve's value is the search's closest miss, not an answer:
  // it must never rank, or be named best, however good its number looks.
  it("leaves a row whose solve can't reach its target unranked, ranking by solved value", () => {
    const { rows, best } = rankVariants(
      [solved("a", "retirement_age", 75, "unreachable"), solved("b", "retirement_age", 66), solved("c", "retirement_age", 64)],
      { metric: "solvedValue" },
    );
    expect(rows.map((r) => r.rank)).toEqual([null, 2, 1]);
    expect(best).toBe("c");
  });

  it("leaves a row whose solve can't reach its target unranked, ranking by a metric", () => {
    const { rows, best } = rankVariants(
      [solved("a", "savings", 90_000, "unreachable", 9_000_000), solved("b", "savings", 20_000, "converged", 1_000)],
      { metric: "endingPortfolio" },
    );
    expect(rows.map((r) => r.rank)).toEqual([null, 1]);
    expect(best).toBe("b");
  });

  it("names no best when every solve misses its target", () => {
    const { rows, best } = rankVariants(
      [solved("a", "max_spending", 0, "unreachable"), solved("b", "max_spending", 0, "unreachable")],
      { metric: "solvedValue" },
    );
    expect(rows.map((r) => r.rank)).toEqual([null, null]);
    expect(best).toBeNull();
  });
});

describe("checkRankBy", () => {
  it("refuses ranking by solved value across different kinds of solve", () => {
    expect(() => checkRankBy({ metric: "solvedValue" }, ["retirement_age", "max_spending"], true)).toThrow(WhatIfValidationError);
    expect(() => checkRankBy({ metric: "solvedValue", direction: "asc" }, ["retirement_age", "max_spending"], true)).toThrow(
      /different/,
    );
  });

  it("refuses ranking a Roth-amount solve by solved value without a direction", () => {
    expect(() => checkRankBy({ metric: "solvedValue" }, ["roth_amount", "roth_amount"], true)).toThrow(/direction/);
  });

  it("refuses ranking by solved value when no variation solves", () => {
    expect(() => checkRankBy({ metric: "solvedValue", direction: "desc" }, [null, null], false)).toThrow(/solveFor/);
  });

  // With no Monte Carlo every row's successRate is null: the ranking would
  // rank nothing and name no best, silently.
  it("refuses ranking by success rate when nothing runs Monte Carlo", () => {
    const refusal = new WhatIfValidationError(
      "rankBy successRate needs Monte Carlo. Set includeMonteCarlo to true, or rank by another measure instead.",
    );
    expect(() => checkRankBy({ metric: "successRate" }, [null, null], false)).toThrow(refusal);
    // A claim-age solve runs no Monte Carlo either.
    expect(() => checkRankBy({ metric: "successRate", direction: "desc" }, [null, "ss_claim_age"], false)).toThrow(refusal);
  });

  it("allows one kind of solve, a direction where one is needed, any other measure, and no ranking", () => {
    expect(() => checkRankBy({ metric: "solvedValue" }, ["savings", null], true)).not.toThrow();
    expect(() => checkRankBy({ metric: "solvedValue", direction: "asc" }, ["roth_amount"], true)).not.toThrow();
    expect(() => checkRankBy({ metric: "endingPortfolio" }, [null, "ss_claim_age"], false)).not.toThrow();
    expect(() => checkRankBy({ metric: "successRate" }, [null, null], true)).not.toThrow();
    expect(() => checkRankBy(undefined, ["roth_amount", "savings"], false)).not.toThrow();
  });
});
