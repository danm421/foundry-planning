import { describe, it, expect } from "vitest";
import { rankTrustsByContribution, computeTrustCardData } from "../strategy-attribution";
import type { ClientData, ProjectionYear } from "@/engine/types";

const ILIT_ID = "trust-ilit";
const SLAT_ID = "trust-slat";
const REVOC_ID = "trust-revocable";

function fixture(): { tree: ClientData; withResult: ProjectionYear[] } {
  const tree = {
    entities: [
      { id: ILIT_ID, name: "ILIT", entityType: "trust", isIrrevocable: true, trustSubType: "ilit", grantor: "client" },
      { id: SLAT_ID, name: "SLAT", entityType: "trust", isIrrevocable: true, trustSubType: "slat", grantor: "client" },
      { id: REVOC_ID, name: "Revocable Trust", entityType: "trust", isIrrevocable: false, trustSubType: "revocable", grantor: "client" },
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
    expect(card.tagLine).toContain("SLAT");
    expect(card.tagLine).toContain("$2.4M GIFT IN 2026");
    expect(card.primaryAmount).toBe(9_870_000);
    expect(card.narrative).toMatch(/Compounded/);
  });
});
