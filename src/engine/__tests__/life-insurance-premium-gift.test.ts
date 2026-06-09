/**
 * Plan Task 10 — end-to-end premium-gift projection integration.
 *
 * Proves that a TRUST-owned life-insurance policy with `premiumPayer: "client"`
 * produces the right cash-flow + gift-tax behavior across a full projection:
 *
 *   1. The household shows a cash-gift outflow equal to the premium in year 1.
 *   2. The trust's checking nets ~0 across the year (receives the gift, pays the
 *      premium back out of its own checking).
 *   3. The gift is treated under the annual exclusion (no lifetime exemption
 *      drawn) when the trust has crummeyPowers = true; it draws lifetime
 *      exemption when crummeyPowers = false.
 *
 * ── Gift-synthesis approach ─────────────────────────────────────────────────
 * The loaders (`load-client-data.ts`, `scenario/loader.ts`) require DB/Clerk and
 * are not usable in a pure engine test. So this test mirrors exactly what the
 * loaders do to the effective tree: it calls `withSynthesizedPremiums` (premium
 * EXPENSE rows — entity-scoped via ownerEntityId) and then
 * `withSynthesizedPremiumGifts` (the cash GiftEvents) on the fixture BEFORE
 * running the projection. The projection itself does NOT run gift synthesis; it
 * only consumes `data.giftEvents`.
 *
 * ── Why two ledgers ─────────────────────────────────────────────────────────
 * The crummey-vs-exemption distinction (assertion 3) is NOT represented in the
 * projection's own gift ledger (`runProjectionWithEvents().giftLedger` /
 * `src/engine/gift-ledger.ts`): that ledger never reads `useCrummeyPowers`, and
 * its cash-event path skips one-time cash GiftEvents (`seriesId == null`), which
 * is exactly what synthesized premium gifts are. The exclusion-vs-exemption
 * contract the plan describes ("crummey true → annual exclusion, false →
 * lifetime exemption") lives in the production lib ledger
 * `src/lib/gifts/compute-ledger.ts` (`computeExemptionLedger` +
 * `computeGiftTaxTreatment`). So assertion 3 feeds the SAME synthesized gift the
 * projection consumed into that ledger and asserts on `lifetimeUsedThisYear`.
 *
 * Assertions 1 & 2 (cash flow) run against the real projection engine output.
 */
import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "../projection";
import { withSynthesizedPremiums } from "@/lib/insurance-policies/premium-expense";
import { withSynthesizedPremiumGifts } from "@/lib/insurance-policies/premium-gift";
import { computeExemptionLedger, type LedgerGift } from "@/lib/gifts/compute-ledger";
import { g4TaxYearRow } from "./golden-fixtures-data";
import type { Account, ClientData, ClientInfo, PlanSettings } from "../types";
import type { TaxYearParameters } from "@/lib/tax/types";

const START_YEAR = new Date().getFullYear(); // synthesizers use new Date().getFullYear()
const FM_CLIENT = "fm-client";
const TRUST = "trust-ilit";
const PREMIUM = 12_000;
const ANNUAL_EXCLUSION = 19_000;

const CLIENT: ClientInfo = {
  firstName: "Solo",
  lastName: "Client",
  dateOfBirth: "1980-01-01",
  retirementAge: 65,
  planEndAge: 90,
  lifeExpectancy: 90,
  filingStatus: "single",
};

const PLAN: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0,
  // Tax inflation 0 so the §2503(b) exclusion the engine projects matches the
  // single seeded row exactly in every plan year.
  taxInflationRate: 0,
  planStartYear: START_YEAR,
  planEndYear: START_YEAR + 5,
};

/** Household default checking with plenty of cash to fund the gift. */
function householdChecking(): Account {
  return {
    id: "acct-checking",
    name: "Household Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    isDefaultChecking: true,
    value: 1_000_000,
    basis: 1_000_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }],
  };
}

/** Trust default checking — fully entity-owned so the engine recognizes it as
 *  the entity's cash account (entityCheckingByEntityId). Starts at 0 so we can
 *  prove it nets ~0 after gift-in + premium-out. */
function trustChecking(): Account {
  return {
    id: "acct-trust-checking",
    name: "Trust Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    isDefaultChecking: true,
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: TRUST, percent: 1 }],
  };
}

