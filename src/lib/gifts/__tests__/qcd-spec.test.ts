import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import {
  applyGiftsToClientData,
  giftRowToDraft,
  giftSeriesRowToDraft,
  type EstateFlowGift,
  type GiftRow,
  type GiftSeriesDbRow,
} from "@/lib/estate/estate-flow-gifts";
import { qcdSpecFromDraft } from "../qcd-spec";

const giftRow = (over: Partial<GiftRow> = {}): GiftRow => ({
  id: "g1",
  year: 2030,
  amount: "5000",
  grantor: "client",
  recipientEntityId: null,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: "charity-1",
  accountId: null,
  liabilityId: null,
  businessEntityId: null,
  percent: null,
  useCrummeyPowers: false,
  eventKind: "outright",
  ...over,
});

const seriesRow = (over: Partial<GiftSeriesDbRow> = {}): GiftSeriesDbRow => ({
  id: "s1",
  grantor: "client",
  recipientEntityId: null,
  recipientExternalBeneficiaryId: "charity-1",
  startYear: 2030,
  endYear: 2032,
  annualAmount: "4000",
  amountMode: "fixed",
  inflationAdjust: true,
  useCrummeyPowers: false,
  ...over,
});

describe("QCD drafts", () => {
  it("giftRowToDraft carries qcd just before valuationDiscount", () => {
    const d = giftRowToDraft(giftRow({ qcdAccountId: "ira", qcdAmountMode: "full_rmd", amount: "0" }))!;
    expect(d.kind).toBe("cash-once");
    expect((d as { qcd?: unknown }).qcd).toEqual({ accountId: "ira", amountMode: "full_rmd" });
    expect(Object.keys(d).at(-1)).toBe("valuationDiscount");
    expect(Object.keys(d).at(-2)).toBe("qcd");
  });

  it("giftRowToDraft on a non-QCD row has no qcd key", () => {
    expect("qcd" in giftRowToDraft(giftRow())!).toBe(false);
  });

  it("giftSeriesRowToDraft carries qcd only for QCD rows, before valuationDiscount", () => {
    const q = giftSeriesRowToDraft(seriesRow({ qcdAccountId: "ira", qcdAmountMode: "fixed" }));
    expect((q as { qcd?: unknown }).qcd).toEqual({ accountId: "ira", amountMode: "fixed" });
    expect(Object.keys(q).at(-1)).toBe("valuationDiscount");
    expect(Object.keys(q).at(-2)).toBe("qcd");
    expect("qcd" in giftSeriesRowToDraft(seriesRow())).toBe(false);
  });
});

describe("qcdSpecFromDraft", () => {
  it("maps a series draft", () => {
    const d = giftSeriesRowToDraft(seriesRow({ qcdAccountId: "ira", qcdAmountMode: "fixed" }));
    expect(qcdSpecFromDraft(d)).toEqual({
      accountId: "ira",
      charityId: "charity-1",
      mode: "fixed",
      startYear: 2030,
      endYear: 2032,
      amount: 4000,
      inflationAdjust: true,
      seriesId: "s1",
    });
  });

  it("maps a one-time draft", () => {
    const d = giftRowToDraft(giftRow({ qcdAccountId: "ira", qcdAmountMode: "fixed" }))!;
    expect(qcdSpecFromDraft(d)).toEqual({
      accountId: "ira",
      charityId: "charity-1",
      mode: "fixed",
      startYear: 2030,
      endYear: 2030,
      amount: 5000,
      inflationAdjust: false,
      sourceGiftId: "g1",
    });
  });

  it("returns null for a non-QCD draft or a non-charity recipient", () => {
    expect(qcdSpecFromDraft(giftRowToDraft(giftRow())!)).toBeNull();
    const toTrust = giftRowToDraft(
      giftRow({ qcdAccountId: "ira", qcdAmountMode: "fixed", recipientExternalBeneficiaryId: null, recipientEntityId: "t1" }),
    )!;
    expect(qcdSpecFromDraft(toTrust)).toBeNull();
  });
});

describe("applyGiftsToClientData with QCD drafts", () => {
  const base = {
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.03, taxInflationRate: 0.03 },
    accounts: [], liabilities: [], taxYearRows: [], gifts: [], giftEvents: [],
  } as unknown as ClientData;

  const cash: EstateFlowGift = giftRowToDraft(giftRow({ id: "cash", recipientExternalBeneficiaryId: null, recipientEntityId: "t1" }))!;
  const qcdSeries = giftSeriesRowToDraft(seriesRow({ qcdAccountId: "ira", qcdAmountMode: "fixed", inflationAdjust: false }));
  const qcdOnce = giftRowToDraft(giftRow({ id: "once", qcdAccountId: "ira", qcdAmountMode: "full_rmd", amount: "0" }))!;

  it("a QCD series lands only in qcds; a cash gift only in gifts and giftEvents", () => {
    const out = applyGiftsToClientData(base, [cash, qcdSeries], 0.03);
    expect(out.gifts!.map((g) => g.id)).toEqual(["cash"]);
    expect(out.giftEvents).toHaveLength(1);
    expect(out.giftEvents.every((e) => (e as { sourceGiftId?: string }).sourceGiftId === "cash")).toBe(true);
    expect(out.qcds!.map((q) => q.year)).toEqual([2030, 2031, 2032]);
    expect(out.qcds!.every((q) => q.seriesId === "s1" && q.amount === 4000)).toBe(true);
  });

  it("a one-time QCD never becomes a cash gift or gift event", () => {
    const out = applyGiftsToClientData(base, [qcdOnce], 0.03);
    expect(out.gifts).toEqual([]);
    expect(out.giftEvents).toEqual([]);
    expect(out.qcds).toEqual([
      { year: 2030, accountId: "ira", charityId: "charity-1", mode: "full_rmd", amount: 0, sourceGiftId: "once", seriesId: undefined },
    ]);
  });

  it("a disabled QCD draft produces nothing", () => {
    const out = applyGiftsToClientData(base, [{ ...qcdOnce, enabled: false } as EstateFlowGift], 0.03);
    expect(out.qcds).toEqual([]);
  });

  it("qcds are ordered by year", () => {
    const later = giftRowToDraft(giftRow({ id: "later", year: 2029, qcdAccountId: "ira", qcdAmountMode: "fixed" }))!;
    const out = applyGiftsToClientData(base, [qcdSeries, later], 0.03);
    expect(out.qcds!.map((q) => q.year)).toEqual([2029, 2030, 2031, 2032]);
  });
});
