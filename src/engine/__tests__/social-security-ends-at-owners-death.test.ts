import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, baseClient, basePlanSettings } from "./fixtures";
import type { Income, ProjectionYear } from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

/**
 * A Social Security row runs until its OWNER's death. Its stored `endYear` is
 * not a choice anyone made: the SS dialog writes 2099, and client creation
 * copies the plan's last year at that moment. Cooper Sample's plan end had
 * drifted to the primary's own death (2071), so both rows were saved ending
 * there and the widow's benefit stopped the year her husband died.
 */

const CLIENT_DEATH = 2040; // born 1960 + LE 80
const SPOUSE_DEATH = 2047; // born 1962 + LE 85

function ssRow(owner: "client" | "spouse", endYear: number): Income {
  return {
    id: `ss-${owner}`,
    type: "social_security",
    name: `${owner} SS`,
    annualAmount: 0,
    startYear: 2026,
    endYear,
    growthRate: 0,
    owner,
    claimingAge: 67,
    ssBenefitMode: "pia_at_fra",
    piaMonthly: owner === "client" ? 3000 : 1500,
  };
}

function project(lifeExpectancy: number, spouseLifeExpectancy: number, staleEnd: number) {
  return runProjection(
    buildClientData({
      client: {
        ...baseClient,
        dateOfBirth: "1960-06-01",
        lifeExpectancy,
        spouseDob: "1962-06-01",
        spouseLifeExpectancy,
      },
      accounts: [
        {
          id: "acct-checking",
          name: "Checking",
          category: "cash",
          subType: "checking",
          titlingType: "jtwros",
          value: 50000,
          basis: 50000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
          isDefaultChecking: true,
        },
      ],
      incomes: [ssRow("client", staleEnd), ssRow("spouse", staleEnd)],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: SPOUSE_DEATH },
    }),
  );
}

/** What the year deposited to cash for `sourceId`, across every ledger. */
function deposited(y: ProjectionYear, sourceId: string): number {
  let total = 0;
  for (const ledger of Object.values(y.accountLedgers)) {
    for (const e of ledger.entries) if (e.sourceId === sourceId) total += e.amount;
  }
  return total;
}

describe("Social Security ends at its owner's death, not its stored end year", () => {
  it("the widow keeps collecting after the client dies, though both rows were saved ending at his death", () => {
    const years = project(80, 85, CLIENT_DEATH);
    const after = years.filter((y) => y.year > CLIENT_DEATH);
    expect(after.length).toBe(SPOUSE_DEATH - CLIENT_DEATH);

    for (const y of after) {
      const spouse = y.socialSecurityDetail?.spouse;
      // Survivor benefit: the late husband's $3,000 PIA, all twelve months.
      expect(spouse?.retirement ?? 0).toBeCloseTo(1500 * 12, 0);
      expect(spouse?.survivor ?? 0).toBeCloseTo(1500 * 12, 0);
      expect(y.income.socialSecurity).toBeCloseTo(3000 * 12, 0);
      // The benefit reaches the bank, not just the income line.
      expect(deposited(y, "ss-spouse")).toBeCloseTo(y.income.socialSecurity, 0);
      // The husband's own row is dead with him.
      expect(y.income.bySource["ss-client"] ?? 0).toBe(0);
    }
  });

  it("mirror: the client keeps collecting after the spouse dies first", () => {
    // Spouse dies 2037 (1962 + 75); client lives to 2047 (1960 + 87).
    const years = project(87, 75, 2037);
    const after = years.filter((y) => y.year > 2037);
    expect(after.length).toBeGreaterThan(0);
    for (const y of after) {
      expect(y.socialSecurityDetail?.client.retirement ?? 0).toBeCloseTo(3000 * 12, 0);
      expect(deposited(y, "ss-client")).toBeCloseTo(3000 * 12, 0);
      expect(y.income.bySource["ss-spouse"] ?? 0).toBe(0);
    }
  });
});
