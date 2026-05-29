import { describe, it, expect } from "vitest";
import { buildStateBracketRows } from "../bracket";
import type { ProjectionYear } from "@/engine/types";

function year(y: number, base: number, brackets: Array<{ from: number; to: number | null; rate: number }>, stateTax: number): ProjectionYear {
  return {
    year: y,
    ages: { client: 60 + (y - 2026), spouse: 56 + (y - 2026) },
    taxResult: {
      state: {
        state: "PA",
        year: y,
        hasIncomeTax: true,
        stateTaxableIncome: base,
        bracketsUsed: brackets,
        stateTax,
      },
    },
  } as unknown as ProjectionYear;
}

describe("buildStateBracketRows", () => {
  it("computes into/remaining-in-bracket and YoY change in base", () => {
    const rows = buildStateBracketRows([
      year(2026, 100_000, [{ from: 0, to: 200_000, rate: 0.05 }], 5_000),
      year(2027, 120_000, [{ from: 0, to: 200_000, rate: 0.05 }], 6_000),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].intoBracket).toBe(100_000);
    expect(rows[0].remainingInBracket).toBe(100_000);
    expect(rows[0].changeInBase).toBe(0);
    expect(rows[1].changeInBase).toBe(20_000);
    expect(rows[1].marginalRate).toBe(0.05);
    expect(rows[1].stateTax).toBe(6_000);
  });

  it("returns null remaining for the top tier and skips years without state data", () => {
    const rows = buildStateBracketRows([
      year(2026, 500_000, [{ from: 0, to: null, rate: 0.0307 }], 15_350),
      { year: 2027, ages: { client: 61 }, taxResult: {} } as unknown as ProjectionYear,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].remainingInBracket).toBeNull();
  });
});
