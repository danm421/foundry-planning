import { describe, it, expect } from "vitest";
import { fanOutGiftSeries, type GiftSeriesRow } from "@/engine/series-fanout";

describe("fanOutGiftSeries", () => {
  const baseSeries: GiftSeriesRow = {
    id: "gs1",
    grantor: "client",
    recipientEntityId: "trust-1",
    startYear: 2026,
    endYear: 2030,
    annualAmount: 19000,
    amountMode: "fixed",
    inflationAdjust: false,
    useCrummeyPowers: true,
  };

  it("emits one event per year from startYear to endYear inclusive", () => {
    const events = fanOutGiftSeries(baseSeries, { cpi: 0.025 });
    expect(events).toHaveLength(5);
    expect(events[0].year).toBe(2026);
    expect(events[4].year).toBe(2030);
  });

  it("uses flat annualAmount when inflationAdjust is false", () => {
    const events = fanOutGiftSeries(baseSeries, { cpi: 0.025 });
    expect(events.every((e) => e.kind === "cash" && e.amount === 19000)).toBe(true);
  });

  it("compounds by CPI when inflationAdjust is true", () => {
    const events = fanOutGiftSeries({ ...baseSeries, inflationAdjust: true }, { cpi: 0.03 });
    expect(events[0].kind === "cash" && events[0].amount).toBeCloseTo(19000);
    expect(events[1].kind === "cash" && events[1].amount).toBeCloseTo(19000 * 1.03);
    expect(events[4].kind === "cash" && events[4].amount).toBeCloseTo(19000 * 1.03 ** 4);
  });

  it("propagates Crummey + recipient + grantor + seriesId on every event", () => {
    const events = fanOutGiftSeries(baseSeries, { cpi: 0.025 });
    expect(events.every((e) => e.kind === "cash" && e.useCrummeyPowers && e.recipientEntityId === "trust-1" && e.grantor === "client" && e.seriesId === "gs1")).toBe(true);
  });

  it("returns empty array when endYear < startYear", () => {
    expect(fanOutGiftSeries({ ...baseSeries, startYear: 2030, endYear: 2025 }, { cpi: 0.025 })).toEqual([]);
  });
});

describe("fanOutGiftSeries — annual_exclusion mode", () => {
  const exclusionBase: GiftSeriesRow = {
    id: "s1",
    grantor: "client",
    recipientEntityId: "t1",
    startYear: 2026,
    endYear: 2028,
    annualAmount: 1, // ignored in annual_exclusion mode
    amountMode: "annual_exclusion",
    inflationAdjust: false,
    useCrummeyPowers: true,
  };

  const exclusionByYear = { 2026: 19_000, 2027: 19_000, 2028: 20_000 };

  it("emits the indexed exclusion per year for a single grantor", () => {
    const events = fanOutGiftSeries(exclusionBase, { cpi: 0.02, exclusionByYear });
    expect(events.map((e) => e.kind === "cash" && e.amount)).toEqual([19_000, 19_000, 20_000]);
  });

  it("doubles the exclusion for a joint series", () => {
    const events = fanOutGiftSeries(
      { ...exclusionBase, grantor: "joint" },
      { cpi: 0.02, exclusionByYear },
    );
    expect(events.map((e) => e.kind === "cash" && e.amount)).toEqual([38_000, 38_000, 40_000]);
    expect(events[0].grantor).toBe("joint");
  });

  it("emits zero when a year has no exclusion entry", () => {
    const events = fanOutGiftSeries(
      { ...exclusionBase, endYear: 2029 },
      { cpi: 0.02, exclusionByYear },
    );
    expect(events.map((e) => e.kind === "cash" && e.amount)).toEqual([19_000, 19_000, 20_000, 0]);
  });

  it("falls back to fixed annualAmount when amountMode is fixed", () => {
    const events = fanOutGiftSeries(
      { ...exclusionBase, amountMode: "fixed", annualAmount: 5_000 },
      { cpi: 0, exclusionByYear },
    );
    expect(events.map((e) => e.kind === "cash" && e.amount)).toEqual([5_000, 5_000, 5_000]);
  });
});

describe("fanOutGiftSeries — non-entity recipients", () => {
  it("carries a family-member recipient onto each occurrence", () => {
    const events = fanOutGiftSeries(
      { id: "s1", grantor: "client", recipientFamilyMemberId: "fm-kid", startYear: 2027, endYear: 2029, annualAmount: 18000, amountMode: "fixed", inflationAdjust: false, useCrummeyPowers: false },
      { cpi: 0.03 },
    );
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ kind: "cash", recipientFamilyMemberId: "fm-kid", recipientEntityId: undefined });
  });

  it("still carries an entity recipient", () => {
    const events = fanOutGiftSeries(
      { id: "s2", grantor: "client", recipientEntityId: "trust-1", startYear: 2027, endYear: 2027, annualAmount: 1000, amountMode: "fixed", inflationAdjust: false, useCrummeyPowers: false },
      { cpi: 0.03 },
    );
    expect(events[0]).toMatchObject({ recipientEntityId: "trust-1" });
  });
});
