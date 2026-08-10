import type { SignalInput } from "../types";

/** A household where NO rule fires. Override exactly the field under test. */
export function signalInputFixture(over: Partial<SignalInput> = {}): SignalInput {
  const base: SignalInput = {
    clientId: "11111111-1111-1111-1111-111111111111",
    now: new Date("2026-08-08T00:00:00Z"),
    risk: {
      alignment: {
        currentPct: 60, requiredPct: 55, capacityPct: 65,
        capacityScore: 65, verdict: "aligned",
      },
      toleranceScore: 60,
      toleranceConfirmedAt: new Date("2026-06-01T00:00:00Z"),
      compositeLevel: "moderate",
      bindingConstraint: "tolerance",
      mismatch: {
        kind: "aligned", level: "moderate",
        targetName: "Balanced (60/40)", buckets: [],
      },
    },
    plan: {
      mcSuccessRate: 0.9,
      liquidPortfolio: 2_000_000,
      currentYearNetOutflow: 0,
      minNetWorth: 1_000_000,
      fundingScore: 1.4,
      hasProjection: true,
    },
    portfolio: {
      cashPct: 0.03,
      liquidPortfolio: 2_000_000,
      cashReturn: 0.01,
      equityReturn: 0.06,
      largestPosition: { label: "VTI", value: 100_000 },
    },
    relationship: {
      // Deliberately unequal to the fixture's clientId — the CRM hrefs must key
      // off the household, and an equal pair could not tell the two apart.
      crmHouseholdId: "hh-9999",
      overdueTaskCount: 0,
      lastContactAt: new Date("2026-08-01T00:00:00Z"),
      portalInvitedAt: null,
      portalFirstLoginAt: null,
      lifeEvents: [],
      planStartYear: 2026,
    },
    tax: { observations: [], taxYear: 2025 },
  };
  return { ...base, ...over };
}
