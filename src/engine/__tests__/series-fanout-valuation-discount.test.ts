import { describe, it, expect } from "vitest";
import { fanOutGiftSeries } from "../series-fanout";

const base = {
  id: "s1",
  grantor: "client" as const,
  recipientEntityId: "t1",
  startYear: 2030,
  endYear: 2033,
  annualAmount: 100_000,
  amountMode: "fixed" as const,
  inflationAdjust: false,
  useCrummeyPowers: false,
};

describe("fanOutGiftSeries — valuationDiscount", () => {
  it("copies the series discount onto every fanned-out occurrence", () => {
    const events = fanOutGiftSeries({ ...base, valuationDiscount: 0.3 }, { cpi: 0 });
    expect(events).toHaveLength(4);
    for (const e of events) {
      expect(e.kind).toBe("cash");
      if (e.kind === "cash") expect(e.valuationDiscount).toBe(0.3);
    }
  });

  it("leaves the discount undefined when the series carries none", () => {
    const events = fanOutGiftSeries(base, { cpi: 0 });
    for (const e of events) {
      if (e.kind === "cash") expect(e.valuationDiscount).toBeUndefined();
    }
  });

  it("does not alter the fanned-out amounts — the discount is applied downstream", () => {
    const events = fanOutGiftSeries({ ...base, valuationDiscount: 0.3 }, { cpi: 0 });
    expect(events.map((e) => (e.kind === "cash" ? e.amount : null))).toEqual([
      100_000, 100_000, 100_000, 100_000,
    ]);
  });
});
