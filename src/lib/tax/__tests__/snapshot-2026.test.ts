import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Pins data/tax/snapshot.json's 2026 entry to the published IRS Rev. Proc. 2025-32
// values (Bugs #14/#31/#32). snapshot.json is the human-readable mirror of the seed
// source (data/tax/*.xlsx → DB); this test guards it (and transitively the xlsx, via
// `npm run seed:tax-data -- --write-snapshot`) against re-introducing the old naive-
// inflation values. NOTE: the engine reads tax_year_parameters from the DB at runtime,
// so applying these values to production requires a DB reseed (`npm run seed:tax-data`).
//
// Sources: IRS Rev. Proc. 2025-32 §4.01 Tables 1-5 (ordinary), §4.03 (capital gains).

type Tier = { from: number; to: number | null; rate: number };
type CapGains = { zeroPctTop: number; fifteenPctTop: number };

const snapshot = JSON.parse(
  readFileSync(path.join(process.cwd(), "data/tax/snapshot.json"), "utf8"),
) as Array<{
  year: number;
  incomeBrackets: Record<string, Tier[]>;
  capGainsBrackets: Record<string, CapGains>;
  trustIncomeBrackets: Tier[];
  trustCapGainsBrackets: Tier[];
}>;

const y2026 = snapshot.find((y) => y.year === 2026)!;

describe("snapshot.json 2026 — IRS Rev. Proc. 2025-32 (Bugs #14/#31/#32)", () => {
  it("has a 2026 entry", () => {
    expect(y2026).toBeDefined();
  });

  // Ordinary brackets — the full schedule per filing status (§4.01 Tables 1-5).
  it("ordinary brackets: married_joint (Table 1)", () => {
    expect(y2026.incomeBrackets.married_joint).toEqual([
      { from: 0, to: 24800, rate: 0.1 },
      { from: 24800, to: 100800, rate: 0.12 },
      { from: 100800, to: 211400, rate: 0.22 },
      { from: 211400, to: 403550, rate: 0.24 },
      { from: 403550, to: 512450, rate: 0.32 },
      { from: 512450, to: 768700, rate: 0.35 },
      { from: 768700, to: null, rate: 0.37 },
    ]);
  });

  it("ordinary brackets: single (Table 3)", () => {
    expect(y2026.incomeBrackets.single).toEqual([
      { from: 0, to: 12400, rate: 0.1 },
      { from: 12400, to: 50400, rate: 0.12 },
      { from: 50400, to: 105700, rate: 0.22 },
      { from: 105700, to: 201775, rate: 0.24 },
      { from: 201775, to: 256225, rate: 0.32 },
      { from: 256225, to: 640600, rate: 0.35 },
      { from: 640600, to: null, rate: 0.37 },
    ]);
  });

  it("ordinary brackets: head_of_household (Table 2 — was already correct)", () => {
    expect(y2026.incomeBrackets.head_of_household).toEqual([
      { from: 0, to: 17700, rate: 0.1 },
      { from: 17700, to: 67450, rate: 0.12 },
      { from: 67450, to: 105700, rate: 0.22 },
      { from: 105700, to: 201750, rate: 0.24 },
      { from: 201750, to: 256200, rate: 0.32 },
      { from: 256200, to: 640600, rate: 0.35 },
      { from: 640600, to: null, rate: 0.37 },
    ]);
  });

  it("ordinary brackets: married_separate (Table 4)", () => {
    expect(y2026.incomeBrackets.married_separate).toEqual([
      { from: 0, to: 12400, rate: 0.1 },
      { from: 12400, to: 50400, rate: 0.12 },
      { from: 50400, to: 105700, rate: 0.22 },
      { from: 105700, to: 201775, rate: 0.24 },
      { from: 201775, to: 256225, rate: 0.32 },
      { from: 256225, to: 384350, rate: 0.35 },
      { from: 384350, to: null, rate: 0.37 },
    ]);
  });

  // Long-term cap-gains / qualified-dividend breakpoints (§4.03).
  it("cap-gains breakpoints: all four filing statuses", () => {
    expect(y2026.capGainsBrackets).toEqual({
      married_joint: { zeroPctTop: 98900, fifteenPctTop: 613700 },
      single: { zeroPctTop: 49450, fifteenPctTop: 545500 },
      head_of_household: { zeroPctTop: 66200, fifteenPctTop: 579600 },
      married_separate: { zeroPctTop: 49450, fifteenPctTop: 306850 },
    });
  });

  // Estate & trust (Form 1041) ordinary brackets (Table 5) + trust LTCG (§4.03).
  it("trust ordinary brackets (Table 5)", () => {
    expect(y2026.trustIncomeBrackets).toEqual([
      { from: 0, to: 3300, rate: 0.1 },
      { from: 3300, to: 11700, rate: 0.24 },
      { from: 11700, to: 16000, rate: 0.35 },
      { from: 16000, to: null, rate: 0.37 },
    ]);
  });

  it("trust cap-gains breakpoints", () => {
    expect(y2026.trustCapGainsBrackets).toEqual([
      { from: 0, to: 3300, rate: 0 },
      { from: 3300, to: 16250, rate: 0.15 },
      { from: 16250, to: null, rate: 0.2 },
    ]);
  });
});
