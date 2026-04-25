import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseIrsUpdatesSheet } from "../irs-updates-sheet";

const FILE = path.join(process.cwd(), "data/tax/2022-2026 Tax Values Updated.xlsx");

describe("parseIrsUpdatesSheet — trust brackets", () => {
  it("extracts trust ordinary brackets (10/24/35/37) for 2024-2026", async () => {
    const years = await parseIrsUpdatesSheet(FILE);
    const y2024 = years.find((y) => y.year === 2024)!;
    expect(y2024.trustIncomeBrackets).toEqual([
      { from: 0,      to: 3100,  rate: 0.10 },
      { from: 3100,   to: 11150, rate: 0.24 },
      { from: 11150,  to: 15200, rate: 0.35 },
      { from: 15200,  to: null,  rate: 0.37 },
    ]);

    const y2026 = years.find((y) => y.year === 2026)!;
    expect(y2026.trustIncomeBrackets).toEqual([
      { from: 0,      to: 3300,  rate: 0.10 },
      { from: 3300,   to: 12000, rate: 0.24 },
      { from: 12000,  to: 16250, rate: 0.35 },
      { from: 16250,  to: null,  rate: 0.37 },
    ]);
  });

  it("extracts trust LTCG brackets (0/15/20) for 2024-2026", async () => {
    const years = await parseIrsUpdatesSheet(FILE);
    const y2024 = years.find((y) => y.year === 2024)!;
    expect(y2024.trustCapGainsBrackets).toEqual([
      { from: 0,     to: 3150,  rate: 0    },
      { from: 3150,  to: 15450, rate: 0.15 },
      { from: 15450, to: null,  rate: 0.20 },
    ]);

    const y2026 = years.find((y) => y.year === 2026)!;
    expect(y2026.trustCapGainsBrackets).toEqual([
      { from: 0,     to: 3350,  rate: 0    },
      { from: 3350,  to: 16300, rate: 0.15 },
      { from: 16300, to: null,  rate: 0.20 },
    ]);
  });
});
