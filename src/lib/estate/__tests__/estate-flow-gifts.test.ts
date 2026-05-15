import { describe, it, expect } from "vitest";
import {
  type EstateFlowGift,
  type GiftRow,
  type GiftSeriesDbRow,
  addGift,
  updateGift,
  removeGift,
  applyGiftsToClientData,
  giftRowToDraft,
  giftSeriesRowToDraft,
} from "../estate-flow-gifts";
import type { ClientData } from "@/engine/types";

function baseData(): ClientData {
  return {
    accounts: [],
    entities: [],
    wills: [],
    gifts: [],
    giftEvents: [],
  } as unknown as ClientData; // minimal ClientData stub — only gifts/giftEvents are exercised
}

const cashGift: EstateFlowGift = {
  kind: "cash-once",
  id: "g1",
  year: 2030,
  amount: 50000,
  grantor: "client",
  recipient: { kind: "family_member", id: "fm-kid" },
  crummey: false,
};

const assetGift: EstateFlowGift = {
  kind: "asset-once",
  id: "g2",
  year: 2031,
  accountId: "acc-1",
  percent: 0.4,
  grantor: "spouse",
  recipient: { kind: "entity", id: "trust-1" },
};

const seriesGift: EstateFlowGift = {
  kind: "series",
  id: "s1",
  startYear: 2030,
  endYear: 2032,
  annualAmount: 18000,
  inflationAdjust: false,
  grantor: "client",
  recipient: { kind: "entity", id: "trust-1" },
  crummey: true,
};

