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

describe("ensureSecurityForTicker", () => {
  beforeEach(() => { getSecurityByTicker.mockReset(); classifySecurity.mockReset(); upsertClassifiedSecurity.mockReset(); });

  it("returns the cached security id on a hit (no classify)", async () => {
    getSecurityByTicker.mockResolvedValue({ security: { id: "sec-1" }, weights: [] });
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
});
