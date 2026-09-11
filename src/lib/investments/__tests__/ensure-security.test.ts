// src/lib/investments/__tests__/ensure-security.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSecurityByTicker, classifySecurity, upsertClassifiedSecurity } = vi.hoisted(() => ({
  getSecurityByTicker: vi.fn(),
  classifySecurity: vi.fn(),
  upsertClassifiedSecurity: vi.fn(),
}));
vi.mock("@/lib/investments/classification/persist", () => ({ getSecurityByTicker, upsertClassifiedSecurity }));
vi.mock("@/lib/investments/classification/classify", () => ({ classifySecurity }));

import { ensureSecurityForTicker } from "../ensure-security";
import { CLASSIFIER_VERSION } from "@/lib/investments/classification/types";

describe("ensureSecurityForTicker", () => {
  beforeEach(() => { getSecurityByTicker.mockReset(); classifySecurity.mockReset(); upsertClassifiedSecurity.mockReset(); });

  it("returns the cached security id on a hit (no classify)", async () => {
    getSecurityByTicker.mockResolvedValue({ security: { id: "sec-1", classifierVersion: CLASSIFIER_VERSION }, weights: [] });
    const id = await ensureSecurityForTicker("VTI");
    expect(id).toBe("sec-1");
    expect(classifySecurity).not.toHaveBeenCalled();
  });

  it("classifies + upserts on a miss and returns the new id", async () => {
    getSecurityByTicker.mockResolvedValueOnce(null).mockResolvedValueOnce({ security: { id: "sec-2" }, weights: [] });
    classifySecurity.mockResolvedValue({ identifierType: "ticker", identifier: "AAPL", weights: [] });
    upsertClassifiedSecurity.mockResolvedValue("sec-2");
    const id = await ensureSecurityForTicker("AAPL");
    expect(upsertClassifiedSecurity).toHaveBeenCalledOnce();
    expect(id).toBe("sec-2");
  });

  it("returns null when classification fails", async () => {
    getSecurityByTicker.mockResolvedValue(null);
    classifySecurity.mockResolvedValue(null);
    expect(await ensureSecurityForTicker("ZZZZ")).toBeNull();
  });
  // ── Stale-classification repair ───────────────────────────────────────────
  // A cached row written by an older classifier is NOT a usable cache hit. This
  // is what lets a classifier fix reach data already in the table: 2,054 of the
  // 2,074 mutual funds on prod were recorded as `inflation 100%` by a classifier
  // that could not read EODHD's mutual-fund payload shape, and an
  // unconditional cache hit meant the fix could never reach any of them.
  it("re-classifies a cached row written by an older classifier", async () => {
    getSecurityByTicker.mockResolvedValue({
      security: { id: "sec-stale", classifierVersion: CLASSIFIER_VERSION - 1 },
      weights: [],
    });
    classifySecurity.mockResolvedValue({ identifierType: "ticker", identifier: "SWPPX", weights: [] });
    upsertClassifiedSecurity.mockResolvedValue("sec-stale");

    const id = await ensureSecurityForTicker("SWPPX");
    expect(classifySecurity).toHaveBeenCalledOnce();
    expect(upsertClassifiedSecurity).toHaveBeenCalledOnce();
    expect(id).toBe("sec-stale");
  });

  it("treats a null classifierVersion as stale", async () => {
    getSecurityByTicker.mockResolvedValue({ security: { id: "sec-null", classifierVersion: null }, weights: [] });
    classifySecurity.mockResolvedValue({ identifierType: "ticker", identifier: "X", weights: [] });
    upsertClassifiedSecurity.mockResolvedValue("sec-null");
    await ensureSecurityForTicker("X");
    expect(classifySecurity).toHaveBeenCalledOnce();
  });

  it("keeps the stale row when re-classification fails — stale beats nothing", async () => {
    // Losing the row would strip the holding of any blend at all, which is
    // worse than an out-of-date one. The vendor being down must not delete data.
    getSecurityByTicker.mockResolvedValue({
      security: { id: "sec-stale", classifierVersion: CLASSIFIER_VERSION - 1 },
      weights: [],
    });
    classifySecurity.mockResolvedValue(null);

    const id = await ensureSecurityForTicker("SWPPX");
    expect(classifySecurity).toHaveBeenCalledOnce();
    expect(upsertClassifiedSecurity).not.toHaveBeenCalled();
    expect(id).toBe("sec-stale");
  });
});