describe("applyGiftsToClientData", () => {
  it("materialises a cash-once gift into gifts[] and giftEvents[]", () => {
    const out = applyGiftsToClientData(baseData(), [cashGift], 0.025);
    expect(out.gifts).toHaveLength(1);
    expect(out.gifts?.[0]).toMatchObject({
      id: "g1", year: 2030, amount: 50000, grantor: "client",
      recipientFamilyMemberId: "fm-kid", useCrummeyPowers: false,
    });
    const cashEvents = out.giftEvents.filter((e) => e.kind === "cash");
    expect(cashEvents).toHaveLength(1);
    expect(cashEvents[0]).toMatchObject({ kind: "cash", year: 2030, amount: 50000 });
  });

  it("materialises an asset-once gift into a giftEvents[] asset entry only", () => {
    const out = applyGiftsToClientData(baseData(), [assetGift], 0.025);
    expect(out.gifts ?? []).toHaveLength(0);
    const assetEvents = out.giftEvents.filter((e) => e.kind === "asset");
    expect(assetEvents).toHaveLength(1);
    expect(assetEvents[0]).toMatchObject({
      kind: "asset", year: 2031, accountId: "acc-1", percent: 0.4,
      recipientEntityId: "trust-1",
    });
  });

  it("fans a series gift into one cash giftEvent per year, tagged with seriesId", () => {
    const out = applyGiftsToClientData(baseData(), [seriesGift], 0.025);
    const seriesEvents = out.giftEvents.filter(
      (e) => e.kind === "cash" && e.seriesId === "s1",
    );
    expect(seriesEvents.map((e) => e.year)).toEqual([2030, 2031, 2032]);
  });

  it("does not mutate the input data", () => {
    const input = baseData();
    applyGiftsToClientData(input, [cashGift], 0.025);
    expect(input.gifts).toEqual([]);
    expect(input.giftEvents).toEqual([]);
  });

  it("sorts giftEvents by year ascending", () => {
    const out = applyGiftsToClientData(baseData(), [assetGift, cashGift], 0.025);
    const years = out.giftEvents.map((e) => e.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });
});

// ── Helper to build a minimal GiftRow ────────────────────────────────────────
function cashRow(overrides: Partial<GiftRow> = {}): GiftRow {
  return {
    id: "gr1",
    year: 2030,
    amount: "50000",
    grantor: "client",
    recipientEntityId: "trust-1",
    recipientFamilyMemberId: null,
    recipientExternalBeneficiaryId: null,
    accountId: null,
    liabilityId: null,
    percent: null,
    useCrummeyPowers: false,
    eventKind: "outright",
    ...overrides,
  };
}

function assetRow(overrides: Partial<GiftRow> = {}): GiftRow {
  return {
    id: "gr2",
    year: 2031,
    amount: null,
    grantor: "spouse",
    recipientEntityId: "trust-1",
    recipientFamilyMemberId: null,
    recipientExternalBeneficiaryId: null,
    accountId: "acc-1",
    liabilityId: null,
    percent: "0.4",
    useCrummeyPowers: false,
    eventKind: "outright",
    ...overrides,
  };
}

// ── Bug A: useCrummeyPowers ───────────────────────────────────────────────────
describe("giftRowToDraft — Bug A: useCrummeyPowers", () => {
  it("carries useCrummeyPowers: true into crummey on a cash row", () => {
    const draft = giftRowToDraft(cashRow({ useCrummeyPowers: true }));
    expect(draft).not.toBeNull();
    expect(draft?.kind).toBe("cash-once");
    if (draft?.kind === "cash-once") {
      expect(draft.crummey).toBe(true);
    }
  });

  it("carries useCrummeyPowers: false into crummey: false on a cash row", () => {
    const draft = giftRowToDraft(cashRow({ useCrummeyPowers: false }));
    expect(draft?.kind === "cash-once" && draft.crummey).toBe(false);
  });
});

// ── Bug B: eventKind ──────────────────────────────────────────────────────────
describe("giftRowToDraft — Bug B: eventKind", () => {
  it("carries a non-outright eventKind on a cash row", () => {
    const draft = giftRowToDraft(cashRow({ eventKind: "clut_remainder_interest" }));
    expect(draft?.kind).toBe("cash-once");
    if (draft?.kind === "cash-once") {
      expect(draft.eventKind).toBe("clut_remainder_interest");
    }
  });

  it("carries a non-outright eventKind on an asset row", () => {
    const draft = giftRowToDraft(assetRow({ eventKind: "clut_remainder_interest" }));
    expect(draft?.kind).toBe("asset-once");
    if (draft?.kind === "asset-once") {
      expect(draft.eventKind).toBe("clut_remainder_interest");
    }
  });

  it("carries eventKind: outright on a cash row (default value)", () => {
    const draft = giftRowToDraft(cashRow({ eventKind: "outright" }));
    if (draft?.kind === "cash-once") {
      expect(draft.eventKind).toBe("outright");
    }
  });
});

// ── Bug C: amountOverride ─────────────────────────────────────────────────────
describe("giftRowToDraft — Bug C: amountOverride", () => {
  it("carries a non-null amount into amountOverride on an asset row", () => {
    const draft = giftRowToDraft(assetRow({ amount: "250000" }));
    expect(draft?.kind).toBe("asset-once");
    if (draft?.kind === "asset-once") {
      expect(draft.amountOverride).toBe(250000);
    }
  });

  it("sets amountOverride to undefined when asset row amount is null", () => {
    const draft = giftRowToDraft(assetRow({ amount: null }));
    expect(draft?.kind).toBe("asset-once");
    if (draft?.kind === "asset-once") {
      expect(draft.amountOverride).toBeUndefined();
    }
  });
});

// ── giftSeriesRowToDraft ──────────────────────────────────────────────────────
function seriesRow(overrides: Partial<GiftSeriesDbRow> = {}): GiftSeriesDbRow {
  return {
    id: "sr1",
    grantor: "client",
    recipientEntityId: "trust-series",
    startYear: 2030,
    endYear: 2034,
    annualAmount: "18000",
    inflationAdjust: false,
    useCrummeyPowers: true,
    ...overrides,
  };
}

describe("giftSeriesRowToDraft", () => {
  it("coerces Postgres numeric string annualAmount to a number", () => {
    const draft = giftSeriesRowToDraft(seriesRow({ annualAmount: "18000" }));
    expect(draft.kind).toBe("series");
    if (draft.kind === "series") {
      expect(draft.annualAmount).toBe(18000);
      expect(typeof draft.annualAmount).toBe("number");
    }
  });

  it("preserves inflationAdjust, useCrummeyPowers (mapped to crummey), startYear, endYear", () => {
    const draft = giftSeriesRowToDraft(
      seriesRow({ inflationAdjust: true, useCrummeyPowers: true, startYear: 2028, endYear: 2033 }),
    );
    expect(draft.kind).toBe("series");
    if (draft.kind === "series") {
      expect(draft.inflationAdjust).toBe(true);
      expect(draft.crummey).toBe(true);
      expect(draft.startYear).toBe(2028);
      expect(draft.endYear).toBe(2033);
    }
  });

  it("produces recipient: { kind: 'entity', id: recipientEntityId }", () => {
    const draft = giftSeriesRowToDraft(seriesRow({ recipientEntityId: "trust-abc" }));
    expect(draft.kind).toBe("series");
    if (draft.kind === "series") {
      expect(draft.recipient).toEqual({ kind: "entity", id: "trust-abc" });
    }
  });

  it("produces kind: 'series'", () => {
    const draft = giftSeriesRowToDraft(seriesRow());
    expect(draft.kind).toBe("series");
  });
});

// ── Round-trip tests (applyGiftsToClientData) ─────────────────────────────────
describe("applyGiftsToClientData — round-trip correctness", () => {
  it("cash-once: eventKind clut_remainder_interest and crummey: true survive round-trip", () => {
    const gift: EstateFlowGift = {
      kind: "cash-once",
      id: "g-clut",
      year: 2030,
      amount: 100000,
      grantor: "client",
      recipient: { kind: "entity", id: "trust-clut" },
      crummey: true,
      eventKind: "clut_remainder_interest",
    };
    const out = applyGiftsToClientData(baseData(), [gift], 0.025);

    // GiftEvent cash: should carry eventKind and useCrummeyPowers
    const cashEvents = out.giftEvents.filter((e) => e.kind === "cash");
    expect(cashEvents).toHaveLength(1);
    expect(cashEvents[0]).toMatchObject({
      kind: "cash",
      useCrummeyPowers: true,
      eventKind: "clut_remainder_interest",
    });

    // gifts[]: loader's mappedGifts omits eventKind — we match that behaviour
    expect(out.gifts).toHaveLength(1);
    expect(out.gifts?.[0]).toMatchObject({
      id: "g-clut",
      useCrummeyPowers: true,
    });
    // eventKind is intentionally absent from Gift[] (matches loader's mappedGifts)
    expect("eventKind" in (out.gifts?.[0] ?? {})).toBe(false);
  });

  it("asset-once: amountOverride survives round-trip", () => {
    const gift: EstateFlowGift = {
      kind: "asset-once",
      id: "g-asset",
      year: 2031,
      accountId: "acc-1",
      percent: 0.5,
      grantor: "client",
      recipient: { kind: "entity", id: "trust-1" },
      amountOverride: 500000,
      eventKind: "outright",
    };
    const out = applyGiftsToClientData(baseData(), [gift], 0.025);

    const assetEvents = out.giftEvents.filter((e) => e.kind === "asset");
    expect(assetEvents).toHaveLength(1);
    if (assetEvents[0].kind === "asset") {
      expect(assetEvents[0].amountOverride).toBe(500000);
    }
  });
});

describe("addGift / updateGift / removeGift", () => {
  it("addGift appends and returns a new array", () => {
    const next = addGift([], cashGift);
    expect(next).toEqual([cashGift]);
  });

  it("updateGift replaces the gift with the matching id", () => {
    const next = updateGift([cashGift], { ...cashGift, amount: 99000 });
    expect(next[0]).toMatchObject({ id: "g1", amount: 99000 });
  });

  it("removeGift drops the gift with the matching id", () => {
    expect(removeGift([cashGift, assetGift], "g1")).toEqual([assetGift]);
  });
});