/** Term policy owned by the trust, premium paid by the client. */
function trustPolicy(): Account {
  return {
    id: "pol-ilit",
    name: "ILIT Term Policy",
    category: "life_insurance",
    subType: "term",
    titlingType: "jtwros",
    insuredPerson: "client",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    lifeInsurance: {
      faceValue: 1_000_000,
      costBasis: 0,
      premiumAmount: PREMIUM,
      premiumYears: null,
      policyType: "term",
      termIssueYear: START_YEAR,
      termLengthYears: 20,
      endsAtInsuredRetirement: false,
      cashValueGrowthMode: "basic",
      premiumScheduleMode: "off",
      deathBenefitScheduleMode: "off",
      incomeScheduleMode: "off",
      postPayoutGrowthRate: 0.04,
      cashValueSchedule: [],
      premiumPayer: "client",
    },
    owners: [{ kind: "entity", entityId: TRUST, percent: 1 }],
  };
}

function buildScenario(crummeyPowers: boolean): ClientData {
  const base: ClientData = {
    client: CLIENT,
    accounts: [householdChecking(), trustChecking(), trustPolicy()],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: PLAN,
    familyMembers: [
      {
        id: FM_CLIENT,
        role: "client",
        relationship: "other",
        firstName: "Solo",
        lastName: "Client",
        dateOfBirth: "1980-01-01",
      },
    ],
    entities: [
      {
        id: TRUST,
        name: "Client ILIT",
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
        isGrantor: false,
        includeInPortfolio: false,
        grantor: "client",
        crummeyPowers,
      },
    ],
    gifts: [],
    giftEvents: [],
    // Single complete seeded tax-year row (reuses the golden fixture) so the
    // engine's resolver + annual-exclusion map project forward across the plan.
    taxYearRows: [
      {
        ...g4TaxYearRow,
        year: START_YEAR,
        giftAnnualExclusion: ANNUAL_EXCLUSION,
      } as TaxYearParameters,
    ],
  } as unknown as ClientData;

  // Mirror the loaders: synthesize premium EXPENSES first (entity-scoped), then
  // the premium cash GIFTS, both on the effective tree.
  return withSynthesizedPremiumGifts(withSynthesizedPremiums(base));
}

