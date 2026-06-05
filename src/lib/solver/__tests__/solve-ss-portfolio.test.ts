import { describe, expect, it } from "vitest";
import { runProjection } from "@/engine";
import { buildClientData, sampleIncomes } from "@/engine/__tests__/fixtures";
import type { ClientData } from "@/engine/types";
import { applyMutations } from "../apply-mutations";
import { solveSsClaimAgeByPortfolio } from "../solve-ss-portfolio";
import type { SolverMutation } from "../types";

function endingLiquid(tree: ClientData): number {
  const p = runProjection(tree);
  return p[p.length - 1].portfolioAssets.liquidTotal;
}

describe("solveSsClaimAgeByPortfolio", () => {
  it("enumerates ages 62–70 and tags the ending-portfolio objective", () => {
    const result = solveSsClaimAgeByPortfolio({
      effectiveTree: buildClientData(),
      baselineMutations: [],
      person: "client",
    });
    expect(result.objective).toBe("ending-portfolio");
    expect(result.status).toBe("converged");
    expect(result.candidates.map((c) => c.value)).toEqual([
      62, 63, 64, 65, 66, 67, 68, 69, 70,
    ]);
  });

  it("returns the age with the maximum final-year liquid portfolio", () => {
    const result = solveSsClaimAgeByPortfolio({
      effectiveTree: buildClientData(),
      baselineMutations: [],
      person: "client",
    });
    const maxEnding = Math.max(...result.candidates.map((c) => c.endingPortfolio));
    expect(result.endingPortfolio).toBe(maxEnding);
    expect(result.solvedValue).toBe(
      result.candidates.find((c) => c.endingPortfolio === maxEnding)!.value,
    );
  });

  it("prefers earlier claiming for a flat manual benefit (more years of income)", () => {
    // The default fixture's SS row is manual ($36k/yr, claimingAge 67): claiming
    // earlier starts the income sooner → higher ending portfolio → winner = 62.
    const result = solveSsClaimAgeByPortfolio({
      effectiveTree: buildClientData(),
      baselineMutations: [],
      person: "client",
    });
    const c62 = result.candidates.find((c) => c.value === 62)!.endingPortfolio;
    const c70 = result.candidates.find((c) => c.value === 70)!.endingPortfolio;
    expect(c62).toBeGreaterThan(c70);
    expect(result.solvedValue).toBe(62);
  });

  it("breaks ties toward the earliest age when claim age has no effect", () => {
    // Zero benefit → identical projection at every age → earliest age wins.
    const tree = buildClientData({
      incomes: sampleIncomes.map((i) =>
        i.type === "social_security" ? { ...i, annualAmount: 0 } : i,
      ),
    });
    const result = solveSsClaimAgeByPortfolio({
      effectiveTree: tree,
      baselineMutations: [],
      person: "client",
    });
    const distinct = new Set(result.candidates.map((c) => Math.round(c.endingPortfolio)));
    expect(distinct.size).toBe(1);
    expect(result.solvedValue).toBe(62);
  });

  it("forces 'years' mode so a FRA-mode row still varies by claim age", () => {
    const fraTree = buildClientData({
      incomes: sampleIncomes.map((i) =>
        i.type === "social_security" ? { ...i, claimingAgeMode: "fra" as const } : i,
      ),
    });
    // Without forcing years, FRA mode ignores claimingAge → every age identical.
    const unforced62 = endingLiquid(
      applyMutations(fraTree, [{ kind: "ss-claim-age", person: "client", age: 62 }]),
    );
    const unforced70 = endingLiquid(
      applyMutations(fraTree, [{ kind: "ss-claim-age", person: "client", age: 70 }]),
    );
    expect(unforced62).toBe(unforced70);

    // The solve forces years mode → candidates DO vary by claim age.
    const result = solveSsClaimAgeByPortfolio({
      effectiveTree: fraTree,
      baselineMutations: [],
      person: "client",
    });
    const c62 = result.candidates.find((c) => c.value === 62)!.endingPortfolio;
    const c70 = result.candidates.find((c) => c.value === 70)!.endingPortfolio;
    expect(c62).toBeGreaterThan(c70);
  });

  it("returns the winning age's projection as finalProjection", () => {
    const tree = buildClientData();
    const result = solveSsClaimAgeByPortfolio({
      effectiveTree: tree,
      baselineMutations: [],
      person: "client",
    });
    const winnerTree = applyMutations(tree, [
      { kind: "ss-claim-age-mode", person: "client", mode: "years" },
      { kind: "ss-claim-age", person: "client", age: result.solvedValue },
    ] as SolverMutation[]);
    const fresh = runProjection(winnerTree);
    expect(result.finalProjection[result.finalProjection.length - 1].portfolioAssets.liquidTotal)
      .toBe(fresh[fresh.length - 1].portfolioAssets.liquidTotal);
  });

  it("throws when the abort signal is already aborted", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() =>
      solveSsClaimAgeByPortfolio({
        effectiveTree: buildClientData(),
        baselineMutations: [],
        person: "client",
        signal: ac.signal,
      }),
    ).toThrow("aborted");
  });
});
