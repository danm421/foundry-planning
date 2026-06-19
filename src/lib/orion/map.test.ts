import { describe, it, expect } from "vitest";
import { mapRegistrationType, mapOrionAccount, mapOrionPosition } from "./map";

describe("orion mapping", () => {
  it("maps known registration types", () => {
    expect(mapRegistrationType("Roth IRA")).toMatchObject({
      category: "retirement",
      subType: "roth_ira",
    });
    expect(mapRegistrationType("401(k)")).toMatchObject({
      category: "retirement",
      subType: "401k",
    });
    expect(mapRegistrationType("Joint")).toMatchObject({
      category: "taxable",
      subType: "brokerage",
    });
  });

  it("defaults unknown registration types with a warning", () => {
    // Keyword-free string: matches NONE of the REGISTRATION_TABLE regexes
    // (no ira/401/403/529/joint/individual/tenants/twrs/trust/taxable/brokerage).
    const r = mapRegistrationType("Zorp 9000 Plan-Type-X");
    expect(r).toMatchObject({ category: "taxable", subType: "brokerage" });
    expect(r.warning).toBeTruthy();
  });

  it("carries external id + provider onto the account", () => {
    const acct = mapOrionAccount({
      id: "a1",
      name: "Joint",
      registrationType: "Joint",
      value: 100,
    } as never);
    expect(acct.externalId).toBe("a1");
    expect(acct.externalProvider).toBe("orion");
  });

  it("falls back to an untickered holding when only CUSIP is present", () => {
    const h = mapOrionPosition({
      cusip: "037833100",
      description: "APPLE INC",
      marketValue: 500,
    } as never);
    expect(h.ticker ?? null).toBeNull();
    expect(h.marketValue).toBe(500);
    expect(h.name).toBe("APPLE INC");
  });

  it("keeps the ticker when present", () => {
    const h = mapOrionPosition({ ticker: "AAPL", units: 3, price: 200 } as never);
    expect(h.ticker).toBe("AAPL");
    expect(h.shares).toBe(3);
  });
});