describe("life insurance — premium gift projection (trust-owned, premiumPayer=client)", () => {
  it("synthesizes a client→trust cash gift equal to the premium, scoped to the trust", () => {
    const data = buildScenario(true);

    // The premium expense is scoped to the trust (ownerEntityId set) ...
    const premiumExp = data.expenses.find((e) => e.id === "premium-pol-ilit");
    expect(premiumExp).toBeDefined();
    expect(premiumExp!.ownerEntityId).toBe(TRUST);
    expect(premiumExp!.startYear).toBe(START_YEAR);

    // ... and exactly one cash gift was synthesized: client → trust, = premium.
    const policyGifts = data.giftEvents.filter(
      (g) => g.kind === "cash" && g.sourcePolicyAccountId === "pol-ilit",
    );
    expect(policyGifts.length).toBeGreaterThan(0);
    const y1Gift = policyGifts.find((g) => g.year === START_YEAR);
    expect(y1Gift).toBeDefined();
    if (y1Gift && y1Gift.kind === "cash") {
      expect(y1Gift.amount).toBeCloseTo(PREMIUM, 6);
      expect(y1Gift.grantor).toBe("client");
      expect(y1Gift.recipientEntityId).toBe(TRUST);
      expect(y1Gift.useCrummeyPowers).toBe(true);
    }
  });

  // Assertion 1: household cash-gift outflow == premium in year 1.
  it("household shows a cash-gift outflow equal to the premium in year 1", () => {
    const data = buildScenario(true);
    const { years } = runProjectionWithEvents(data);
    const y1 = years.find((y) => y.year === START_YEAR);
    expect(y1).toBeDefined();
    expect(y1!.expenses.cashGifts).toBeCloseTo(PREMIUM, 6);
  });

  // Assertion 2: trust checking nets ~0 across year 1 (gift in, premium out).
  it("trust checking nets ~0 across year 1 (receives gift, pays premium)", () => {
    const data = buildScenario(true);
    const { years } = runProjectionWithEvents(data);
    const y1 = years.find((y) => y.year === START_YEAR)!;

    const trustLedger = y1.accountLedgers["acct-trust-checking"];
    expect(trustLedger).toBeDefined();
    // Began at 0, ends ~0: the $12k gift in is fully consumed by the $12k
    // premium out.
    expect(trustLedger.beginningValue).toBeCloseTo(0, 6);
    expect(trustLedger.endingValue).toBeCloseTo(0, 6);

    // The "nets ~0" must come from two real, offsetting flows — NOT from
    // nothing happening. Assert both legs are present on the trust ledger.
    const entries = trustLedger.entries ?? [];
    const giftIn = entries.filter((e) => e.category === "gift" && e.amount > 0);
    const premiumOut = entries.filter(
      (e) => e.category === "expense" && e.amount < 0,
    );
    expect(giftIn.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(PREMIUM, 6);
    expect(premiumOut.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(-PREMIUM, 6);

    // And the trust never goes negative — it had the cash on hand to pay.
    for (const y of years) {
      const lg = y.accountLedgers["acct-trust-checking"];
      if (lg) expect(lg.endingValue).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  // Assertion 3a: crummeyPowers = true → annual exclusion, no exemption drawn.
  it("crummeyPowers=true → gift nets the annual exclusion, draws no lifetime exemption", () => {
    const data = buildScenario(true);
    const y1Gift = data.giftEvents.find(
      (g) => g.kind === "cash" && g.sourcePolicyAccountId === "pol-ilit" && g.year === START_YEAR,
    );
    expect(y1Gift).toBeDefined();
    if (!y1Gift || y1Gift.kind !== "cash") throw new Error("expected synthesized cash gift");
    expect(y1Gift.useCrummeyPowers).toBe(true);

    const ledgerGift: LedgerGift = {
      id: "g-ilit",
      year: START_YEAR,
      amount: y1Gift.amount,
      grantor: "client",
      useCrummeyPowers: y1Gift.useCrummeyPowers,
      recipientEntityId: TRUST,
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null,
    };

    const entries = computeExemptionLedger([ledgerGift], {
      entitiesById: { [TRUST]: { isIrrevocable: true, entityType: "trust" } },
      externalsById: {},
      // Trust has ≥1 Crummey beneficiary, so the annual exclusion applies.
      beneficiaryCountsByEntityId: { [TRUST]: 1 },
      annualExclusionByYear: { [START_YEAR]: ANNUAL_EXCLUSION },
    });

    // $12k premium < $19k exclusion → fully annual-excluded, 0 lifetime drawn.
    // computeExemptionLedger drops zero-lifetime gifts entirely.
    expect(entries).toEqual([]);
  });

  // Assertion 3b: crummeyPowers = false → lifetime exemption drawn.
  it("crummeyPowers=false → gift draws lifetime exemption (no annual exclusion)", () => {
    const data = buildScenario(false);
    const y1Gift = data.giftEvents.find(
      (g) => g.kind === "cash" && g.sourcePolicyAccountId === "pol-ilit" && g.year === START_YEAR,
    );
    expect(y1Gift).toBeDefined();
    if (!y1Gift || y1Gift.kind !== "cash") throw new Error("expected synthesized cash gift");
    expect(y1Gift.useCrummeyPowers).toBe(false);

    const ledgerGift: LedgerGift = {
      id: "g-ilit",
      year: START_YEAR,
      amount: y1Gift.amount,
      grantor: "client",
      useCrummeyPowers: y1Gift.useCrummeyPowers,
      recipientEntityId: TRUST,
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null,
    };

    const entries = computeExemptionLedger([ledgerGift], {
      entitiesById: { [TRUST]: { isIrrevocable: true, entityType: "trust" } },
      externalsById: {},
      beneficiaryCountsByEntityId: { [TRUST]: 1 },
      annualExclusionByYear: { [START_YEAR]: ANNUAL_EXCLUSION },
    });

    // No Crummey → the full $12k draws lifetime exemption.
    expect(entries).toHaveLength(1);
    expect(entries[0].grantor).toBe("client");
    expect(entries[0].year).toBe(START_YEAR);
    expect(entries[0].lifetimeUsedThisYear).toBeCloseTo(PREMIUM, 6);
    expect(entries[0].cumulativeLifetimeUsed).toBeCloseTo(PREMIUM, 6);
  });
});
