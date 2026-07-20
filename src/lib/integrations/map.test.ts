// src/lib/integrations/map.test.ts
import { describe, it, expect } from "vitest";
import { mapRegistrationType, mapProviderAccount, mapProviderPosition } from "./map";
import { ORION_REGISTRATIONS } from "./providers/orion/registrations";

describe("provider mapping", () => {
  it("maps known registration types", () => {
    expect(mapRegistrationType("Roth IRA", ORION_REGISTRATIONS)).toMatchObject({
      category: "retirement",
      subType: "roth_ira",
    });
    expect(mapRegistrationType("401(k)", ORION_REGISTRATIONS)).toMatchObject({
      category: "retirement",
      subType: "401k",
    });
    expect(mapRegistrationType("Joint", ORION_REGISTRATIONS)).toMatchObject({
      category: "taxable",
      subType: "brokerage",
    });
  });

  it("defaults unknown registration types with a warning", () => {
    // Keyword-free string: matches NONE of the ORION_REGISTRATIONS regexes
    // (no ira/401/403/529/joint/individual/tenants/twrs/trust/taxable/brokerage).
    const r = mapRegistrationType("Zorp 9000 Plan-Type-X", ORION_REGISTRATIONS);
    expect(r).toMatchObject({ category: "taxable", subType: "brokerage" });
    expect(r.warning).toBeTruthy();
  });

  it("carries external id + provider onto the account", () => {
    const acct = mapProviderAccount(
      {
        id: "a1",
        name: "Joint",
        registrationType: "Joint",
        value: 100,
      } as never,
      "orion",
      ORION_REGISTRATIONS,
    );
    expect(acct.externalId).toBe("a1");
    expect(acct.externalProvider).toBe("orion");
  });

  it("falls back to an untickered holding when only CUSIP is present", () => {
    const h = mapProviderPosition({
      cusip: "037833100",
      description: "APPLE INC",
      marketValue: 500,
    } as never);
    expect(h.ticker ?? null).toBeNull();
    expect(h.marketValue).toBe(500);
    expect(h.name).toBe("APPLE INC");
  });

  it("keeps the ticker when present", () => {
    const h = mapProviderPosition({ ticker: "AAPL", units: 3, price: 200 } as never);
    expect(h.ticker).toBe("AAPL");
    expect(h.shares).toBe(3);
  });

  it("stamps the providerId onto the mapped account", () => {
    const acct = mapProviderAccount(
      { id: "a-1", name: "Brokerage", registrationType: "Individual" },
      "schwab",
      ORION_REGISTRATIONS,
    );
    expect(acct.externalProvider).toBe("schwab");
    expect(acct.externalId).toBe("a-1");
  });

  it("warns on an unmapped registration type and falls back to taxable/brokerage", () => {
    const r = mapRegistrationType("Donor Advised Fund", ORION_REGISTRATIONS);
    expect(r).toMatchObject({ category: "taxable", subType: "brokerage" });
    expect(r.warning).toContain("Donor Advised Fund");
  });
});
