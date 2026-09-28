import { describe, it, expect } from "vitest";
import {
  rankTrustsByContribution,
  computeTrustCardData,
  computeProcrastinationCardData,
  synthesizeDelayedTopGift,
} from "../strategy-attribution";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { runProjection } from "@/engine";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";

const ILIT_ID = "trust-ilit";
const SLAT_ID = "trust-slat";
const REVOC_ID = "trust-revocable";

function fixture(): { tree: ClientData; withResult: ProjectionYear[] } {
  const tree = {
    entities: [
      { id: ILIT_ID, name: "ILIT", entityType: "trust", isIrrevocable: true, trustSubType: "ilit", grantor: "client" },
      { id: SLAT_ID, name: "SLAT", entityType: "trust", isIrrevocable: true, trustSubType: "irrevocable", grantor: "client" },
      { id: REVOC_ID, name: "Revocable Trust", entityType: "trust", isIrrevocable: false, grantor: "client" },
    ],
    accounts: [
      {
        id: "policy-1",
        name: "Term policy",
        category: "life_insurance",
        value: 0,
        growthRate: 0,
        lifeInsurance: { faceValue: 5_000_000 },
        owners: [{ kind: "entity", entityId: ILIT_ID, percent: 1 }],
      },
      {
        id: "slat-broker",
        name: "SLAT brokerage",
        category: "taxable",
        value: 2_400_000,
        growthRate: 0.06,
        owners: [{ kind: "entity", entityId: SLAT_ID, percent: 1 }],
      },
      {
        id: "rev-acc",
        name: "Family Trust account",
        category: "taxable",
        value: 1_000_000,
        growthRate: 0.06,
        owners: [{ kind: "entity", entityId: REVOC_ID, percent: 1 }],
      },
    ],
    gifts: [
      { id: "g1", year: 2026, amount: 2_400_000, grantor: "client", recipientEntityId: SLAT_ID, useCrummeyPowers: false },
    ],
    planSettings: { planStartYear: 2026, planEndYear: 2066 },
  } as unknown as ClientData;

  const withResult = [
    { year: 2054, accountLedgers: { "slat-broker": { endingValue: 9_870_000 } } },
  ] as unknown as ProjectionYear[];

  return { tree, withResult };
}

describe("rankTrustsByContribution", () => {
  it("ranks irrevocable trusts by contribution; excludes revocable", () => {
    const { tree, withResult } = fixture();
    const ranked = rankTrustsByContribution(tree, withResult);
    const ids = ranked.map((r) => r.trustId);
    expect(ids).toEqual([SLAT_ID, ILIT_ID]); // SLAT $9.87M > ILIT $5M
    expect(ids).not.toContain(REVOC_ID);
  });

  it("returns empty when no irrevocable trusts", () => {
    const tree = { entities: [], accounts: [], gifts: [] } as unknown as ClientData;
    const withResult = [] as unknown as ProjectionYear[];
    const ranked = rankTrustsByContribution(tree, withResult);
    expect(ranked).toEqual([]);
  });
});

describe("computeTrustCardData", () => {
  it("ILIT card: tag line, primary = face value, narrative", () => {
    const { tree, withResult } = fixture();
    const ranked = rankTrustsByContribution(tree, withResult);
    const ilitRanked = ranked.find((r) => r.cardKind === "ilit");
    const card = computeTrustCardData({
      ranked: ilitRanked!,
      tree,
      withResult,
      finalDeathYear: 2054,
    });
    expect(card.tagLine).toContain("ILIT");
    expect(card.primaryAmount).toBe(5_000_000);
    expect(card.narrative).toContain("Death benefit paid outside the estate");
  });

  it("SLAT card: tag line, primary = compounded, narrative shows growth + years", () => {
    const { tree, withResult } = fixture();
    const ranked = rankTrustsByContribution(tree, withResult);
    const slatRanked = ranked.find((r) => r.cardKind === "gifting");
    const card = computeTrustCardData({
      ranked: slatRanked!,
      tree,
      withResult,
      finalDeathYear: 2054,
    });
    expect(card.tagLine).toContain("IRREVOCABLE");
    expect(card.tagLine).toContain("$2.4M GIFT IN 2026");
    expect(card.primaryAmount).toBe(9_870_000);
    expect(card.narrative).toMatch(/Compounded/);
  });
});

