import type { ClientInfo } from "@/engine/types";
import type { PrimaryInfo } from "@/components/family-view";

/**
 * Build the family view's `primary` block from the EFFECTIVE client (the
 * post-scenario-overlay `ClientData.client`), plus the spouse's last name —
 * which the engine tree doesn't carry, so it comes from the CRM contact.
 *
 * Every client field is sourced from `effectiveClient` so a scenario override
 * (retirement age/month, life expectancy, filing status, …) flows through to
 * the view. `lifeExpectancy` is NOT NULL in the schema, so the `?? 0` only
 * satisfies the optional engine type and never triggers in practice.
 */
export function buildFamilyPrimary(
  effectiveClient: ClientInfo,
  spouseLastName: string | null,
): PrimaryInfo {
  return {
    firstName: effectiveClient.firstName,
    lastName: effectiveClient.lastName,
    dateOfBirth: effectiveClient.dateOfBirth,
    retirementAge: effectiveClient.retirementAge,
    retirementMonth: effectiveClient.retirementMonth ?? 1,
    lifeExpectancy: effectiveClient.lifeExpectancy ?? 0,
    filingStatus: effectiveClient.filingStatus,
    spouseName: effectiveClient.spouseName ?? null,
    spouseLastName,
    spouseDob: effectiveClient.spouseDob ?? null,
    spouseRetirementAge: effectiveClient.spouseRetirementAge ?? null,
    spouseRetirementMonth: effectiveClient.spouseRetirementMonth ?? null,
    spouseLifeExpectancy: effectiveClient.spouseLifeExpectancy ?? null,
  };
}
