import { describe, it, expect } from "vitest";
import { mutationKey } from "../types";

describe("mutationKey — technique upserts", () => {
  it("keys a roth-conversion-upsert by id", () => {
    expect(
      mutationKey({ kind: "roth-conversion-upsert", id: "rc-1", value: null }),
    ).toBe("roth-conversion-upsert:rc-1");
  });

  it("keys an asset-transaction-upsert by id", () => {
    expect(
      mutationKey({ kind: "asset-transaction-upsert", id: "at-1", value: null }),
    ).toBe("asset-transaction-upsert:at-1");
  });

  it("keys a reinvestment-upsert by id", () => {
    expect(
      mutationKey({ kind: "reinvestment-upsert", id: "ri-1", value: null }),
    ).toBe("reinvestment-upsert:ri-1");
  });
});

describe("mutationKey — stress test", () => {
  it("keys each stressor as a single global lever", () => {
    expect(mutationKey({ kind: "stress-inflation", rate: 0.05 })).toBe("stress-inflation");
    expect(mutationKey({ kind: "stress-ss-haircut", pct: 0.23, startYear: 2034 })).toBe("stress-ss-haircut");
    expect(mutationKey({ kind: "stress-disability", person: "client", startYear: 2030 })).toBe("stress-disability");
    expect(mutationKey({ kind: "stress-market-crash", year: 2030, drawdownPct: 0.3 })).toBe("stress-market-crash");
    expect(mutationKey({ kind: "stress-exemption-cap", cap: 7_000_000 })).toBe("stress-exemption-cap");
  });
});
