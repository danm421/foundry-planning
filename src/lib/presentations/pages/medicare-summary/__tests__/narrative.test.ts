import { describe, it, expect } from "vitest";
import { buildMedicareNarrative } from "../narrative";

const base = {
  lifetimeMedicareCost: 240_000,
  lifetimeIrmaa: 48_000,
  irmaaShare: 0.2,
  irmaaYears: 12,
  rmdEra: null,
  survivor: null,
  headroom: null,
};

describe("buildMedicareNarrative", () => {
  it("opener states cost and IRMAA share when there are IRMAA years", () => {
    const lines = buildMedicareNarrative(base);
    expect(lines[0]).toContain("$240k");
    expect(lines[0]).toContain("20%");
    expect(lines[0]).toContain("$48k");
  });

  it("opener notes no surcharge when irmaaYears is zero", () => {
    const lines = buildMedicareNarrative({ ...base, irmaaYears: 0, lifetimeIrmaa: 0, irmaaShare: 0 });
    expect(lines[0]).toContain("no year triggers an IRMAA");
  });

  it("orders survivor before RMD before headroom and caps at 4 lines", () => {
    const lines = buildMedicareNarrative({
      ...base,
      survivor: { year: 2045, fromTier: 1, toTier: 3, total: 30_000 },
      rmdEra: { firstYear: 2038, lastYear: 2050, total: 60_000 },
      headroom: { year: 2034, amount: 8_000, nextTier: 2 },
    });
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("first death");
    expect(lines[2]).toContain("Required minimum distributions");
    expect(lines[3]).toContain("cliff");
  });

  it("renders only the signals that are present", () => {
    const lines = buildMedicareNarrative({ ...base, headroom: { year: 2034, amount: 8_000, nextTier: 2 } });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("$8k under the tier 2 threshold");
  });
});
