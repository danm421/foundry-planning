import { describe, expect, it, vi } from "vitest";
import { resolveHoldingsForCommit } from "@/lib/imports/commit/holdings";
import type { ImportPayload } from "@/lib/imports/types";

function payloadWith(accounts: ImportPayload["accounts"]): ImportPayload {
  return {
    dependents: [], accounts, incomes: [], expenses: [], liabilities: [],
    lifePolicies: [], wills: [], entities: [], warnings: [],
  };
}

describe("resolveHoldingsForCommit", () => {
  it("uses a cached security and skips classification", async () => {
    const getSecurityByTicker = vi.fn().mockResolvedValue({ security: { id: "sec-1" }, weights: [] });
    const classifySecurity = vi.fn();
    const upsertClassifiedSecurity = vi.fn();
    const fetchEodCloses = vi.fn().mockResolvedValue(new Map([["VTI.US", { price: 210, asOf: "2026-06-09" }]]));

    const map = await resolveHoldingsForCommit(
      payloadWith([{ name: "B", match: { kind: "new" }, holdings: [{ ticker: "vti", shares: 1 }] }]),
      { getSecurityByTicker, classifySecurity, upsertClassifiedSecurity, fetchEodCloses },
    );
    expect(classifySecurity).not.toHaveBeenCalled();
    expect(map.get("VTI")).toEqual({ securityId: "sec-1", price: 210, asOf: "2026-06-09" });
  });

  it("classifies + upserts on cache miss", async () => {
    const getSecurityByTicker = vi.fn().mockResolvedValue(null);
    const classifySecurity = vi.fn().mockResolvedValue({ identifier: "AAPL" });
    const upsertClassifiedSecurity = vi.fn().mockResolvedValue("sec-aapl");
    const fetchEodCloses = vi.fn().mockResolvedValue(new Map());

    const map = await resolveHoldingsForCommit(
      payloadWith([{ name: "B", match: { kind: "new" }, holdings: [{ ticker: "AAPL", shares: 1 }] }]),
      { getSecurityByTicker, classifySecurity, upsertClassifiedSecurity, fetchEodCloses },
    );
    expect(upsertClassifiedSecurity).toHaveBeenCalled();
    expect(map.get("AAPL")).toEqual({ securityId: "sec-aapl", price: null, asOf: null });
  });

  it("omits a ticker when classification fails (manual fallback)", async () => {
    const map = await resolveHoldingsForCommit(
      payloadWith([{ name: "B", match: { kind: "new" }, holdings: [{ ticker: "ZZZZ", shares: 1 }] }]),
      {
        getSecurityByTicker: vi.fn().mockResolvedValue(null),
        classifySecurity: vi.fn().mockResolvedValue(null),
        upsertClassifiedSecurity: vi.fn(),
        fetchEodCloses: vi.fn().mockResolvedValue(new Map()),
      },
    );
    expect(map.has("ZZZZ")).toBe(false);
  });

  it("ignores untickered holdings and fuzzy accounts", async () => {
    const getSecurityByTicker = vi.fn().mockResolvedValue({ security: { id: "sec-x" }, weights: [] });
    const map = await resolveHoldingsForCommit(
      payloadWith([
        { name: "Bonds", match: { kind: "new" }, holdings: [{ name: "Cash", shares: 100 }] },
        { name: "Fuzzy", match: { kind: "fuzzy", candidates: [] }, holdings: [{ ticker: "IGNORED", shares: 1 }] },
      ]),
      { getSecurityByTicker, classifySecurity: vi.fn(), upsertClassifiedSecurity: vi.fn(),
        fetchEodCloses: vi.fn().mockResolvedValue(new Map()) },
    );
    expect(getSecurityByTicker).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });
});
