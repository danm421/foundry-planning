// Regression test for "scenario overlays don't carry retirementMonth".
//
// The family view's `primary` object used to read `retirementMonth` /
// `spouseRetirementMonth` from the BASE client row while every other field read
// the effective (post-overlay) client — so a scenario that overrode retirement
// month silently showed the base value. `buildFamilyPrimary` must source every
// client field (including the month fields) from the effective client.

import { describe, it, expect } from "vitest";
import { buildFamilyPrimary } from "../family-primary";
import type { ClientInfo } from "@/engine/types";

function clientInfo(overrides: Partial<ClientInfo> = {}): ClientInfo {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    retirementMonth: 1,
    planEndAge: 95,
    lifeExpectancy: 90,
    filingStatus: "married_joint",
    spouseName: "Charles",
    spouseDob: "1968-03-03",
    spouseRetirementAge: 66,
    spouseRetirementMonth: 1,
    spouseLifeExpectancy: 92,
    ...overrides,
  } as ClientInfo;
}

describe("buildFamilyPrimary", () => {
  it("reads retirementMonth from the effective client (scenario override surfaces)", () => {
    const primary = buildFamilyPrimary(clientInfo({ retirementMonth: 7 }), null);
    expect(primary.retirementMonth).toBe(7);
  });

  it("reads spouseRetirementMonth from the effective client", () => {
    const primary = buildFamilyPrimary(clientInfo({ spouseRetirementMonth: 9 }), null);
    expect(primary.spouseRetirementMonth).toBe(9);
  });

  it("takes spouseLastName from the CRM contact, not the client tree", () => {
    const primary = buildFamilyPrimary(clientInfo(), "Babbage");
    expect(primary.spouseLastName).toBe("Babbage");
  });

  it("maps the remaining identity / retirement fields from the effective client", () => {
    const primary = buildFamilyPrimary(
      clientInfo({ retirementAge: 62, lifeExpectancy: 88 }),
      null,
    );
    expect(primary).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      dateOfBirth: "1970-01-01",
      retirementAge: 62,
      lifeExpectancy: 88,
      filingStatus: "married_joint",
      spouseName: "Charles",
      spouseDob: "1968-03-03",
      spouseRetirementAge: 66,
      spouseLifeExpectancy: 92,
    });
  });
});
