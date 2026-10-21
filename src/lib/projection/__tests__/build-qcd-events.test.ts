import { describe, it, expect } from "vitest";
import { buildQcdEvents } from "../load-client-data";

const base = {
  grantor: "client" as const,
  recipientEntityId: null,
  recipientExternalBeneficiaryId: "charity-1",
  useCrummeyPowers: false,
};
const gift = (id: string, year: number, createdAt: string, qcd = true) => ({
  ...base,
  id,
  year,
  amount: "1000",
  recipientFamilyMemberId: null,
  accountId: null,
  liabilityId: null,
  businessEntityId: null,
  percent: null,
  eventKind: "outright" as const,
  qcdAccountId: qcd ? "ira" : null,
  qcdAmountMode: qcd ? ("fixed" as const) : null,
  createdAt: new Date(createdAt),
});
const series = (id: string, createdAt: string, qcd = true) => ({
  ...base,
  id,
  startYear: 2030,
  endYear: 2031,
  annualAmount: "2000",
  amountMode: "fixed" as const,
  inflationAdjust: false,
  qcdAccountId: qcd ? "ira" : null,
  qcdAmountMode: qcd ? ("fixed" as const) : null,
  createdAt: new Date(createdAt),
});

describe("buildQcdEvents", () => {
  it("orders by year, then by source row createdAt, interleaving one-time and series rows", () => {
    const out = buildQcdEvents(
      [gift("late-once", 2030, "2026-03-01"), gift("early-once", 2031, "2026-01-01")],
      [series("mid-series", "2026-02-01")],
      0.03,
    );
    expect(out.map((e) => [e.year, e.sourceGiftId ?? e.seriesId])).toEqual([
      [2030, "mid-series"],
      [2030, "late-once"],
      [2031, "early-once"],
      [2031, "mid-series"],
    ]);
  });

  it("ignores rows that are not QCDs", () => {
    expect(buildQcdEvents([gift("g", 2030, "2026-01-01", false)], [series("s", "2026-01-01", false)], 0.03)).toEqual([]);
  });
});