describe("synthesizeDelayedTopGift", () => {
  it("moves the top trust-targeted gift forward by N years", () => {
    const { tree } = fixture();
    const delayed = synthesizeDelayedTopGift(tree, 10);
    const movedGift = (delayed.gifts ?? []).find((g) => g.id === "g1");
    expect(movedGift?.year).toBe(2036);
  });

  it("returns the original tree when no trust-targeted gifts exist", () => {
    const tree = { entities: [], gifts: [], accounts: [] } as unknown as ClientData;
    const result = synthesizeDelayedTopGift(tree, 10);
    expect(result).toEqual(tree);
  });
});

describe("computeProcrastinationCardData", () => {
  it("returns negative delta for delayed gift", () => {
    const { tree, withResult } = fixture();
    const delayedResult = [
      { year: 2054, accountLedgers: { "slat-broker": { endingValue: 4_450_000 } } },
    ] as unknown as ProjectionYear[];
    const card = computeProcrastinationCardData({
      tree,
      withResult,
      delayedResult,
      delayYears: 10,
      finalDeathYear: 2054,
    });
    expect(card.primaryAmount).toBeLessThan(0);
    expect(card.narrative).toMatch(/cost of procrastination/i);
  });
});

describe("strategy-attribution — locked entity shares for split-owned trust accounts", () => {
  // Bug parity with the cash-flow drilldown / estate-planning cards: when a
  // trust co-owns an account with the household, a household-side withdrawal
  // must NOT reduce the trust's compounded slice on the strategy card.
  //
  // Real-data shape: the SLAT's 30% comes ONLY from a gift event — there is
  // no authored `entity` owner row on the account (the original fixture
  // double-represented the gift with both an authored row AND a gifts row,
  // so the authored (pre-Task-21) selection gave the right answer by
  // coincidence). Carried once, the way real data carries it:
  //   - At BASE (floor present, authored selection): the account has no
  //     authored entity row, so `account.owners.find` finds nothing, the
  //     account is skipped, compoundedValue = 0, and the floor substitutes
  //     `totalGiftsToEntity` = $300k — which happens to equal the locked
  //     share below, so this case was GREEN at BASE for the wrong reason.
  //   - With the floor deleted but the authored selection left in place:
  //     compoundedValue stays 0 and there is no floor to catch it — RED (0).
  //   - With the gift-aware resolver restoring the selection: the account IS
  //     visited (resolved pct = 0.3 from the gift event), and the engine's
  //     locked share wins — GREEN on the same $300k number, now for the
  //     right reason.
  it("compoundedTrustValueAtFinalYear uses entityAccountSharesEoY for split-owned trust accounts", () => {
    const tree = {
      entities: [
        {
          id: SLAT_ID,
          name: "SLAT",
          entityType: "trust",
          isIrrevocable: true,
          trustSubType: "irrevocable",
          grantor: "client",
        },
      ],
      accounts: [
        {
          id: "mixed-acc",
          name: "Joint+SLAT brokerage",
          category: "taxable",
          value: 1_000_000,
          growthRate: 0,
          // No authored entity row — the SLAT's slice comes only from the
          // gift event below, exactly as real gift-overlay data carries it.
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      giftEvents: [
        {
          kind: "asset",
          year: 2026,
          accountId: "mixed-acc",
          percent: 0.3,
          grantor: "client",
          recipientEntityId: SLAT_ID,
        },
      ],
      // Kept: feeds computeTrustCardData's tag line, not ownership.
      gifts: [
        {
          id: "g-mixed",
          year: 2026,
          amount: 300_000,
          grantor: "client",
          recipientEntityId: SLAT_ID,
          useCrummeyPowers: false,
        },
      ],
      planSettings: { planStartYear: 2026, planEndYear: 2054 },
    } as unknown as ClientData;

    // Final-year row: account drained by a household withdrawal to $921k,
    // but engine's locked SLAT share stays at $300k.
    const lastYear = {
      year: 2054,
      accountLedgers: { "mixed-acc": { endingValue: 921_000 } },
      entityAccountSharesEoY: new Map([
        [SLAT_ID, new Map([["mixed-acc", 300_000]])],
      ]),
    } as unknown as ProjectionYear;
    const withResult = [lastYear] as unknown as ProjectionYear[];

    const ranked = rankTrustsByContribution(tree, withResult);
    const slatRanked = ranked.find((r) => r.trustId === SLAT_ID);
    expect(slatRanked).toBeDefined();
    // $300k locked, NOT $921k × 0.3 = $276.3k.
    expect(slatRanked!.primaryAmount).toBeCloseTo(300_000, 6);
  });
});

describe("rankTrustsByContribution — gift-resolved", () => {
  const GIFT_SLAT_ID = "trust-slat-gift-only";
  const GIFT_ILIT_ID = "trust-ilit-gift-only";

  it("values a trust funded ONLY by an asset gift at its projected share", () => {
    const tree = {
      entities: [
        {
          id: GIFT_SLAT_ID,
          name: "SLAT",
          entityType: "trust",
          isIrrevocable: true,
          trustSubType: "irrevocable",
          grantor: "client",
        },
      ],
      accounts: [
        {
          id: "acc",
          name: "Brokerage",
          category: "taxable",
          value: 10_000_000,
          growthRate: 0,
          // No authored entity row: the trust holds nothing until the gift
          // event resolves it.
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      giftEvents: [
        {
          kind: "asset",
          year: 2027,
          accountId: "acc",
          percent: 0.3,
          grantor: "client",
          recipientEntityId: GIFT_SLAT_ID,
        },
      ],
      gifts: [],
      planSettings: { planStartYear: 2026, planEndYear: 2054 },
    } as unknown as ClientData;

    const withResult = [
      { year: 2054, accountLedgers: { acc: { endingValue: 10_000_000 } } },
    ] as unknown as ProjectionYear[];

    const ranked = rankTrustsByContribution(tree, withResult);
    expect(ranked[0].primaryAmount).toBeCloseTo(3_000_000, 2);
  });

  it("does not fall back to the nominal gift total when a projection exists", () => {
    const tree = {
      entities: [
        {
          id: GIFT_SLAT_ID,
          name: "SLAT",
          entityType: "trust",
          isIrrevocable: true,
          trustSubType: "irrevocable",
          grantor: "client",
        },
      ],
      accounts: [
        {
          id: "acc",
          name: "Brokerage",
          category: "taxable",
          value: 10_000_000,
          growthRate: 0.07,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      giftEvents: [
        {
          kind: "asset",
          year: 2027,
          accountId: "acc",
          percent: 0.3,
          grantor: "client",
          recipientEntityId: GIFT_SLAT_ID,
        },
      ],
      // Nominal gift total at the gift year — the value the floor used to
      // report unconditionally, mislabeled as "compounded".
      gifts: [
        {
          id: "g-real",
          year: 2027,
          amount: 3_000_000,
          grantor: "client",
          recipientEntityId: GIFT_SLAT_ID,
          useCrummeyPowers: false,
        },
      ],
      planSettings: { planStartYear: 2026, planEndYear: 2054 },
    } as unknown as ClientData;

    // 27 years of 7% growth on the $10M account by the final year — the
    // trust's 30% share is well above the $3M nominal gift.
    const withResult = [
      { year: 2054, accountLedgers: { acc: { endingValue: 30_000_000 } } },
    ] as unknown as ProjectionYear[];

    const ranked = rankTrustsByContribution(tree, withResult);
    expect(ranked[0].primaryAmount).toBeGreaterThan(3_000_000);
  });

  it("classifies an ILIT funded by an asset-gift event as life insurance", () => {
    const tree = {
      entities: [
        {
          id: GIFT_ILIT_ID,
          name: "Gift ILIT",
          entityType: "trust",
          isIrrevocable: true,
          // Deliberately NOT "ilit" — the subtype check must not be the
          // thing that decides this; the resolver has to actually classify
          // the account via the gift-resolved ownership.
          trustSubType: "irrevocable",
          grantor: "client",
        },
      ],
      accounts: [
        {
          id: "policy-gift",
          name: "Term policy",
          category: "life_insurance",
          value: 0,
          growthRate: 0,
          lifeInsurance: { faceValue: 2_000_000 },
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      giftEvents: [
        {
          kind: "asset",
          year: 2027,
          accountId: "policy-gift",
          percent: 1,
          grantor: "client",
          recipientEntityId: GIFT_ILIT_ID,
        },
      ],
      gifts: [],
      planSettings: { planStartYear: 2026, planEndYear: 2054 },
    } as unknown as ClientData;

    const withResult = [
      { year: 2054, accountLedgers: { "policy-gift": { endingValue: 0 } } },
    ] as unknown as ProjectionYear[];

    const ranked = rankTrustsByContribution(tree, withResult);
    expect(ranked[0].cardKind).toBe("ilit");
    expect(ranked[0].primaryAmount).toBe(2_000_000);
  });

  // REQUIRED real-projection case: proves the resolver reads the fields the
  // engine actually publishes, not just hand-built fixture shapes. No
  // growth, no income/expenses, no death — the gift is the only thing that
  // can move the number.
  it("reads a real runProjection() result end-to-end", () => {
    const REAL_SLAT_ID = "trust-real-slat";
    const ACCOUNT_ID = "acc-real-brokerage";
    const FM_CLIENT = "fm-real-client";
    const FM_SPOUSE = "fm-real-spouse";

    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: "1970-01-01" },
      familyMembers: [
        {
          id: FM_CLIENT,
          role: "client",
          relationship: "other",
          firstName: "Real",
          lastName: "Client",
          dateOfBirth: "1970-01-01",
        },
        {
          id: FM_SPOUSE,
          role: "spouse",
          relationship: "other",
          firstName: "Real",
          lastName: "Spouse",
          dateOfBirth: "1972-06-15",
        },
      ],
      accounts: [
        {
          id: ACCOUNT_ID,
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          titlingType: "jtwros",
          value: 10_000_000,
          basis: 10_000_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
          ],
        },
      ],
      entities: [
        {
          id: REAL_SLAT_ID,
          name: "SLAT",
          entityType: "trust",
          trustSubType: "irrevocable",
          isIrrevocable: true,
          isGrantor: false,
          includeInPortfolio: false,
          accessibleToClient: false,
          grantor: "client",
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [
        { accountId: ACCOUNT_ID, priorityOrder: 1, startYear: 2026, endYear: 2030 },
      ],
      giftEvents: [
        {
          kind: "asset",
          year: 2027,
          accountId: ACCOUNT_ID,
          percent: 0.3,
          grantor: "client",
          recipientEntityId: REAL_SLAT_ID,
        },
      ],
      planSettings: {
        ...basePlanSettings,
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2030,
      },
    });

    const withResult = runProjection(data);
    const ranked = rankTrustsByContribution(data, withResult);
    expect(ranked[0].primaryAmount).toBeCloseTo(3_000_000, 2);
  });
});

describe("strategy-attribution — edge cases", () => {
  it("0 irrevocable trusts → empty ranking", () => {
    const tree = {
      entities: [
        { id: "rev-1", name: "Revocable", entityType: "trust", isIrrevocable: false },
      ],
      accounts: [],
      gifts: [],
    } as unknown as ClientData;
    const withResult = [] as unknown as ProjectionYear[];
    expect(rankTrustsByContribution(tree, withResult)).toEqual([]);
  });

  it("1 trust → single-element ranking", () => {
    const { tree, withResult } = fixture();
    tree.entities = tree.entities!.filter((e) => e.id === SLAT_ID);
    tree.accounts = tree.accounts.filter((a) =>
      a.owners.some((o) => o.kind === "entity" && o.entityId === SLAT_ID),
    );
    const ranked = rankTrustsByContribution(tree, withResult);
    expect(ranked.length).toBe(1);
    expect(ranked[0].trustId).toBe(SLAT_ID);
  });

  it("N trusts → top entries first (monotonic descent)", () => {
    const { tree, withResult } = fixture();
    const ranked = rankTrustsByContribution(tree, withResult);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].primaryAmount).toBeGreaterThanOrEqual(ranked[i].primaryAmount);
    }
  });
});
