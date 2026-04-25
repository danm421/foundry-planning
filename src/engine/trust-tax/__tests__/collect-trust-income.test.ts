import { describe, it, expect } from "vitest";
import { collectTrustIncome } from "../collect-trust-income";

const TRUST_ID = "entity-slat-1";

describe("collectTrustIncome", () => {
  it("sums ordinary + dividends + taxExempt from trust-owned accounts by entity", () => {
    const r = collectTrustIncome({
      entityIds: [TRUST_ID],
      yearRealizations: [
        { accountId: "a1", ownerEntityId: TRUST_ID, ordinary: 40_000, dividends: 10_000, taxExempt: 5_000, capGains: 2_000 },
        { accountId: "a2", ownerEntityId: TRUST_ID, ordinary: 20_000, dividends: 0, taxExempt: 0, capGains: 0 },
        { accountId: "a3", ownerEntityId: null, ordinary: 100_000, dividends: 0, taxExempt: 0, capGains: 0 },
      ],
      assetTransactionGains: [],
    });
    expect(r.get(TRUST_ID)).toEqual({
      ordinary: 60_000, dividends: 10_000, taxExempt: 5_000, recognizedCapGains: 0,
    });
    // ambient cap gains excluded (in-kind assumption)
  });

  it("includes recognized cap gains ONLY from asset-transaction sales", () => {
    const r = collectTrustIncome({
      entityIds: [TRUST_ID],
      yearRealizations: [
        { accountId: "a1", ownerEntityId: TRUST_ID, ordinary: 0, dividends: 0, taxExempt: 0, capGains: 50_000 }, // ambient — ignored
      ],
      assetTransactionGains: [
        { ownerEntityId: TRUST_ID, gain: 1_000_000 }, // explicit sale
      ],
    });
    expect(r.get(TRUST_ID)?.recognizedCapGains).toBe(1_000_000);
  });

  it("returns zero buckets for a trust with no trust-owned accounts this year", () => {
    const r = collectTrustIncome({
      entityIds: [TRUST_ID],
      yearRealizations: [],
      assetTransactionGains: [],
    });
    expect(r.get(TRUST_ID)).toEqual({
      ordinary: 0, dividends: 0, taxExempt: 0, recognizedCapGains: 0,
    });
  });
});
