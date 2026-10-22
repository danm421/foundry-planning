// src/lib/integrations/map.test.ts
import { describe, it, expect } from "vitest";
import {
  mapRegistrationType,
  mapProviderAccount,
  mapProviderPosition,
  mapToImportPayload,
} from "./map";
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

describe("a margin debit becomes the account's margin loan", () => {
  // Addepar's Peter Trust Main, as its sync returns it: the custodian's margin
  // debit is a negative "Margin" position, and the account's value and cost
  // basis both already have it subtracted.
  const mainAccount = {
    id: "146120320",
    name: "Peter Trust - Schwab - Main (70044348)",
    registrationType: "Trust",
    value: 6684564.63,
    costBasis: 932110.05,
  };
  const mainPositions = [
    { description: "SPDR S&P 500 ETF", ticker: "SPY", units: 8396, price: 773.09, marketValue: 6490863.64, costBasis: 1483526.25 },
    { description: "Margin", ticker: "$CASH", units: -948125, price: 1, marketValue: -948125, costBasis: -948125 },
  ];
  const map = (positions: typeof mainPositions) =>
    mapToImportPayload(
      "addepar",
      ORION_REGISTRATIONS,
      { id: "h1", name: "" },
      [mainAccount],
      new Map([[mainAccount.id, positions]]),
    ).accounts[0];

  it("lifts the debit off the positions and onto the account as its loan", () => {
    const acct = map(mainPositions);
    expect(acct.marginBalance).toBe(948125);
    expect(acct.holdings?.map((h) => h.name)).toEqual(["SPDR S&P 500 ETF"]);
  });

  it("states the value and cost basis before the loan, as an account with a margin loan is saved", () => {
    const acct = map(mainPositions);
    expect(acct.value).toBe(7632689.63);
    expect(acct.basis).toBe(1880235.05);
  });

  it("leaves a margin CREDIT balance as a cash position", () => {
    const credit = { description: "Margin", ticker: "$CASH", units: 8887.29, price: 1, marketValue: 8887.29, costBasis: 8887.29 };
    const acct = map([mainPositions[0], credit]);
    expect(acct.marginBalance).toBeUndefined();
    expect(acct.value).toBe(6684564.63);
    expect(acct.holdings).toHaveLength(2);
  });
});
