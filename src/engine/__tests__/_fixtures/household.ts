import type { ClientData, FamilyMember } from "@/engine/types";

/** Shared spouse for the CRT/CLT fixtures — an id neither fixture uses elsewhere. */
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000005";

/**
 * A spouse who outlives every plan horizon the fixtures use. The projection
 * truncates at the FINAL death, so a single grantor's death ends the plan that
 * year; a surviving spouse is what keeps the years after a death on the books.
 */
export function spouseFamilyMember(dateOfBirth: string, lastName: string): FamilyMember {
  return {
    id: SPOUSE_FM_ID,
    firstName: "Surviving",
    lastName,
    relationship: "other",
    role: "spouse",
    dateOfBirth,
  } as FamilyMember;
}

/** The `client` fields that go with `spouseFamilyMember`. Spread last. */
export function spouseClientFields(
  dateOfBirth: string,
  retirementAge: number,
): Partial<ClientData["client"]> {
  return {
    filingStatus: "married_joint",
    spouseName: "Surviving Spouse",
    spouseDob: dateOfBirth,
    spouseRetirementAge: retirementAge,
    spouseLifeExpectancy: 100,
  };
}

/** A flat client salary — gives the §170 AGI limits something to bite on. */
export function salaryRow(
  annualAmount: number,
  startYear: number,
  endYear: number,
): ClientData["incomes"][number] {
  return {
    id: "inc-salary",
    name: "Salary",
    type: "salary",
    owner: "client",
    annualAmount,
    growthRate: 0,
    startYear,
    endYear,
  } as ClientData["incomes"][number];
}
