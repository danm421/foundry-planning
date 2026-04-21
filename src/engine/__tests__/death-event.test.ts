import { describe, it, expect } from "vitest";
import { computeFirstDeathYear, identifyDeceased } from "../death-event";
import type { ClientInfo } from "../types";

describe("computeFirstDeathYear", () => {
  const baseClient: ClientInfo = {
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 90,
    lifeExpectancy: 85,
    filingStatus: "married_joint",
  };

  it("returns the earlier of client / spouse death years", () => {
    // Client: 1970 + 85 = 2055; spouse: 1972 + 80 = 2052. Spouse dies first.
    const client: ClientInfo = {
      ...baseClient,
      spouseDob: "1972-06-15",
      spouseLifeExpectancy: 80,
    };
    expect(computeFirstDeathYear(client, 2026, 2100)).toBe(2052);
  });

  it("uses 95 as spouse default when spouseLifeExpectancy is null", () => {
    const client: ClientInfo = {
      ...baseClient,
      spouseDob: "1972-06-15",
      spouseLifeExpectancy: null,
    };
    // Client 1970+85=2055, spouse 1972+95=2067. Client dies first.
    expect(computeFirstDeathYear(client, 2026, 2100)).toBe(2055);
  });

  it("returns null when no spouse", () => {
    expect(computeFirstDeathYear(baseClient, 2026, 2100)).toBeNull();
  });

  it("returns null when the computed year falls outside the plan horizon", () => {
    const client: ClientInfo = {
      ...baseClient,
      spouseDob: "1972-06-15",
      spouseLifeExpectancy: 80,
    };
    // Spouse dies 2052; plan ends 2040 → no death event within horizon.
    expect(computeFirstDeathYear(client, 2026, 2040)).toBeNull();
  });

  it("returns null when client has no lifeExpectancy set", () => {
    const client: ClientInfo = {
      ...baseClient,
      lifeExpectancy: undefined,
      spouseDob: "1972-06-15",
      spouseLifeExpectancy: 80,
    };
    expect(computeFirstDeathYear(client, 2026, 2100)).toBeNull();
  });

  it("deterministic tiebreaker: client first when both die same year", () => {
    const client: ClientInfo = {
      ...baseClient,
      dateOfBirth: "1970-01-01",
      lifeExpectancy: 80,
      spouseDob: "1970-01-01",
      spouseLifeExpectancy: 80,
    };
    // Both 2050. Documented convention: client dies first.
    expect(computeFirstDeathYear(client, 2026, 2100)).toBe(2050);
  });
});

describe("identifyDeceased", () => {
  const baseClient: ClientInfo = {
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 90,
    lifeExpectancy: 85,
    filingStatus: "married_joint",
  };

  it("returns 'client' when client dies strictly before spouse", () => {
    // Client 1970+80=2050; spouse 1972+85=2057. Client first.
    const client: ClientInfo = { ...baseClient, lifeExpectancy: 80, spouseDob: "1972-06-15", spouseLifeExpectancy: 85 };
    expect(identifyDeceased(client, 2050)).toBe("client");
  });

  it("returns 'spouse' when spouse dies strictly before client", () => {
    // Client 1970+85=2055; spouse 1972+80=2052. Spouse first.
    const client: ClientInfo = { ...baseClient, lifeExpectancy: 85, spouseDob: "1972-06-15", spouseLifeExpectancy: 80 };
    expect(identifyDeceased(client, 2052)).toBe("spouse");
  });

  it("returns 'client' on the same-year tiebreaker (matches computeFirstDeathYear convention)", () => {
    // Client 1970+80=2050; spouse 1970+80=2050. Tiebreaker: client first.
    const client: ClientInfo = { ...baseClient, dateOfBirth: "1970-01-01", lifeExpectancy: 80, spouseDob: "1970-01-01", spouseLifeExpectancy: 80 };
    expect(identifyDeceased(client, 2050)).toBe("client");
  });
});
